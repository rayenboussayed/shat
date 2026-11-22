import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthModule } from "../identity/auth.module.ts";
import { DeliveryController } from "./delivery.controller.ts";
import { DeliveryService } from "./delivery.service.ts";

/** Wires delivery receipt controllers and services with the database module. */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}