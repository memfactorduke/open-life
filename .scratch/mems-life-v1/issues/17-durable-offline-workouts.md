# 17: Preserve and synchronize offline workouts

Status: ready-for-agent
State: claimed
Blocked by: 06, 08, 09
Spec: [Mem's Life first release](../spec.md)
Coverage: US-44–47, US-53
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

A full native workout survives weak connectivity, force-quit and synchronization conflicts without losing acknowledged results.

## Acceptance criteria

- [ ] Persist native record changes and immutable outbox commands transactionally before showing saved-on-device state.
- [ ] Implement ordered per-aggregate retry/idempotency, confirmed-state/local-projection separation and a durable committed change feed with atomic cursor advancement.
- [ ] Support consistent snapshot/reset and installation-epoch recovery while retaining pending work; pause automatic replay after epoch change and reconcile previously attempted commands whose receipts may have been lost. Never-sent edits are revalidated, not blindly replayed.
- [ ] Preserve conflicting session versions, stop dependent commands and let unrelated records sync; expose reviewed resolution choices.
- [ ] Test airplane-mode logging, full storage, forced termination, expired auth, lost server response, concurrent edits and server restore; timers remain honest.
- [ ] Test competing committed writers, transaction-preserving pagination, mutations during a consistent snapshot, and termination between page application and cursor advancement.

## Verification

Record and finish offline, kill/relaunch, edit the same session on another client, reconnect and resolve without lost or duplicated sets.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Independent checkout passes real Node SQLite recovery seams plus actual HTTP/PostgreSQL backup/restore (`verify-offline-live.mjs`); canonical sync tests cover committed feed/snapshot boundaries. The receipt explicitly excludes the actual Expo driver/force-quit gate.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Fresh Release native airplane-mode logging, acknowledgement durability, termination, full storage, auth/lost-response/conflict recovery and restore convergence are still being verified. Neither Node SQLite nor earlier online gym proof substitutes for actual native durability. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
