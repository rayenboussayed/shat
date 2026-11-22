import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import createClient from "openapi-fetch";
import type { paths } from "shat-api-types";

const serverEntry = new URL("../../dist/apps/backend/src/main.js", import.meta.url);

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
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
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
}, 30_000);
