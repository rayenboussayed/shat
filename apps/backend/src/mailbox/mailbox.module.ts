import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthModule } from "../identity/auth.module.ts";
import { MailboxController } from "./mailbox.controller.ts";
import { MailboxService } from "./mailbox.service.ts";

/** Wires mailbox controllers and services with the database module. */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MailboxController],
  providers: [MailboxService],
})
export class MailboxModule {}