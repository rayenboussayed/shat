import { Controller, Get } from "@nestjs/common";
import { RouteConfig, RouteSchema } from "@nestjs/platform-fastify";

const healthResponseSchema = {
  type: "object",
  properties: {
    status: { const: "ok" },
  },
  required: ["status"],
  additionalProperties: false,
} as const;

/** Exposes the liveness endpoint used by local health checks and Compose. */
@Controller()
export class HealthController {
  /**
   * Returns the service liveness status.
   *
   * @returns A payload whose status is always "ok".
   */
  @Get("health")
  @RouteConfig({ rateLimit: false })
  @RouteSchema({ response: { 200: healthResponseSchema } })
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}
