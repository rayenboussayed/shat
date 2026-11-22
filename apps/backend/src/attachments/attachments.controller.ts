import { Controller, Delete, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { RouteSchema } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AttachmentsService } from "./attachments.service.ts";
import type {
  AttachmentCapability,
  AttachmentCreateBody,
  AttachmentCreated,
  AttachmentDownloadQuery,
  AttachmentParams,
  SessionHeaders,
} from "./schemas.ts";
import {
  attachmentCreateBodySchema,
  attachmentDownloadQuerySchema,
  attachmentParamsSchema,
} from "./schemas.ts";

type SessionRequest<Extra extends object = object> = FastifyRequest<
  { Headers: SessionHeaders } & Extra
>;

/** Maps attachment endpoints onto the service. */
@Controller("attachments")
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** Uploads a ciphertext blob owned by the session's device. */
  @Post()
  @RouteSchema({ body: attachmentCreateBodySchema })
  create(
    @Req() request: SessionRequest<{ Body: AttachmentCreateBody }>,
  ): Promise<AttachmentCreated> {
    return this.attachments.create(request.headers, request.body);
  }

  /** Streams ciphertext for a valid, unexpired download capability. Needs no session. */
  @Get("download")
  @RouteSchema({ querystring: attachmentDownloadQuerySchema })
  async download(
    @Req() request: FastifyRequest<{ Querystring: AttachmentDownloadQuery }>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const bytes = await this.attachments.download(request.query.token);
    await reply
      .header("cache-control", "no-store")
      .type("application/octet-stream")
      .send(bytes);
  }

  /** Issues a short-lived download capability for an attachment the caller owns. */
  @Get(":id")
  @RouteSchema({ params: attachmentParamsSchema })
  capability(
    @Req() request: SessionRequest<{ Params: AttachmentParams }>,
  ): Promise<AttachmentCapability> {
    return this.attachments.createCapability(request.headers, request.params.id);
  }

  /** Deletes an attachment the caller owns, including its blob. */
  @Delete(":id")
  @HttpCode(204)
  @RouteSchema({ params: attachmentParamsSchema })
  remove(@Req() request: SessionRequest<{ Params: AttachmentParams }>): Promise<void> {
    return this.attachments.remove(request.headers, request.params.id);
  }
}
