# 14: Claim and report an agent attempt

Status: ready-for-agent
State: claimed
Blocked by: 13
Spec: [Mem's Life first release](../spec.md)
Coverage: US-24–25, US-27
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

External workers safely compete for eligible work, maintain ownership and report durable progress/results.

## Acceptance criteria

- [ ] Implement eligible-step listing, atomic claim, lease renewal, progress/output submission, finish/fail/yield and attempt lookup.
- [ ] Claim snapshots the instruction revision and returns attempt identity plus a protected ownership token and server-controlled expiry.
- [ ] Only one live claim succeeds; stale/expired owners cannot renew or submit authoritative completion.
- [ ] Persist validated outputs/history before acknowledging success; repeated operation IDs recover the original result.
- [ ] Exercise two real generic test clients against PostgreSQL, including competing claims and a lost completion response.
- [ ] Authenticate/authorize and return an existing matching operation receipt before new lease/revision validation; retry a successfully committed finish after its lease expired and recover the original result.

## Verification

Race two claims, renew the winner, record progress, finish, and recover the same finished result after discarding the first response.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
