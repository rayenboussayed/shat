import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import { AttachmentsController } from "./attachments.controller.ts";
import { AttachmentsService } from "./attachments.service.ts";
import { ATTACHMENT_CAPABILITY_KEY, loadCapabilityKey } from "./capability.ts";
import { ATTACHMENT_STORAGE, FileSystemAttachmentStorage, resolveStorageDirectory } from "./storage.ts";

/** Wires attachment controllers, services, the blob store and the capability key. */
@Module({
  imports: [DatabaseModule],
  controllers: [AttachmentsController],
  providers: [
    AuthService,
    AttachmentsService,
    {
      provide: ATTACHMENT_STORAGE,
      useFactory: () => new FileSystemAttachmentStorage(resolveStorageDirectory()),
    },
    {
      provide: ATTACHMENT_CAPABILITY_KEY,
      useFactory: () => loadCapabilityKey(),
    },
  ],
})
export class AttachmentsModule {}
