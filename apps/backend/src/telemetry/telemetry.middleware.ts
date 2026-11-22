import { Inject, Injectable } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TELEMETRY_STORE, TelemetryStore } from "./telemetry.store.ts";

/**
 * Counts every HTTP request and each response with a 4xx or 5xx status. Runs before guards,
 * so rejected requests are counted too. Only counts are kept, never paths or headers.
 */
@Injectable()
export class TelemetryMiddleware implements NestMiddleware {
  constructor(@Inject(TELEMETRY_STORE) private readonly store: TelemetryStore) {}

  /** Records the request and, once the response finishes, any error status. */
  use(_request: IncomingMessage, response: ServerResponse, next: () => void): void {
    this.store.increment("requests");
    response.once("finish", () => {
      if (response.statusCode >= 400) {
        this.store.increment("errors");
      }
    });
    next();
  }
}
