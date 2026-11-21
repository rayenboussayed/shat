import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import { ConversationsController } from "./conversations.controller.ts";
import { ConversationsService } from "./conversations.service.ts";

/** Wires conversation controllers and services with the database module. */
@Module({
  imports: [DatabaseModule],
  controllers: [ConversationsController],
  providers: [AuthService, ConversationsService],
})
export class ConversationsModule {}