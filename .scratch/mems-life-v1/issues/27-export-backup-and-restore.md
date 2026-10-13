# 27: Export, back up and restore personal records

Status: ready-for-agent
State: claimed
Blocked by: 18, 22, 24
Spec: [Mem's Life first release](../spec.md)
Coverage: US-04–05, US-67
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

Keep usable data exports and recover an installation with matching database/media state and intact offline clients.

## Acceptance criteria

- [ ] Export owner records and attachments in a documented machine-readable format, excluding passwords, tokens and private configuration secrets.
- [ ] Provide a coherent maintenance-window backup: pause mutations/uploads/cleanup, drain in-flight work, then dump PostgreSQL and archive private media plus separately protected configuration. Verify restored attachment checksums.
- [ ] Restore into an independent test installation, rotate its synchronization epoch, pause replay and retain pending edits. Reconcile previously sent/uncertain commands whose idempotency receipts may have disappeared, then revalidate never-sent work.
- [ ] Test migrations from an earlier fixture schema and define failure/rollback recovery rather than silently starting empty.
- [ ] Document retention/deletion effects and prevent cleanup from deleting referenced or pending media.

## Verification

Export a mixed dataset, commit a command after the backup and lose its response, restore the backup, reconnect that client plus a never-sent edit, and verify reconciliation avoids duplicate external effects.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
