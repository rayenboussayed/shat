import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.ts";
import { AuthService } from "./auth.service.ts";

/** Single home for session authentication, shared by every module that needs it. */
@Module({
  imports: [DatabaseModule],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
