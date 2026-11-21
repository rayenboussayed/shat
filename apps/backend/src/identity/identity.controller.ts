import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import { RouteSchema } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DeviceService } from "./device.service.ts";
import { PrekeyService } from "./prekey.service.ts";
import type {
  DeviceBody,
  DevicesQuery,
  DeviceParams,
  DeviceQuery,
  PrekeyBody,
  OneTimePrekeyBody,
  SessionHeaders,
} from "./schemas.ts";
import {
  deviceCreateBodySchema,
  devicesQuerySchema,
  deviceParamsSchema,
  deviceQuerySchema,
  signedPrekeyBodySchema,
  oneTimePrekeyBodySchema,
  claimPrekeyBodySchema,
} from "./schemas.ts";

type BodyRequest<B, H = SessionHeaders> = FastifyRequest<{ Body: B; Headers: H }>;
type QueryRequest<Q> = FastifyRequest<{ Querystring: Q; Headers: SessionHeaders }>;
type ParamsRequest<P> = FastifyRequest<{ Params: P; Headers: SessionHeaders }>;

/** Maps the eight identity and prekey endpoints onto injectable services. */
@Controller()
export class IdentityController {
  constructor(
    private readonly devices: DeviceService,
    private readonly prekeys: PrekeyService,
  ) {}

  /** Enrolls a device under the configured bootstrap account. */
  @Post("identity/devices")
  @RouteSchema({ body: deviceCreateBodySchema })
  async createDevice(
    @Req() request: BodyRequest<DeviceBody>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.devices.createDevice(request.body, request.headers);
    await reply.code(result.status).send(result.body);
  }

  /** Lists the devices belonging to a user. */
  @Get("identity/devices")
  @RouteSchema({ querystring: devicesQuerySchema })
  async listDevices(
    @Req() request: QueryRequest<DevicesQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.devices.listDevices(request.headers, request.query);
    await reply.code(result.status).send(result.body);
  }

  /** Revokes a device and its sessions. */
  @Post("identity/devices/:deviceId/revoke")
  @RouteSchema({ params: deviceParamsSchema })
  async revokeDevice(
    @Req() request: ParamsRequest<DeviceParams>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.devices.revokeDevice(request.headers, request.params);
    await reply.code(result.status).send(result.body);
  }

  /** Returns one device and its identity key. */
  @Get("identity/device")
  @RouteSchema({ querystring: deviceQuerySchema })
  async getDevice(
    @Req() request: QueryRequest<DeviceQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.devices.getDevice(request.headers, request.query);
    await reply.code(result.status).send(result.body);
  }

  /** Publishes the current signed prekey for the authenticated device. */
  @Post("prekeys/publish")
  @RouteSchema({ body: signedPrekeyBodySchema })
  async publishSignedPrekey(
    @Req() request: BodyRequest<PrekeyBody>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.prekeys.publishSignedPrekey(request.headers, request.body);
    await reply.code(result.status).send(result.body);
  }

  /** Publishes a bounded batch of one-time prekeys. */
  @Post("prekeys/one-time")
  @RouteSchema({ body: oneTimePrekeyBodySchema })
  async publishOneTimePrekeys(
    @Req() request: BodyRequest<OneTimePrekeyBody>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.prekeys.publishOneTimePrekeys(request.headers, request.body);
    await reply.code(result.status).send(result.body);
  }

  /** Atomically claims one one-time prekey for a recipient. */
  @Post("prekeys/claim")
  @RouteSchema({ body: claimPrekeyBodySchema })
  async claimOneTimePrekey(
    @Req() request: BodyRequest<DeviceQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.prekeys.claimOneTimePrekey(request.headers, request.body);
    await reply.code(result.status).send(result.body);
  }

  /** Returns the latest signed prekey for a device. */
  @Get("prekeys/signed")
  @RouteSchema({ querystring: deviceQuerySchema })
  async getSignedPrekey(
    @Req() request: QueryRequest<DeviceQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.prekeys.getSignedPrekey(request.headers, request.query);
    await reply.code(result.status).send(result.body);
  }
}
