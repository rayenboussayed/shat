import type { FastifyInstance } from "fastify";

/**
 * Compatibility shim retained for `buildApp`. Identity routes are now registered
 * by `IdentityModule` through NestJS, so this no longer mutates the Fastify
 * instance.
 */
export function registerIdentityRoutes(_app: FastifyInstance): void {
  void _app;
  // Intentionally empty: routes are provided by Nest controllers.
}
