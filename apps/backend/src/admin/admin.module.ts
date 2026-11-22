import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { DatabaseModule } from "../db/db.ts";
import { AuthModule } from "../identity/auth.module.ts";
import { ADMIN_CONFIG, loadAdminConfig } from "./admin.config.ts";
import { AdminGuard } from "./admin.guard.ts";
import { AdminHealthController } from "./admin.controller.ts";
import { DatabaseHealthIndicator } from "./database.health.ts";

/** Wires operator health routes, the admin token guard and the database readiness probe. */
@Module({
  imports: [DatabaseModule, AuthModule, TerminusModule.forRoot()],
  controllers: [AdminHealthController],
  providers: [
    AdminGuard,
    DatabaseHealthIndicator,
    {
      provide: ADMIN_CONFIG,
      useFactory: () => loadAdminConfig(),
    },
  ],
  exports: [AdminGuard, AuthModule, ADMIN_CONFIG],
})
export class AdminModule {}
