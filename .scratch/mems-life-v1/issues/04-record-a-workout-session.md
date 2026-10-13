# 04: Record and finish a workout session

Status: ready-for-agent
State: claimed
Blocked by: 03
Spec: [Mem's Life first release](../spec.md)
Coverage: US-34–37, US-43, US-46
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Start from a routine or an empty session, record actual training and notes, and finish with an accurate saved result.

## Acceptance criteria

- [ ] Copy a routine into a session snapshot; separate target sets from performed sets and distinguish warm-up from working sets.
- [ ] Record applicable repetitions, load, time and distance with exercise/session notes, inline correction and useful validation.
- [ ] Preserve active input while moving between exercises; visibly distinguish planned, in-progress, partial/abandoned and finished activity.
- [ ] Finishing is explicit; unfinished planned exercises are not fabricated as completed results.
- [ ] Show a persisted completed session on another client; later routine edits do not change its actual results or notes.

## Verification

Complete a mixed workout with warm-up and working sets, abandon a second partial session, revise the routine and confirm both histories remain accurate.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
