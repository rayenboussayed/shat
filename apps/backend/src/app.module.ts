import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { HealthController } from "./health.controller.ts";
import { IdentityModule } from "./identity/identity.module.ts";
import { IdentityExceptionsFilter } from "./identity/identity.filter.ts";

/** Root module wiring the health endpoint, error filter, identity and shutdown hook. */
@Module({
  imports: [IdentityModule],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: IdentityExceptionsFilter,
    },
  ],
})
export class AppModule {}
