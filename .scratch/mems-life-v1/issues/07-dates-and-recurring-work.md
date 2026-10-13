# 07: Schedule dates and recurring work

Status: ready-for-agent
State: claimed
Blocked by: 02
Spec: [Mem's Life first release](../spec.md)
Coverage: US-11–12
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Track due/scheduled work and recurring responsibilities with stable occurrence history.

## Acceptance criteria

- [ ] Support optional due and scheduled dates and daily, selected-weekday/weekly and monthly recurrence in an IANA time zone.
- [ ] Keep a recurrence series separate from each occurrence; complete/skip affects one occurrence and series edits explicitly affect future ones.
- [ ] Generate the next outstanding occurrence idempotently without flooding the board with fabricated past completions.
- [ ] Use the last valid day for missing monthly dates and document/test daylight-saving transitions and late completion behavior.
- [ ] Show upcoming/overdue work and let the person cancel a series without losing completed occurrence history.

## Verification

Complete an overdue weekly task twice through retried requests, edit future recurrence, and test month-end and daylight-saving examples.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
