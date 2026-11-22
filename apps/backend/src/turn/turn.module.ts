import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import { TurnController } from "./turn.controller.ts";
import { TURN_CONFIG, loadTurnConfig } from "./turn.config.ts";
import { TurnService } from "./turn.service.ts";

/** Wires the TURN credential endpoint, its service and the environment configuration. */
@Module({
  imports: [DatabaseModule],
  controllers: [TurnController],
  providers: [
    AuthService,
    TurnService,
    {
      provide: TURN_CONFIG,
      useFactory: () => loadTurnConfig(),
    },
  ],
})
export class TurnModule {}
