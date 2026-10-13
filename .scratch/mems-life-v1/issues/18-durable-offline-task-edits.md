# 18: Preserve ordinary task edits offline

Status: ready-for-agent
State: claimed
Blocked by: 05, 07, 15, 17
Spec: [Mem's Life first release](../spec.md)
Coverage: US-21
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

Native task capture and ordinary edits work offline while execution-sensitive actions wait for the service.

## Acceptance criteria

- [x] Cache useful task views and preserve new Planned tasks, descriptions and ordinary edits in the durable outbox.
- [x] Clearly distinguish saved locally, pending, synced and conflicted state.
- [x] Require online confirmation for release and changes/completion that can trigger agent work; do not falsely show those effects as committed. Artifact-approval offline gating is verified by the versioned-deliverable ticket.
- [x] Handle edit/delete races and recurrence conflicts without resurrecting tombstoned work or fabricating occurrence completion.
- [x] Respect account partitions and pending changes on logout; web remains honestly online-first.

## Verification

Capture and edit tasks offline in a dataset containing a released mixed workflow, attempt a forbidden release/completion, reconnect after a competing delete and preserve rejected content for review without advancing agent work.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Independent checkout includes offline projection/outbox, online-sensitive gating and recovery component tests plus actual Node SQLite/HTTP recovery scripts. PostgreSQL synchronization and task revision/tombstone behavior are passing service coverage.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 18.1/18.2/18.4: [actual SQLite/HTTP/PG recovery execution](../evidence/offline-live/protocol-proof.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); actual Expo offline task creation/relaunch/resync and SQLite identities are in `native-gym-food/cold-start-release/final-offline-durability-assertion.json` and `final-server-convergence.json`. Executed SQLite recovery/domain/PG assertions preserve local/confirmed/conflict states, tombstones and recurrence history. 18.3/18.5 retain the concrete native consequential-action/logout/expired-auth proof boundary; component policy checks alone are not an OS account lifecycle claim.

Evidence: Current native recovery reconciliation (2026-10-13). 18.3/18.5 now qualify by composite policy and actual native account recovery proof: executed `verify-native-offline.mjs` rejects execution-sensitive changes, preserves pending work across logout and verifies isolated account partitions; current client/session-bootstrap assertions and later real revoked-session denial/reauth captures preserve immutable pending task operation06b8520d through termination and record exactly one server history event after sign-in (`native-gym-food/photo-fixed-release/revoked-task-pending-assertion.json`, `revoked-task-server-convergence.json`). Real native cached identity is closed after401; ordinary offline views are not treated as an active authorized session. Online-only artifact approval is independently verified by ticket20 fresh actual browser/PG receipt. This combines a real OS account journey with deterministic policy/partition tests; it does not invent a second native logout journey. All literal criteria qualify; State awaits ticket17.
