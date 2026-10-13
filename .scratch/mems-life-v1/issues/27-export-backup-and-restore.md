# 27: Export, back up and restore personal records

Status: ready-for-agent
State: resolved
Blocked by: 18, 22, 24
Spec: [Mem's Life first release](../spec.md)
Coverage: US-04–05, US-67
Phase: verified implementation with scoped composite execution evidence; external release gates remain in ticket29

## What to build

Keep usable data exports and recover an installation with matching database/media state and intact offline clients.

## Acceptance criteria

- [x] Export owner records and attachments in a documented machine-readable format, excluding passwords, tokens and private configuration secrets.
- [x] Provide a coherent maintenance-window backup: pause mutations/uploads/cleanup, drain in-flight work, then dump PostgreSQL and archive private media plus separately protected configuration. Verify restored attachment checksums.
- [x] Restore into an independent test installation, rotate its synchronization epoch, pause replay and retain pending edits. Reconcile previously sent/uncertain commands whose idempotency receipts may have disappeared, then revalidate never-sent work.
- [x] Test migrations from an earlier fixture schema and define failure/rollback recovery rather than silently starting empty.
- [x] Document retention/deletion effects and prevent cleanup from deleting referenced or pending media.

## Verification

Export a mixed dataset, commit a command after the backup and lose its response, restore the backup, reconnect that client plus a never-sent edit, and verify reconciliation avoids duplicate external effects.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Actual PostgreSQL portability test verifies secret-free export and coherent maintenance DB/media backup. Final app/operator container receipt verifies independent database/media restore, matching migrations, protected archive/config/dump, rotated epoch, checksum/byte preservation and explicit maintenance resume. Independent Node SQLite/HTTP recovery script separately exercises restored-epoch command reconciliation.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe final-container receipt](../evidence/release-safe/receipts/final-container--verification.json) identifies actual app/operator images and independent backup/restore; no public deployment or mobile runtime claim.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 27.1/27.2/27.4/27.5: [final independent container/restore execution](../evidence/final-container/verification.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), `migration-reconciliation/verification.md`, executed PG `portability.test.ts`/`release-reconciliation.test.ts` and SQLite/photo recovery scripts. Independent database/media restore, protected checksums/config, epoch rotation, earlier-schema row preservation and atomic upgrade failure, reference-safe cleanup and documented retention are established. 27.3 awaits actual current Expo attempted/never-sent recovery after restore; Node/HTTP protocol evidence is real but its deviceProof=false boundary is preserved.

Evidence: Current native recovery reconciliation (2026-10-13). 27.3 now qualifies by supported independent restore plus actual native epoch review. [Independent native-target restore](../evidence/native-restore-proof/complete.json) verifies preserved installation identity, rotated target epoch, matching domain tables/media and unchanged original records/media. [Actual native paused epoch](../evidence/native-gym-food/recovery-final-release/epoch-paused-assertion.json) preserves never-sent operation115b4410/payload/expectedRevision0 at attempts0, pauses replay and observes target404 before owner review. [Explicit checked-send/resume](../evidence/native-gym-food/recovery-final-release/epoch-final-assertion.json) retains operation/payload, confirms once with attempts1/history1 and releases pause; `epoch-restored-target-server.json` identifies the exact target record. Existing actual SQLite/HTTP/PG restore proof separately deletes post-backup receipts and reconciles previously attempted uncertain operations before fresh reviewed work. This is explicitly composite attempted/never-sent coverage, not a claim that every attempted-operation branch ran on native hardware. Current native source c6a295/JS537465 identities are in recovery-final-release/build-hashes.json. Original database/epoch is separately preserved and restored target changes do not modify original installation. All criteria qualify; State awaits18/22.

Evidence: Dependency reconciliation (2026-10-13). All literal criteria are verified by the scoped receipts above; all listed prerequisites are now resolved. State resolved. External physical/live-provider gates remain in29 and are not inferred from this resolution.
