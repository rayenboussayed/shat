# ADR 0004: Observability, aggregated telemetry and retention
- Status: Accepted
- Date: 2026-11-22
- Owner: SHAT backend

## Context
Spec §13 requires operational visibility without collecting message content or
user-linked metadata. The backend needs liveness and readiness probes, and operators
need counts of requests, failures, devices and stored ciphertext. The product's
privacy stance rules out per-user logs, raw IP addresses and message-level metrics.

## Options considered
- OpenTelemetry SDK with an exporter: rich, but adds packages and a collector, and
  makes it easy to attach attributes that identify users.
- NestJS Observe (`@nestjs/observe`): would send traces and errors to a third party,
  which conflicts with the privacy stance. It was not adopted and is not installed.
- In-process aggregated counters with allowlisted names, an admin-only summary and
  Terminus health checks: no new services, and the data shape is fixed in code.

## Decision
- Health: `GET /health` is public liveness with no dependencies. The operator routes
  `GET /admin/health/live` (no dependencies) and `GET /admin/health/ready` (database
  probe, 2 s timeout) use `@nestjs/terminus` v12 `HealthIndicatorService`. Readiness
  failures report the generic message `The database is unreachable`, so driver errors
  do not leak. The ERROR-level readiness log line comes from the `ServiceUnavailableFilter`
  warn, not from Terminus configuration; no Terminus logger settings were added.
- Admin access: `SHAT_ADMIN_TOKEN` must be at least 32 characters **and** at least
  16 distinct characters; the shared `readSecretEnv` helper in
  `apps/backend/src/admin/env-secret.ts` enforces both. It is compared in constant
  time through `x-admin-token`. Missing, short or repetitive configuration returns 503
  and never grants access.
- Counters: `TelemetryStore` accepts only `requests` and `errors` (failed HTTP
  responses, plus the aggregated totals below). It rejects other names and non-integer
  amounts at runtime, so identifiers, addresses, keys and content cannot be recorded.
  Counting lives in `TelemetryMiddleware`, not an interceptor: Nest guards run before
  interceptors, so an interceptor would miss every admin 401 and 503.
- Retention: counters are kept per fixed one-hour window and dropped at rollover.
  Totals come from the database as counts and byte sums; no identifiers are selected.
- `GET /telemetry/summary` returns the window bounds, the two counters, `enrolledDevices`
  (non-revoked devices), `files` and `fileBytes` (live attachments). Requires the admin
  token.
- Logs: `apps/backend/src/app.ts` already configures Fastify logger redaction for
  authorization, cookies, API keys and `*.password` / `*.secret` / `*.token` fields;
  that redaction stays in force. Telemetry never logs values.
- Scheduled purge and sweeps stay interface entry points only; no broker or cron is
  added.

## Consequences
- Restarting the process clears in-window counters. Summaries are approximate by
  design and are not an audit trail.
- Counters are per process; with more than one instance, each reports its own window
  until a shared store exists (spec §9.5 is still open).
- The admin token is a single shared secret. Rotation means changing the environment
  variable and restarting.
- A failed readiness check is logged by `ServiceUnavailableFilter` (`logger.warn`)
  with the generic message only; no Terminus logging configuration is in scope here.

## Evidence and sources
- Spec §13 (observability), §14.1 (required ADR "observability and retention").
- NestJS Terminus v12 health check docs (`/reliability/terminus`): `HealthIndicatorService`,
  `attempt().withTimeout().withFailureData()`, `up()`/`down()`, liveness without
  indicators.
- Implementation: `apps/backend/src/{admin,telemetry}/`, tests in
  `apps/backend/tests/unit/{admin,telemetry}.test.ts`.

## Revisit trigger
- A second backend instance is run, or a shared metrics store is adopted.
- The spec adds a required metric that cannot be aggregated this way.
- Legal or operational need for longer retention, which would require a new ADR.
