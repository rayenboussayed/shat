import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_CONFIG, loadAdminConfig } from "../../src/admin/admin.config.js";
import { AdminModule } from "../../src/admin/admin.module.js";
import { DatabaseService } from "../../src/db/db.js";
import { PublicRoutesExceptionsFilter } from "../../src/identity/identity.filter.js";

const ADMIN_TOKEN = randomBytes(24).toString("base64url");
const WRONG_SAME_LENGTH = `${ADMIN_TOKEN.slice(0, -1)}${ADMIN_TOKEN.endsWith("a") ? "b" : "a"}`;

describe("admin configuration", () => {
  it("leaves the token unset when SHAT_ADMIN_TOKEN is missing or shorter than 32 characters", () => {
    expect(loadAdminConfig({}).token).toBeUndefined();
    expect(loadAdminConfig({ SHAT_ADMIN_TOKEN: "short" }).token).toBeUndefined();
    expect(loadAdminConfig({ SHAT_ADMIN_TOKEN: ADMIN_TOKEN }).token).toBe(ADMIN_TOKEN);
  });

  it("leaves the token unset when it has fewer than 16 distinct characters", () => {
    expect(loadAdminConfig({ SHAT_ADMIN_TOKEN: "a".repeat(40) }).token).toBeUndefined();
    expect(loadAdminConfig({ SHAT_ADMIN_TOKEN: `${"a".repeat(32)}b` }).token).toBeUndefined();
    expect(loadAdminConfig({ SHAT_ADMIN_TOKEN: ADMIN_TOKEN }).token).toBe(ADMIN_TOKEN);
  });
});

describe("admin health routes", () => {
  let moduleRef: TestingModule | undefined;
  let app: NestFastifyApplication | undefined;
  let execute: ReturnType<typeof vi.fn>;

  const createApp = async (
    token: string | undefined,
    probe: () => Promise<unknown> = async () => [{ "?column?": 1 }],
  ): Promise<NestFastifyApplication> => {
    execute = vi.fn(probe);
    const compiled = await Test.createTestingModule({
      imports: [AdminModule],
      providers: [{ provide: APP_FILTER, useClass: PublicRoutesExceptionsFilter }],
    })
      // The fake implements only the query method the readiness probe uses.
      .overrideProvider(DatabaseService)
      .useValue({ db: { execute }, onApplicationShutdown: async () => undefined })
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

  it("fails closed with 503 when no admin token is configured, even if a header is sent", async () => {
    const instance = await createApp(undefined);
    const response = await instance.inject({
      method: "GET",
      url: "/admin/health/live",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      statusCode: 503,
      error: "Service Unavailable",
      message: "Admin access is not configured",
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain(ADMIN_TOKEN);
  });

  it("rejects a missing, wrong or wrong-length admin token with 401", async () => {
    const instance = await createApp(ADMIN_TOKEN);
    const missing = await instance.inject({ method: "GET", url: "/admin/health/live" });
    const wrong = await instance.inject({
      method: "GET",
      url: "/admin/health/live",
      headers: { "x-admin-token": WRONG_SAME_LENGTH },
    });
    const truncated = await instance.inject({
      method: "GET",
      url: "/admin/health/live",
      headers: { "x-admin-token": ADMIN_TOKEN.slice(0, 10) },
    });
    for (const response of [missing, wrong, truncated]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ statusCode: 401, error: "Unauthorized" });
    }
  });

  it("reports liveness without touching the database", async () => {
    const instance = await createApp(ADMIN_TOKEN);
    const response = await instance.inject({
      method: "GET",
      url: "/admin/health/live",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", details: { process: { status: "up" } } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports readiness as up when the database probe succeeds", async () => {
    const instance = await createApp(ADMIN_TOKEN);
    const response = await instance.inject({
      method: "GET",
      url: "/admin/health/ready",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", details: { database: { status: "up" } } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reports readiness as down with a generic message when the database fails", async () => {
    const instance = await createApp(ADMIN_TOKEN, async () => {
      throw new Error("password authentication failed for user svc at 10.0.0.5");
    });
    const response = await instance.inject({
      method: "GET",
      url: "/admin/health/ready",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "error",
      details: { database: { status: "down", message: "The database is unreachable" } },
    });
    expect(response.body).not.toContain("svc");
    expect(response.body).not.toContain("10.0.0.5");
  });

  it("marks readiness down when the database probe hangs past its timeout", async () => {
    const instance = await createApp(ADMIN_TOKEN, () => new Promise<never>(() => undefined));
    const response = await instance.inject({
      method: "GET",
      url: "/admin/health/ready",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ details: { database: { status: "down" } } });
  }, 10_000);
});
