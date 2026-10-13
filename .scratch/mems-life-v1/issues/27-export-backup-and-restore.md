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

- [x] Export owner records and attachments in a documented machine-readable format, excluding passwords, tokens and private configuration secrets.
- [x] Provide a coherent maintenance-window backup: pause mutations/uploads/cleanup, drain in-flight work, then dump PostgreSQL and archive private media plus separately protected configuration. Verify restored attachment checksums.
- [ ] Restore into an independent test installation, rotate its synchronization epoch, pause replay and retain pending edits. Reconcile previously sent/uncertain commands whose idempotency receipts may have disappeared, then revalidate never-sent work.
- [ ] Test migrations from an earlier fixture schema and define failure/rollback recovery rather than silently starting empty.
- [ ] Document retention/deletion effects and prevent cleanup from deleting referenced or pending media.

## Verification

Export a mixed dataset, commit a command after the backup and lose its response, restore the backup, reconnect that client plus a never-sent edit, and verify reconciliation avoids duplicate external effects.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Actual PostgreSQL portability test verifies secret-free export and coherent maintenance DB/media backup. Final app/operator container receipt verifies independent database/media restore, matching migrations, protected archive/config/dump, rotated epoch, checksum/byte preservation and explicit maintenance resume. Independent Node SQLite/HTTP recovery script separately exercises restored-epoch command reconciliation.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe final-container receipt](../evidence/release-safe/receipts/final-container--verification.json) identifies actual app/operator images and independent backup/restore; no public deployment or mobile runtime claim.

Evidence remaining: Actual current Expo pending/previously-attempted/never-sent work convergence after independent restore remains. Do not infer native exactly-once external effects from epoch rotation. Earlier-schema migration evidence is historical and needs source-boundary review; tickets 18/22/24 remain prerequisites. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
