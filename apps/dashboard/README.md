# SHAT Dashboard

React + TypeScript operations shell for the SHAT backend.

## Status

- Health indicator queries `GET /health` through the typed `shat-api-types` client.
- Operations metrics panel is an honest placeholder: the backend exposes no
  telemetry endpoints yet, so no statistics are fabricated.
- Backend route list is derived from the generated OpenAPI `paths` type.

## Security

Admin authentication is not implemented. Do not expose this app publicly
without adding authentication and authorization in front of it.