# 17: Preserve and synchronize offline workouts

Status: ready-for-agent
State: resolved
Blocked by: 06, 08, 09
Spec: [Mem's Life first release](../spec.md)
Coverage: US-44–47, US-53
Phase: verified implementation with scoped composite execution evidence; external release gates remain in ticket29

## What to build

A full native workout survives weak connectivity, force-quit and synchronization conflicts without losing acknowledged results.

## Acceptance criteria

- [x] Persist native record changes and immutable outbox commands transactionally before showing saved-on-device state.
- [x] Implement ordered per-aggregate retry/idempotency, confirmed-state/local-projection separation and a durable committed change feed with atomic cursor advancement.
- [x] Support consistent snapshot/reset and installation-epoch recovery while retaining pending work; pause automatic replay after epoch change and reconcile previously attempted commands whose receipts may have been lost. Never-sent edits are revalidated, not blindly replayed.
- [x] Preserve conflicting session versions, stop dependent commands and let unrelated records sync; expose reviewed resolution choices.
- [x] Test airplane-mode logging, full storage, forced termination, expired auth, lost server response, concurrent edits and server restore; timers remain honest.
- [x] Test competing committed writers, transaction-preserving pagination, mutations during a consistent snapshot, and termination between page application and cursor advancement.

## Verification

Record and finish offline, kill/relaunch, edit the same session on another client, reconnect and resolve without lost or duplicated sets.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Independent checkout passes real Node SQLite recovery seams plus actual HTTP/PostgreSQL backup/restore (`verify-offline-live.mjs`); canonical sync tests cover committed feed/snapshot boundaries. The receipt explicitly excludes the actual Expo driver/force-quit gate.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 17.1/17.2/17.6: [actual SQLite/HTTP/PG recovery execution](../evidence/offline-live/protocol-proof.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); real PG feed tests and executed `verify-sync-cursor-recovery.mjs`/`verify-native-offline.mjs` cover atomic record/outbox/cursor storage, committed-writer ordering, page transaction integrity and crash recovery. Actual Expo SQLite snapshots and private bytes match across termination/relaunch (`native-gym-food/sqlite-fixed-release/offline-durability-assertion.json`); later cold offline launches preserve exact commands (`cold-start-release/final-offline-durability-assertion.json`) and converge once. 17.3–17.5 remain pending for current native epoch/conflict/expired-auth recovery, rather than missing cold-start evidence.

Evidence: Current native recovery reconciliation (2026-10-13). 17.3–17.5 now have current real native recovery evidence combined with existing protocol proofs. `native-gym-food/photo-fixed-release/conflict-final-assertion.json` records immutable stale expected-revision3 payload, explicit native review/resubmission with a fresh expected-revision4 operation, unique retained3×22/4×23/server6×24/reviewed5×25 actuals and unrelated task synchronization during the conflict. `revoked-task-pending-assertion.json`/`revoked-task-server-convergence.json` plus denial/reauth captures establish real401 stopping cached-identity use while retaining an immutable command through restart, then one-history reauthentication recovery. Actual Expo SQLite capacity failure in `native-gym-food/capacity-probe/after-actual-full-failure.json`, `server-convergence.json` and `restoration.json` preserves input, refuses false saved acknowledgement/outbox allocation, converges once after capacity recovery and restores baseline bytes. New rollback error-preservation regression has131 passing mobile tests/24 suites in `.runtime/final-mobile-storage-tests.log`, not added to historical counts. Supported independent restore and current native paused/resume assertions are linked below. Offline logging uses an actually stopped service to exercise the same unreachable-service behavior as airplane mode; no physical radio/airplane-mode switch is claimed. Actual lost-response/replay/attempted-epoch semantics remain established by the executed SQLite/HTTP/PG receipt, while actual native tests establish driver/lifecycle/UI parity. Ticket08 notification prerequisite remains open.

Evidence: Dependency reconciliation (2026-10-13). All literal criteria are verified by the scoped receipts above; all listed prerequisites are now resolved. State resolved. External physical/live-provider gates remain in29 and are not inferred from this resolution.
