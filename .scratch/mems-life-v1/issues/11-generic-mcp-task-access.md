# 11: Manage tasks through generic MCP

Status: ready-for-agent
State: claimed
Blocked by: 05, 10
Spec: [Mem's Life first release](../spec.md)
Coverage: US-03, US-22, US-31
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

A generic external MCP client can securely read and change the same task records and configuration used by the person.

## Acceptance criteria

- [ ] Expose validated task/project/board/subtask operations through Streamable HTTP and a real header-capable MCP test client.
- [ ] The owner creates scoped expiring revocable agent credentials; display secrets once, store safe verifiers and log only grant identity.
- [ ] Reject insufficient scope, expired/revoked grants and cross-owner access on every call; agent grants cannot administer credentials.
- [ ] Demonstrate bidirectional UI/MCP consistency and idempotent/stale-write behavior through the shared application service.
- [ ] Document manually configured credential support accurately; do not advertise automatic OAuth interoperability or a named runtime without verification.

## Verification

Configure two generic test clients with different scopes, edit a task/configuration, observe it in UI, then revoke one and prove access stops.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
