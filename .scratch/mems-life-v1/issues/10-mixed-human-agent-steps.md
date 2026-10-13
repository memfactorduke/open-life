# 10: Break outcomes into human and agent steps

Status: ready-for-agent
State: claimed
Blocked by: 02
Spec: [Mem's Life first release](../spec.md)
Coverage: US-13–16
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Represent one outcome with ordered subtasks, responsibility and parallel dependencies, showing what can happen next.

## Acceptance criteria

- [ ] Support one level of required/optional subtasks assigned to human, agent or either, without copying tasks into separate stores.
- [ ] Validate an acyclic dependency graph and reject cross-owner edges or deletion that silently breaks required work.
- [ ] Separate dependency readiness, deliberate release, assignment and active execution; Planned work remains dormant.
- [ ] Show next actions and waiting reasons in the parent and human/agent filtered views.
- [ ] Apply parent completion/reopening rules without treating one finished step as the entire outcome.

## Verification

Model a small mixed workflow with two parallel branches, reject a cycle and verify that only required satisfied steps allow parent completion.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
