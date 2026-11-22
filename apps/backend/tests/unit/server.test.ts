import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { describe, expect, it } from "vitest";

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
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("server", () => {
  it(
    "serves /health and exits 0 on SIGTERM after draining",
    async () => {
      const port = await freePort();
      const child = spawn(process.execPath, [serverEntry.pathname], {
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", () => undefined);
      child.stderr.on("data", () => undefined);
      const exited = once(child, "exit");

      try {
        await waitHealthy(port, 30_000);
        child.kill("SIGTERM");
        const [code] = await exited;
        expect(code).toBe(0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    },
    45_000,
  );
});
