import { UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicRoutesExceptionsFilter } from "../../src/identity/identity.filter.js";
import { AuthService } from "../../src/identity/auth.service.js";
import { DatabaseService } from "../../src/db/db.js";
import {
  TURN_CREDENTIAL_TTL_SECONDS,
  buildTurnUsername,
  parseTurnUsername,
  signTurnUsername,
} from "../../src/turn/credentials.js";
import { TURN_CONFIG, loadTurnConfig } from "../../src/turn/turn.config.js";
import type { TurnConfig } from "../../src/turn/turn.config.js";
import { TurnModule } from "../../src/turn/turn.module.js";
import { TurnService } from "../../src/turn/turn.service.js";
import type { TurnCredentialResponse } from "../../src/turn/turn.service.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const URIS = ["turn:turn.example.test:3478", "turns:turn.example.test:5349"];
const deviceId = randomUUID();
const otherDeviceId = randomUUID();
const sessionHeaders = { "x-session-token": "device-token" };

const actor = { id: deviceId, userId: randomUUID(), sessionId: randomUUID(), tokenHash: Buffer.alloc(0) };

function expectedPassword(secret: string, username: string): string {
  return createHmac("sha1", secret).update(username).digest("base64");
}

function expiryOf(username: string): number {
  const parsed = parseTurnUsername(username);
  if (parsed === undefined) {
    throw new Error("username did not parse");
  }
  return parsed.expiresAtSeconds;
}

describe("TURN configuration", () => {
  it("fails closed when the secret is unset or shorter than 32 characters", () => {
    expect(loadTurnConfig({}).secret).toBeUndefined();
    expect(loadTurnConfig({ TURN_SECRET: "too-short" }).secret).toBeUndefined();
    expect(loadTurnConfig({ TURN_SECRET: SECRET }).secret).toBe(SECRET);
  });

  it("fails closed when the secret has fewer than 16 distinct characters", () => {
    expect(loadTurnConfig({ TURN_SECRET: "a".repeat(40) }).secret).toBeUndefined();
    expect(loadTurnConfig({ TURN_SECRET: `${"a".repeat(32)}b` }).secret).toBeUndefined();
    expect(loadTurnConfig({ TURN_SECRET: SECRET }).secret).toBe(SECRET);
  });

  it("keeps only turn and turns URIs", () => {
    const config = loadTurnConfig({
      TURN_URIS: `${URIS[0]}, ${URIS[1]}, https://evil.example.test, not a uri`,
    });
    expect(config.uris).toEqual(URIS);
  });
});

describe("TURN username and password", () => {
  it("round-trips the expiry and device through the username", () => {
    const username = buildTurnUsername(deviceId, 1_700_000_000);
    expect(parseTurnUsername(username)).toEqual({ expiresAtSeconds: 1_700_000_000, deviceId });
  });

  it("rejects usernames of any other shape", () => {
    const malformed = [
      "1700000000",
      `:${deviceId}`,
      `1700000000:not-a-uuid`,
      `1700000000:${deviceId}:extra`,
      `12345678901234:${deviceId}`,
      `-1:${deviceId}`,
    ];
    for (const username of malformed) {
      expect(parseTurnUsername(username)).toBeUndefined();
    }
  });

  it("matches a known-answer HMAC vector computed offline", () => {
    // Expected value derived independently with OpenSSL HMAC-SHA1, not by calling the code under test.
    const vectorSecret = "0123456789abcdef0123456789abcdef";
    const vectorUsername = "1700000000:6ba7b810-9dad-41d1-80b4-00c04fd430c8";
    expect(signTurnUsername(vectorSecret, vectorUsername)).toBe("pQVHJwgLPlBwqYYJWGBiGiEyo0I=");
  });

  it("computes the coturn HMAC-SHA1 password in canonical base64", () => {
    const username = buildTurnUsername(deviceId, 1_700_000_000);
    const password = signTurnUsername(SECRET, username);
    expect(password).toBe(expectedPassword(SECRET, username));
    expect(password).toMatch(/^[A-Za-z0-9+/]{27}=$/);
  });
});

describe("TurnService", () => {
  let moduleRef: TestingModule | undefined;
  let auth: AuthService;
  let service: TurnService;

  const setup = async (config: TurnConfig) => {
    const compiled = await Test.createTestingModule({
      providers: [
        AuthService,
        TurnService,
        { provide: DatabaseService, useValue: { db: {} } },
        { provide: TURN_CONFIG, useValue: config },
      ],
    }).compile();
    moduleRef = compiled;
    auth = compiled.get(AuthService);
    service = compiled.get(TurnService);
    vi.spyOn(auth, "getAuthenticatedActor").mockResolvedValue(actor);
  };

  afterEach(async () => {
    await moduleRef?.close();
    vi.restoreAllMocks();
  });

  it("issues a credential bound to the device with a five-minute lifetime", async () => {
    await setup({ secret: SECRET, uris: URIS });
    const before = Math.floor(Date.now() / 1000);
    const issued = await service.issue(sessionHeaders);

    const expiresAt = expiryOf(issued.username);
    expect(parseTurnUsername(issued.username)?.deviceId).toBe(deviceId);
    expect(issued.ttlSeconds).toBe(TURN_CREDENTIAL_TTL_SECONDS);
    expect(expiresAt).toBeGreaterThanOrEqual(before + TURN_CREDENTIAL_TTL_SECONDS);
    expect(expiresAt).toBeLessThanOrEqual(before + TURN_CREDENTIAL_TTL_SECONDS + 1);
    expect(issued.password).toBe(expectedPassword(SECRET, issued.username));
    expect(issued.uris).toEqual(URIS);
    expect(service.verify(issued.username, issued.password, expiresAt - 1)).toBe(true);
  });

  it("issues nothing to a caller without a valid session", async () => {
    await setup({ secret: SECRET, uris: URIS });
    vi.spyOn(auth, "getAuthenticatedActor").mockResolvedValue(undefined);
    await expect(service.issue(sessionHeaders)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("fails closed when no secret is configured", async () => {
    await setup({ secret: undefined, uris: URIS });
    await expect(service.issue(sessionHeaders)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const username = buildTurnUsername(deviceId, Math.floor(Date.now() / 1000) + 60);
    expect(service.verify(username, expectedPassword(SECRET, username), Math.floor(Date.now() / 1000))).toBe(
      false,
    );
  });

  it("accepts a credential only until its expiry", async () => {
    await setup({ secret: SECRET, uris: URIS });
    const username = buildTurnUsername(deviceId, 1_700_000_300);
    const password = expectedPassword(SECRET, username);
    const expiry = expiryOf(username);
    expect(service.verify(username, password, expiry - 1)).toBe(true);
    expect(service.verify(username, password, expiry)).toBe(false);
    expect(service.verify(username, password, expiry + 1)).toBe(false);
  });

  it("rejects forged, altered and non-canonical credentials", async () => {
    await setup({ secret: SECRET, uris: URIS });
    const now = 1_700_000_000;
    const username = buildTurnUsername(deviceId, now + TURN_CREDENTIAL_TTL_SECONDS);
    const password = expectedPassword(SECRET, username);
    expect(service.verify(username, password, now)).toBe(true);

    const flipped = `${password.charAt(0) === "A" ? "B" : "A"}${password.slice(1)}`;
    expect(service.verify(username, flipped, now)).toBe(false);

    expect(service.verify(username, expectedPassword("f".repeat(32), username), now)).toBe(false);

    expect(service.verify(buildTurnUsername(otherDeviceId, now + 300), password, now)).toBe(false);

    expect(service.verify(username, password.replace(/=+$/, ""), now)).toBe(false);
    expect(service.verify(username, "", now)).toBe(false);
    expect(service.verify("not-a-username", password, now)).toBe(false);
  });

  it("rejects a valid MAC whose lifetime exceeds the policy window", async () => {
    await setup({ secret: SECRET, uris: URIS });
    const now = 1_700_000_000;
    const longUsername = buildTurnUsername(deviceId, now + 3600);
    expect(service.verify(longUsername, expectedPassword(SECRET, longUsername), now)).toBe(false);
  });
});

describe("TURN credential route", () => {
  let app: NestFastifyApplication;

  const createApp = async (config: TurnConfig): Promise<void> => {
    const auth = {
      getAuthenticatedActor: async (headers: { "x-session-token"?: string }) =>
        headers["x-session-token"] === "device-token" ? actor : undefined,
    };
    const moduleRef = await Test.createTestingModule({
      imports: [TurnModule],
      providers: [{ provide: APP_FILTER, useClass: PublicRoutesExceptionsFilter }],
    })
      // The fakes implement only the method the route uses.
      .overrideProvider(DatabaseService)
      .useValue({ db: {}, onApplicationShutdown: async () => undefined })
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(TURN_CONFIG)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  };

  afterEach(async () => {
    await app?.close();
  });

  it("rejects a request without a session using the public envelope", async () => {
    await createApp({ secret: SECRET, uris: URIS });
    const response = await app.inject({ method: "POST", url: "/turn/credentials" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ statusCode: 401, error: "Unauthorized" });
    expect(response.json()).not.toHaveProperty("requestId");
  });

  it("fails closed with 503 and reveals nothing when unconfigured", async () => {
    await createApp({ secret: undefined, uris: URIS });
    const response = await app.inject({
      method: "POST",
      url: "/turn/credentials",
      headers: sessionHeaders,
    });
    expect(response.statusCode).toBe(503);
    const body: Record<string, unknown> = response.json();
    expect(body).toEqual({
      statusCode: 503,
      error: "Service Unavailable",
      message: "TURN credentials are not configured",
    });
    expect(body).not.toHaveProperty("requestId");
    expect(response.body).not.toContain(SECRET);
  });

  it("issues a no-store credential that verifies with the configured secret", async () => {
    await createApp({ secret: SECRET, uris: URIS });
    const response = await app.inject({
      method: "POST",
      url: "/turn/credentials",
      headers: sessionHeaders,
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body: TurnCredentialResponse = response.json();
    expect(body.uris).toEqual(URIS);
    expect(body.password).toBe(expectedPassword(SECRET, body.username));
    expect(response.body).not.toContain(SECRET);
  });
});
