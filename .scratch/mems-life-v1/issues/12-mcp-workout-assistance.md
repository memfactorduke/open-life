# 12: Let authorized agents assist with workouts

Status: ready-for-agent
State: claimed
Blocked by: 04, 11
Spec: [Mem's Life first release](../spec.md)
Coverage: US-29
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

An authorized agent can prepare routines and record explicitly reported training through the same rules as the UI.

## Acceptance criteria

- [ ] Expose routine/exercise reads and allowed planning mutations plus session/result operations under distinct scopes.
- [ ] Require reported/imported provenance for agent-written actual results; preparing a plan never invents a performed session.
- [ ] Keep routine revisions separate from session snapshots and preserve actor/history on corrections.
- [ ] Validate irrelevant/invalid measurements and reject stale session writes without losing the person's newer data.
- [ ] Demonstrate a generic client creating a routine and recording fictional reported results visible on phone/web.

## Verification

Author a routine by MCP, start it in the UI, submit an explicitly reported set and reject an unscoped or stale correction.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
