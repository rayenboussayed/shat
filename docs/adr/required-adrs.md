# Required ADRs (spec v1.0-draft §14.1)

Required early, before major implementation. Status is tracked honestly here
and in `docs/adr/README.md`; a topic marked "deferred" has no decision and no
ADR file.

| # | Topic | Status | ADR / evidence |
| --- | --- | --- | --- |
| 1 | Package manager and monorepo tool | Decided (no ADR file) | npm 12 + npm workspaces; `CHANGELOG.md` S1, `package.json` |
| 2 | Crypto protocol/library | Facade accepted; algorithm deferred | [0006](0006-crypto-facade.md) — interface only, no algorithm chosen or certified |
| 3 | Local discovery and transport per platform | Deferred | No transport selected; unverified mobile contracts only |
| 4 | WebRTC library | Deferred | No library selected or certified; contracts only |
| 5 | Server signaling topology | Accepted | [0002](0002-signaling-topology.md), [0003](0003-turn-credentials.md) |
| 6 | Push notification policy | Deferred | No native push integration or provider policy selected |
| 7 | Database schema strategy | Decided (no ADR file) | Drizzle ORM + generated SQL migrations; `packages/database` |
| 8 | Compose/Kubernetes packaging | Accepted | [0005](0005-compose-kubernetes-packaging.md) |
| 9 | File storage | Accepted | [0001](0001-file-storage.md) |
| 10 | Observability and retention | Accepted | [0004](0004-observability-retention.md) |

Topics 1 and 7 were decided during implementation and are recorded in the
changelog and repository tooling rather than in a numbered ADR. Topics 3, 4 and
6 are deferred because their subtasks were outside this build scope; no
decision should be inferred from the presence of unverified adapters.
