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

    const publicError =
      statusCode === 500
        ? { error: "Internal Server Error", message: "An unexpected error occurred" }
        : (publicErrors.get(statusCode) ?? {
            error: "Request Failed",
            message: "The request could not be completed",
          });

    request.log.error(
      { statusCode, errorCode: codeOf(exception) },
      "Request failed",
    );

    reply.code(statusCode).send({
      statusCode,
      ...publicError,
      requestId: request.id,
    });
  }
}
