import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import { RouteSchema } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConversationsService } from "./conversations.service.ts";
import type {
  ConversationCreateBody,
  ConversationsQuery,
  SessionHeaders,
} from "./schemas.ts";
import {
  conversationCreateBodySchema,
  conversationsQuerySchema,
} from "./schemas.ts";

type BodyRequest<B> = FastifyRequest<{ Body: B; Headers: SessionHeaders }>;
type QueryRequest<Q> = FastifyRequest<{ Querystring: Q; Headers: SessionHeaders }>;

/** Maps conversation endpoints onto the service. */
@Controller()
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** Creates a direct conversation. */
  @Post("conversations")
  @RouteSchema({ body: conversationCreateBodySchema })
  async createConversation(
    @Req() request: BodyRequest<ConversationCreateBody>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.conversations.createConversation(request.headers, request.body);
    await reply.code(result.status).send(result.body);
  }

  /** Lists conversations for the actor's device. */
  @Get("conversations")
  @RouteSchema({ querystring: conversationsQuerySchema })
  async listConversations(
    @Req() request: QueryRequest<ConversationsQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.conversations.listConversations(request.headers, request.query ?? {});
    await reply.code(result.status).send(result.body);
  }
}