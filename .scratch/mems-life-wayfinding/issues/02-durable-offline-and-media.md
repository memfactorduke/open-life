# Durable offline records and private media

Type: research
Status: resolved
Blocked by: None

## Question

How should mobile workout sessions, food photos, and ordinary task edits persist offline and synchronize with the shared service without lost records, duplicated entries, or silent conflict overwrites? Compare bounded operation synchronization with a managed/general replication dependency. Include private media and timer lifecycle behavior on iPhone and iPad.

## Resolution criteria

- Select a concrete first-release persistence/sync strategy and explain its limits.
- Specify conflict, retry, deletion, media-upload, restart, and timer rules at a behavior level.
- Name the operations that need online confirmation and the platform differences that matter.
- Provide primary sources and a testable acceptance boundary; avoid promising impossible iOS background execution.

## Comments

## Answer

Choose mobile Expo SQLite with transactional local records/command outbox, PostgreSQL revision-checked operations and an owner-scoped durable change feed. Preserve conflicting edits for review; use idempotent receipts, tombstones, atomic cursor application, consistent snapshots and restore epochs. Web remains online-first. Private photos use durable local files and a private application filesystem volume on the single Compose host: bounded authenticated staging, checksum/type verification, atomic file rename plus recoverable PostgreSQL finalization, and authorized download endpoints. Back up database and media together during a maintenance window; S3-compatible storage is later optional scope, not a required service. Timers use persisted deadlines and optional local notifications, without promised continuous iOS execution. Agent release/approval and other execution-sensitive operations require online confirmation.

Alternatives, edge cases, current primary sources and the testable acceptance boundary are recorded in [the research note](../research/02-offline-media.md). Resolved means the research is sufficient for specification; no implementation or validation has occurred.
