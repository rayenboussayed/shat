import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import { RouteSchema } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { MailboxService } from "./mailbox.service.ts";
import type {
  MailboxAckBody,
  MailboxAckParams,
  MailboxCreateBody,
  MailboxQuery,
  SessionHeaders,
} from "./schemas.ts";
import {
  mailboxAckBodySchema,
  mailboxAckParamsSchema,
  mailboxCreateBodySchema,
  mailboxQuerySchema,
} from "./schemas.ts";

type BodyRequest<B> = FastifyRequest<{ Body: B; Headers: SessionHeaders }>;
type QueryRequest<Q> = FastifyRequest<{ Querystring: Q; Headers: SessionHeaders }>;
/** Maps mailbox endpoints onto the service. */
@Controller()
export class MailboxController {
  constructor(private readonly mailbox: MailboxService) {}

  /** Submits a ciphertext envelope. */
  @Post("mailbox")
  @RouteSchema({ body: mailboxCreateBodySchema })
  async createMessage(
    @Req() request: BodyRequest<MailboxCreateBody>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.mailbox.createMessage(request.headers, request.body);
    await reply.code(result.status).send(result.body);
  }

  /** Polls queued envelopes for the recipient device. */
  @Get("mailbox")
  @RouteSchema({ querystring: mailboxQuerySchema })
  async pollMessages(
    @Req() request: QueryRequest<MailboxQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.mailbox.pollMessages(request.headers, request.query ?? {});
    await reply.code(result.status).send(result.body);
  }

  /** Acknowledges a mailbox message. */
  @Post("mailbox/:id/ack")
  @RouteSchema({ params: mailboxAckParamsSchema, body: mailboxAckBodySchema })
  async ackMessage(
    @Req()
    request: FastifyRequest<{
      Params: MailboxAckParams;
      Body: MailboxAckBody;
      Headers: SessionHeaders;
    }>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.mailbox.ackMessage(
      request.headers,
      request.params,
      request.body ?? {},
    );
    await reply.code(result.status).send(result.body);
  }
}