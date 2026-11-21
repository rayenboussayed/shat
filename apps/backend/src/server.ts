import { buildApp } from "./app.ts";
import { closeIdentityDatabase } from "./db/db.ts";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down");

  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "Graceful shutdown failed");
    process.exitCode = 1;
  } finally {
    try {
      await closeIdentityDatabase();
    } catch (error) {
      app.log.error({ err: error }, "Database shutdown failed");
      process.exitCode = 1;
    }
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await app.listen({ port, host: "0.0.0.0" });
