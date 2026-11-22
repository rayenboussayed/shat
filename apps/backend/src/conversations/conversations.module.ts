import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthModule } from "../identity/auth.module.ts";
import { ConversationsController } from "./conversations.controller.ts";
import { ConversationsService } from "./conversations.service.ts";

/** Wires conversation controllers and services with the database module. */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}