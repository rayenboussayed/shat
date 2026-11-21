import { Catch, Injectable } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AllExceptionsFilter, codeOf, statusOf } from "../app.filter.ts";
import { publicErrors } from "../app.ts";

/** True when the request path belongs to the identity or prekey API. */
function isIdentityPath(path: string): boolean {
  return (
    path === "/identity" ||
    path.startsWith("/identity/") ||
    path === "/prekeys" ||
    path.startsWith("/prekeys/")
  );
}

/** Exception filter that keeps identity errors free of requestId. */
@Catch()
@Injectable()
export class IdentityExceptionsFilter extends AllExceptionsFilter {
  /**
   * Sends an identity error without requestId, or delegates other paths to the
   * global filter.
   *
   * @param exception - The thrown value.
   * @param host - Nest's argument host for the current request.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    const path = request.url.split("?")[0] ?? "";
    if (!isIdentityPath(path)) {
      super.catch(exception, host);
      return;
    }

    const rawStatus = statusOf(exception);
    const statusCode =
      rawStatus !== undefined && rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;

    request.log.error({ statusCode, errorCode: codeOf(exception) }, "Request failed");

    const body: Record<string, unknown> = { statusCode };
    if (statusCode === 500) {
      body.error = "Internal Server Error";
      body.message = "An unexpected error occurred";
    } else {
      const publicError = publicErrors.get(statusCode);
      body.error = publicError?.error ?? "Bad Request";
      body.message =
        exception instanceof Error && exception.message
          ? exception.message
          : (publicError?.message ?? "The request could not be completed");
      const code = codeOf(exception);
      if (code !== "INTERNAL_ERROR") {
        body.code = code;
      }
    }

    reply.code(statusCode).send(body);
  }
}
