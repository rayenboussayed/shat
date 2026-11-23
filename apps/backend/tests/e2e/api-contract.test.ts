import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import createClient from "openapi-fetch";
import type { paths } from "shat-api-types";

const serverEntry = new URL("../../dist/apps/backend/src/main.js", import.meta.url);

/** Origin included in the spawned server's CORS allow-list via CORS_ORIGINS. */
const ALLOWED_ORIGIN = "https://release-allowed.example.test";

/** Origin intentionally excluded from the spawned server's CORS allow-list. */
const DISALLOWED_ORIGIN = "https://release-denied.example.test";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("no address")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitHealthy(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("server did not become healthy in time");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Shape of the public error envelope used by unknown routes. */
interface PublicError {
  statusCode: number;
  error: string;
  message: string;
}

/** Narrows an unknown JSON value to a public error envelope. */
function isPublicError(value: unknown): value is PublicError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate: Partial<PublicError> = value;
  return (
    typeof candidate.statusCode === "number" &&
    typeof candidate.error === "string" &&
    typeof candidate.message === "string"
  );
}

describe("api contract (typed client)", () => {
  let port = 0;
  let child: ReturnType<typeof spawn> | undefined;

  beforeAll(async () => {
    port = await freePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(port),
      CORS_ORIGINS: ALLOWED_ORIGIN,
    };
    delete env.DATABASE_URL;
    child = spawn(process.execPath, [serverEntry.pathname], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", () => undefined);
    child.stderr?.on("data", () => undefined);
    await waitHealthy(port, 30_000);
  }, 45_000);

  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      try {
        await once(child, "exit");
      } catch {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
  });

  it("reads the typed health status", async () => {
    const client = createClient<paths>({ baseUrl: `http://127.0.0.1:${port}` });
    const { data, error } = await client.GET("/health");
    expect(error).toBeUndefined();
    expect(data?.status).toBe("ok");
  });

  it("returns a typed error body for an unknown path", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/missing`);
    expect(response.status).toBe(404);
    const parsed: unknown = await response.json();
    expect(isPublicError(parsed)).toBe(true);
    if (!isPublicError(parsed)) {
      return;
    }
    const body = parsed;
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe("Not Found");
    expect(body.message).toBe("The requested resource was not found");
  });

  it("returns 400 for an invalid enrollment body", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/identity/devices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const parsed: unknown = await response.json();
    expect(isPublicError(parsed)).toBe(true);
    if (!isPublicError(parsed)) {
      return;
    }
    expect(parsed.statusCode).toBe(400);
    expect(parsed.error).toBe("Bad Request");
  });

  it("answers CORS preflight for an allowed origin", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    expect(response.headers.get("access-control-max-age")).toBe("600");
  });

  it("omits the allow-origin header for a disallowed origin", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: DISALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("emits decreasing rate-limit headers on repeated requests", async () => {
    const url = `http://127.0.0.1:${port}/identity/devices`;
    const first = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const second = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(first.headers.get("x-ratelimit-limit")).toBe("100");
    expect(second.headers.get("x-ratelimit-limit")).toBe("100");

    const firstRemainingHeader = first.headers.get("x-ratelimit-remaining");
    const secondRemainingHeader = second.headers.get("x-ratelimit-remaining");
    expect(firstRemainingHeader).not.toBeNull();
    expect(secondRemainingHeader).not.toBeNull();
    const firstRemaining = Number(firstRemainingHeader);
    const secondRemaining = Number(secondRemainingHeader);
    expect(Number.isInteger(firstRemaining)).toBe(true);
    expect(Number.isInteger(secondRemaining)).toBe(true);
    expect(firstRemaining - secondRemaining).toBe(1);

    expect(first.headers.get("x-ratelimit-reset")).toMatch(/^\d+$/);
  });
}, 30_000);
