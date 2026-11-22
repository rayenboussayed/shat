# SHAT Dashboard

React + TypeScript operations shell for the SHAT backend.

## Status

- Health indicator queries `GET /health` through the typed `shat-api-types` client.
- Operations metrics panel is an honest placeholder: live telemetry is not
  wired into this dashboard yet. The backend exposes `GET /telemetry/summary`,
  but this UI does not consume it, so no statistics are fabricated.
- Backend route list is derived from the generated OpenAPI `paths` type.

## Security

Admin authentication is not implemented. Do not expose this app publicly
without adding authentication and authorization in front of it.