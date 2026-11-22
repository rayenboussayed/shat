import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AttachmentsModule } from "./attachments/attachments.module.ts";
import { ConversationsModule } from "./conversations/conversations.module.ts";
import { DeliveryModule } from "./delivery/delivery.module.ts";
import { HealthController } from "./health.controller.ts";
import { IdentityModule } from "./identity/identity.module.ts";
import { PublicRoutesExceptionsFilter } from "./identity/identity.filter.ts";
import { MailboxModule } from "./mailbox/mailbox.module.ts";
import { SignalingModule } from "./signaling/signaling.module.ts";

/** Root module wiring the health endpoint, error filter, identity and shutdown hook. */
@Module({
  imports: [
    IdentityModule,
    ConversationsModule,
    MailboxModule,
    DeliveryModule,
    AttachmentsModule,
    SignalingModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: PublicRoutesExceptionsFilter,
    },
  ],
})
export class AppModule {}
