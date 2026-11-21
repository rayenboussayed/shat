import { Controller, Get, Req, Res } from "@nestjs/common";
import { RouteSchema } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DeliveryService } from "./delivery.service.ts";
import type { DeliveryReceiptsQuery, SessionHeaders } from "../mailbox/schemas.ts";
import { deliveryReceiptsQuerySchema } from "../mailbox/schemas.ts";

type QueryRequest<Q> = FastifyRequest<{ Querystring: Q; Headers: SessionHeaders }>;

/** Maps delivery receipt endpoints onto the service. */
@Controller()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  /** Lists delivery receipts for envelopes the actor sent. */
  @Get("delivery/receipts")
  @RouteSchema({ querystring: deliveryReceiptsQuerySchema })
  async listReceipts(
    @Req() request: QueryRequest<DeliveryReceiptsQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.delivery.listReceipts(request.headers, request.query ?? {});
    await reply.code(result.status).send(result.body);
  }
}