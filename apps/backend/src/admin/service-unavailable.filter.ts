import { Catch, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { matchesPrefix } from "../path-matching.ts";

/** Operator route prefixes whose 503 bodies carry requestId, like the global envelope. */
const OPERATOR_PREFIXES = ["/admin", "/telemetry"] as const;

/** True for operator routes; public routes such as /turn keep the identity envelope without requestId. */
function isOperatorPath(path: string): boolean {
  return matchesPrefix(path, OPERATOR_PREFIXES);
}

/**
 * Sends 503 responses unchanged. The shared error filters collapse every 5xx into a generic
 * 500, which would hide fail-closed configuration and readiness answers. Only
 * ServiceUnavailableException is handled here; other errors reach the shared filters.
 *
 * Shared by turn/, telemetry/ and admin/ routes. Envelope deviation: operator routes
 * (/admin, /telemetry) add requestId, matching the global envelope; the public /turn route
 * does not, matching PublicRoutesExceptionsFilter. Moving this filter to a neutral location
 * needs coordinator approval.
 */
@Catch(ServiceUnavailableException)
export class ServiceUnavailableFilter implements ExceptionFilter {
  private readonly logger = new Logger(ServiceUnavailableFilter.name);

  /** Replies 503 with the exception's own response body, which carries no secrets. */
  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    this.logger.warn(exception.message);

    const response = exception.getResponse();
    const body = typeof response === "string" ? { statusCode: 503, message: response } : response;
    const path = request.url.split("?")[0] ?? "";
    reply.code(503).send(isOperatorPath(path) ? { ...body, requestId: request.id } : body);
  }
}
