# 05: Organize and find work

Status: ready-for-agent
State: claimed
Blocked by: 02
Spec: [Mem's Life first release](../spec.md)
Coverage: US-08–09, US-12
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Use configurable boards, projects, tags, priorities, ordering and search to manage a real task collection.

## Acceptance criteria

- [ ] Create/edit boards and columns, explicitly map columns to lifecycle phases, and keep completed work retrievable.
- [ ] Group tasks into projects, apply tags/priorities, filter and search task text with clear empty states.
- [ ] Support drag ordering where suitable and keyboard/menu alternatives on web and tablet; keep phone management practical.
- [ ] Changing a column label or project membership cannot release work accidentally or sever task identity/history.
- [ ] Persist configuration through the same validated owner-scoped operations intended for later MCP use.

## Verification

Create a project with two board layouts, rename a phase label, find archived/completed work and reproduce the view after restart.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
