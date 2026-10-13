# 06: Adapt a live workout without rewriting its plan

Status: ready-for-agent
State: claimed
Blocked by: 04
Spec: [Mem's Life first release](../spec.md)
Coverage: US-37–38, US-43, US-46
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Change the workout as it happens while preserving actual results and the reusable routine.

## Acceptance criteria

- [ ] Add, substitute, reorder, skip and remove session exercises and add/edit/remove actual sets with notes.
- [ ] Clearly distinguish skipping a planned activity from erasing a recorded result; retain correction history.
- [ ] Session edits affect that session only unless the owner explicitly chooses an update-routine action.
- [ ] Updating a routine from a session applies selected future-plan changes without rewriting completed activity.
- [ ] Test revision conflicts and a routine change while an older session is in progress.

## Verification

Substitute an occupied-machine exercise, reorder the session, finish it and compare the original routine, explicit updated routine and saved result.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
