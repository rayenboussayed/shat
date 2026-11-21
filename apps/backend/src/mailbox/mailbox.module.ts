import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import { MailboxController } from "./mailbox.controller.ts";
import { MailboxService } from "./mailbox.service.ts";

/** Wires mailbox controllers and services with the database module. */
@Module({
  imports: [DatabaseModule],
  controllers: [MailboxController],
  providers: [AuthService, MailboxService],
})
export class MailboxModule {}