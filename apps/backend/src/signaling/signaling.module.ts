import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthModule } from "../identity/auth.module.ts";
import { CallRegistry } from "./call-state.ts";
import { ConnectionRegistry } from "./connections.ts";
import { ReplayGuard } from "./guards.ts";
import { SignalingGateway } from "./signaling.gateway.ts";
import { SignalingService } from "./signaling.service.ts";

/** Wires the signaling gateway with its in-memory call, presence and replay state. */
@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [ConnectionRegistry, CallRegistry, ReplayGuard, SignalingService, SignalingGateway],
})
export class SignalingModule {}
