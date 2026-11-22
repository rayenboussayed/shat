import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthModule } from "./auth.module.ts";
import { DeviceService } from "./device.service.ts";
import { IdentityController } from "./identity.controller.ts";
import { PrekeyService } from "./prekey.service.ts";

/** Wires identity controllers and services with the database module. */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [IdentityController],
  providers: [DeviceService, PrekeyService],
})
export class IdentityModule {}