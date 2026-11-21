import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthService } from "./auth.service.ts";
import { DeviceService } from "./device.service.ts";
import { IdentityController } from "./identity.controller.ts";
import { PrekeyService } from "./prekey.service.ts";

/** Wires identity controllers and services with the database module. */
@Module({
  imports: [DatabaseModule],
  controllers: [IdentityController],
  providers: [AuthService, DeviceService, PrekeyService],
})
export class IdentityModule {}