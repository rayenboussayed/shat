import { Catch, Injectable } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AllExceptionsFilter, buildErrorBody, codeOf, statusOf } from "../app.filter.ts";
import { matchesPrefix } from "../path-matching.ts";

/** Route prefixes served by the public (no-requestId) identity envelope. */
const PUBLIC_PREFIXES = [
  "/identity",
  "/prekeys",
  "/conversations",
  "/mailbox",
  "/delivery",
  "/attachments",
  "/turn",
] as const;

/** True when the request path belongs to a public (no-requestId) route. */
function isPublicPath(path: string): boolean {
  return matchesPrefix(path, PUBLIC_PREFIXES);
}

/** Exception filter that keeps public route errors free of requestId and internal codes. */
@Catch()
@Injectable()
export class PublicRoutesExceptionsFilter extends AllExceptionsFilter {
  /**
   * Sends an error without requestId for public routes, or delegates other
   * paths to the global filter.
   *
   * @param exception - The thrown value.
   * @param host - Nest's argument host for the current request.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();

    const path = request.url.split("?")[0] ?? "";
    if (!isPublicPath(path)) {
      super.catch(exception, host);
      return;
    }

    const rawStatus = statusOf(exception);
    const statusCode =
      rawStatus !== undefined && rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;

    request.log.error({ statusCode, errorCode: codeOf(exception) }, "Request failed");

    reply.code(statusCode).send(buildErrorBody(statusCode, exception));
  }
}
