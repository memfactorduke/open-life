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
