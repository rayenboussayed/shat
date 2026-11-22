import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../identity/auth.service.ts";
import { ADMIN_CONFIG } from "./admin.config.ts";
import type { AdminConfig } from "./admin.config.ts";

/** Header carrying the admin token. */
const ADMIN_TOKEN_HEADER = "x-admin-token";

/**
 * Guards operator routes with the SHAT_ADMIN_TOKEN shared secret. Fails closed with 503
 * when no token is configured, and with 401 when the presented token does not match.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(ADMIN_CONFIG) private readonly config: AdminConfig,
    private readonly auth: AuthService,
  ) {}

  /** Allows the request only when the admin token matches in constant time. */
  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.token;
    if (expected === undefined) {
      throw new ServiceUnavailableException("Admin access is not configured");
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const presented = request.headers[ADMIN_TOKEN_HEADER];
    if (typeof presented !== "string" || !this.auth.matchesUtf8(presented, expected)) {
      throw new UnauthorizedException("Authentication is required");
    }
    return true;
  }
}
