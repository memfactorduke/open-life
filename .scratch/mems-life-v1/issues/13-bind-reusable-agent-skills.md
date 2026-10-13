# 13: Bind reusable skills to agent steps

Status: ready-for-agent
State: claimed
Blocked by: 10, 11
Spec: [Mem's Life first release](../spec.md)
Coverage: US-23
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Give an agent step a reusable procedure, inputs and a defined deliverable without hosting agent execution.

## Acceptance criteria

- [ ] Create/edit skill references and bind a selected version with inputs and expected outputs to a step.
- [ ] Keep the skill binding separate from the worker connection and credential permissions.
- [ ] Surface missing skill/input details before work is eligible and preserve human-readable execution instructions.
- [ ] Snapshot resolved instruction/skill version for an attempt so later edits do not rewrite execution history.
- [ ] Treat instructions and linked content as data, not privileged app code; enforce the same binding operations through UI/MCP.

## Verification

Bind a script-writing procedure, revise it, and show that an earlier execution snapshot and the next plan refer to the correct versions.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
