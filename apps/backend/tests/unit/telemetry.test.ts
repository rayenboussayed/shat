import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { ADMIN_CONFIG } from "../../src/admin/admin.config.js";
import { DatabaseService } from "../../src/db/db.js";
import { TelemetryModule } from "../../src/telemetry/telemetry.module.js";
import { TelemetryRepository } from "../../src/telemetry/telemetry.repository.js";
import { TelemetryService } from "../../src/telemetry/telemetry.service.js";
import { TELEMETRY_STORE, TelemetryStore } from "../../src/telemetry/telemetry.store.js";
import type { CounterMetric } from "../../src/telemetry/telemetry.store.js";

const ADMIN_TOKEN = randomBytes(24).toString("base64url");
const SUMMARY_KEYS = [
  "endsAt",
  "enrolledDevices",
  "errors",
  "fileBytes",
  "files",
  "requests",
  "startedAt",
];

/** Narrows an injected response body to a plain JSON object without a cast. */
function jsonRecord(response: { json(): unknown }): Record<string, unknown> {
  const parsed = response.json();
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

describe("TelemetryStore", () => {
  it("aggregates counters in a fixed window with UTC bounds", () => {
    let now = 10_000;
    const store = new TelemetryStore(1000, () => now);
    store.increment("requests");
    store.increment("requests", 2);
    store.increment("errors");
    expect(store.snapshot()).toEqual({
      startedAt: new Date(10_000).toISOString(),
      endsAt: new Date(11_000).toISOString(),
      requests: 3,
      errors: 1,
    });
    now = 10_999;
    expect(store.snapshot().requests).toBe(3);
  });

  it("drops counters when the window ends, bounding retention", () => {
    let now = 0;
    const store = new TelemetryStore(1000, () => now);
    store.increment("requests", 5);
    now = 1000;
    expect(store.snapshot()).toMatchObject({ requests: 0, errors: 0 });
    expect(store.snapshot().startedAt).toBe(new Date(1000).toISOString());
  });

  it("refuses any name outside the counter allowlist", () => {
    const store = new TelemetryStore(1000, () => 0);
    const forbidden = ["userId", "deviceId", "ip", "messageBody", "constructor", "__proto__"];
    for (const name of forbidden) {
      // Deliberately invalid input: the runtime guard must reject it even though types forbid it.
      expect(() => store.increment(name as CounterMetric)).toThrow(TypeError);
    }
    expect(Object.keys(store.snapshot()).sort()).toEqual(["endsAt", "errors", "requests", "startedAt"]);
  });

  it("refuses amounts that are not non-negative safe integers", () => {
    const store = new TelemetryStore(1000, () => 0);
    for (const amount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.increment("requests", amount)).toThrow(RangeError);
    }
    expect(store.snapshot().requests).toBe(0);
  });
});

describe("TelemetryService summary", () => {
  it("returns only window counters and identifier-free totals", async () => {
    const store = new TelemetryStore(1000, () => 0);
    store.increment("requests");
    const moduleRef = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: TelemetryRepository, useValue: { totals: async () => ({ enrolledDevices: 2, files: 1, fileBytes: 512 }) } },
        { provide: TELEMETRY_STORE, useValue: store },
      ],
    }).compile();
    const summary = await moduleRef.get(TelemetryService).summary();
    await moduleRef.close();
    expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS);
    expect(summary).toMatchObject({ requests: 1, errors: 0, enrolledDevices: 2, files: 1, fileBytes: 512 });
  });
});

describe("telemetry summary route", () => {
  let moduleRef: TestingModule | undefined;
  let app: NestFastifyApplication | undefined;

  const createApp = async (token: string | undefined): Promise<NestFastifyApplication> => {
    const compiled = await Test.createTestingModule({ imports: [TelemetryModule] })
      // The fakes implement only the members the summary route uses.
      .overrideProvider(DatabaseService)
      .useValue({ db: {}, onApplicationShutdown: async () => undefined })
      .overrideProvider(TelemetryRepository)
      .useValue({ totals: async () => ({ enrolledDevices: 2, files: 1, fileBytes: 512 }) })
      .overrideProvider(ADMIN_CONFIG)
      .useValue({ token })
      .compile();
    moduleRef = compiled;
    const instance = compiled.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await instance.init();
    await instance.getHttpAdapter().getInstance().ready();
    app = instance;
    return instance;
  };

  afterEach(async () => {
    await app?.close();
    await moduleRef?.close();
    app = undefined;
    moduleRef = undefined;
  });

  it("requires the admin token and fails closed when none is configured", async () => {
    const instance = await createApp(undefined);
    const response = await instance.inject({
      method: "GET",
      url: "/telemetry/summary",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.statusCode).toBe(503);
    const body = jsonRecord(response);
    expect(body).toMatchObject({
      statusCode: 503,
      error: "Service Unavailable",
      message: "Admin access is not configured",
    });
    expect(body).toHaveProperty("requestId");
  });

  it("counts requests and error responses, and returns only aggregates", async () => {
    const instance = await createApp(ADMIN_TOKEN);
    const denied = await instance.inject({ method: "GET", url: "/telemetry/summary" });
    expect(denied.statusCode).toBe(401);

    const allowed = await instance.inject({
      method: "GET",
      url: "/telemetry/summary",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(allowed.statusCode).toBe(200);
    const body = jsonRecord(allowed);
    expect(Object.keys(body).sort()).toEqual(SUMMARY_KEYS);
    expect(body).toMatchObject({ requests: 2, errors: 1, enrolledDevices: 2, files: 1, fileBytes: 512 });
    expect(allowed.body).not.toContain(ADMIN_TOKEN);
    expect(allowed.body).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
