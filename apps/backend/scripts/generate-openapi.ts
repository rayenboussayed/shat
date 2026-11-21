import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

process.env.SHAT_OPENAPI = "1";

const appModulePath = "../dist/apps/backend/src/app.js";
const appModuleModulePath = "../dist/apps/backend/src/app.module.js";

interface CompiledApp {
  buildApp: () => FastifyInstance;
}

interface CompiledModule {
  AppModule: Parameters<typeof NestFactory.create>[0];
}

/** Writes the OpenAPI document generated from the compiled Nest application. */
async function main(): Promise<void> {
  const { buildApp } = (await import(appModulePath)) as CompiledApp;
  const { AppModule } = (await import(appModuleModulePath)) as CompiledModule;

  const fastifyInstance = buildApp();
  const adapter = new FastifyAdapter(fastifyInstance);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });

  try {
    await app.init();
    await fastifyInstance.ready();

    const document = fastifyInstance.swagger();
    const outputPath = resolve(
      import.meta.dirname,
      "../../../packages/api-types/src/openapi.json",
    );
    writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error("Failed to generate OpenAPI document", error);
  process.exitCode = 1;
});
