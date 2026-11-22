import { Controller, Header, Post, Req, UseFilters } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { SessionHeaders } from "../identity/schemas.ts";
import { TurnService } from "./turn.service.ts";
import type { TurnCredentialResponse } from "./turn.service.ts";
import { ServiceUnavailableFilter } from "../admin/service-unavailable.filter.ts";

/** Exposes the authenticated TURN credential endpoint. */
@Controller("turn")
@UseFilters(ServiceUnavailableFilter)
export class TurnController {
  constructor(private readonly turn: TurnService) {}

  /** Issues a short-lived TURN credential bound to the session's device. */
  @Post("credentials")
  @Header("cache-control", "no-store")
  issue(
    @Req() request: FastifyRequest<{ Headers: SessionHeaders }>,
  ): Promise<TurnCredentialResponse> {
    return this.turn.issue(request.headers);
  }
}
