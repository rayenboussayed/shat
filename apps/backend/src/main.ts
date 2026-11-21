import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.ts";
import { buildApp } from "./app.ts";

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const fastifyInstance = buildApp();
  const adapter = new FastifyAdapter(fastifyInstance);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  app.enableShutdownHooks(["SIGINT", "SIGTERM"], { useProcessExit: true });

  await app.listen(port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start the backend", error);
  process.exitCode = 1;
});