# 16: Recover interrupted and uncertain agent work

Status: ready-for-agent
State: claimed
Blocked by: 15
Spec: [Mem's Life first release](../spec.md)
Coverage: US-26–28
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Failures, cancellation, takeover and lost connections produce recoverable history without duplicate external effects.

## Acceptance criteria

- [ ] Retry creates a new attempt while retaining prior progress, outputs and errors; respect configured retryability.
- [ ] Cancellation is cooperative and visible; it does not claim an already performed external action was undone.
- [ ] Block late completion from expired/replaced owners or incompatible changed instructions.
- [ ] Represent unknown external outcomes explicitly and require reconciliation evidence before allowing a duplicate consequential attempt.
- [ ] Support human takeover/yield/recovery through authorized operations and test lease expiry, server restart and stale responses.

## Verification

Expire a worker during a simulated upload, reject its late finish, reconcile the external receipt and avoid a second upload.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
