import { Catch, HttpException, Injectable } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { publicErrors } from "./app.ts";

/** Extracts a numeric HTTP status from an exception when one is present. */
export function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (typeof exception === "object" && exception !== null && "statusCode" in exception) {
    const value: unknown = exception.statusCode;
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

/** Extracts a Fastify error code from an exception when one is present. */
export function codeOf(exception: unknown): string {
  if (typeof exception === "object" && exception !== null && "code" in exception) {
    const value: unknown = exception.code;
    if (typeof value === "string") {
      return value;
    }
  }
  return "INTERNAL_ERROR";
}

/**
 * Error codes that may be echoed in a public body. Empty: framework codes such as
 * FST_ERR_VALIDATION describe internals and are never returned to callers.
 */
const PUBLIC_DOMAIN_CODES = new Set<string>();

/**
 * Builds the single fixed public error body for a status. The internal error code
 * is used only for the optional, strict allowlist of domain codes and for logging
 * by the caller; it is never echoed by default.
 */
export function buildErrorBody(status: number, exception: unknown): Record<string, unknown> {
  const publicError =
    status === 500
      ? { error: "Internal Server Error", message: "An unexpected error occurred" }
      : (publicErrors.get(status) ?? {
          error: "Request Failed",
          message: "The request could not be completed",
        });
  const body: Record<string, unknown> = { statusCode: status, ...publicError };
  const code = codeOf(exception);
  if (status !== 500 && PUBLIC_DOMAIN_CODES.has(code)) {
    body.code = code;
  }
  return body;
}

/** Converts thrown exceptions into the public API error envelope. */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  /**
   * Sends a typed error response and records the failure without leaking internals.
   *
   * @param exception - The thrown value.
   * @param host - Nest's argument host for the current request.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    const rawStatus = statusOf(exception);
    const statusCode =
      rawStatus !== undefined && rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;

    request.log.error(
      { statusCode, errorCode: codeOf(exception) },
      "Request failed",
    );

    reply.code(statusCode).send({
      ...buildErrorBody(statusCode, exception),
      requestId: request.id,
    });
  }
}
