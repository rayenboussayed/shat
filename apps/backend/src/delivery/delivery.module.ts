import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import { DeliveryController } from "./delivery.controller.ts";
import { DeliveryService } from "./delivery.service.ts";

/** Wires delivery receipt controllers and services with the database module. */
@Module({
  imports: [DatabaseModule],
  controllers: [DeliveryController],
  providers: [AuthService, DeliveryService],
})
export class DeliveryModule {}