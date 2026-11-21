import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyError } from "fastify";
import { registerIdentityRoutes } from "./identity.ts";

const healthResponseSchema = {
  type: "object",
  properties: {
    status: { const: "ok" },
  },
  required: ["status"],
  additionalProperties: false,
} as const;

const publicErrors = new Map<number, { error: string; message: string }>([
  [400, { error: "Bad Request", message: "The request is invalid" }],
  [401, { error: "Unauthorized", message: "Authentication is required" }],
  [403, { error: "Forbidden", message: "The request is not permitted" }],
  [404, { error: "Not Found", message: "The requested resource was not found" }],
  [409, { error: "Conflict", message: "The request conflicts with current state" }],
  [413, { error: "Payload Too Large", message: "The request payload is too large" }],
  [415, { error: "Unsupported Media Type", message: "The media type is not supported" }],
  [422, { error: "Unprocessable Entity", message: "The request could not be processed" }],
  [429, { error: "Too Many Requests", message: "The request limit was exceeded" }],
]);

function getAllowedOrigins(): string[] | false {
  const configuredOrigins = process.env.CORS_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return configuredOrigins?.length ? configuredOrigins : false;
}

/**
 * Creates the Fastify application with the shared API security and error policies.
 */
export function buildApp() {
  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
          "*.password",
          "*.secret",
          "*.token",
          "*.accessToken",
          "*.refreshToken",
        ],
        censor: "[REDACTED]",
      },
    },
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.register(helmet);
  app.register(cors, {
    origin: getAllowedOrigins(),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  });
  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "Request completed",
    );
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    const publicError =
      statusCode === 500
        ? { error: "Internal Server Error", message: "An unexpected error occurred" }
        : (publicErrors.get(statusCode) ?? {
            error: "Request Failed",
            message: "The request could not be completed",
          });

    request.log.error(
      { statusCode, errorCode: error.code ?? "INTERNAL_ERROR" },
      "Request failed",
    );

    return reply.code(statusCode).send({
      statusCode,
      ...publicError,
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      statusCode: 404,
      ...(publicErrors.get(404) ?? {
        error: "Not Found",
        message: "The requested resource was not found",
      }),
      requestId: request.id,
    }),
  );

  app.get(
    "/health",
    {
      config: { rateLimit: false },
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  registerIdentityRoutes(app);

  return app;
}
