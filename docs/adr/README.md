# SHAT ADR index — spec v1.0-draft §14.1

All decisions worth revisiting live as ADRs here. Each ADR file follows
`docs/adr/adr-template.md` and records decision, consequences, evidence and
revisit trigger.

ADR files for the required-ADR list land as their subtasks progress
(spec §14.1). Topics and plan mapping:

| Topic | Subtask |
| --- | --- |
| package manager and monorepo tool | S1 (npm + npm workspaces; spec §14, §18.3) |
| crypto protocol/library | S4 (`packages/crypto` facade; spec §5) |
| local discovery and transport per platform | S17 (spec §3.4, §3.5) |
| WebRTC library | S8 (spec §10, §12) |
| server signaling topology | S7 (spec §3.6, §9.4) |
| push notification policy | S14, S18 (spec §12) |
| database schema strategy | S2 (Drizzle; spec §8.2) |
| Compose/Kubernetes packaging | S22 (spec §16, §17) |
| file storage | S6 (spec §6.3) |
| observability and retention | S9 (spec §13) |

Accepted ADRs:

- [0001 File storage for encrypted attachments](0001-file-storage.md)
- [0002 Server signaling topology and transport](0002-signaling-topology.md)
- [0003 TURN credential policy (coturn not deployed)](0003-turn-credentials.md)
- [0004 Observability, aggregated telemetry and retention](0004-observability-retention.md)

The authoritative required-ADR list lives in [required-adrs.md](required-adrs.md).
