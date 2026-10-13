# 25: Use a daily focus view across phone, tablet and web

Status: ready-for-agent
State: claimed
Blocked by: 04, 07, 10, 15, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-60–62, US-66
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

Reach the next useful action across tasks, active training and food without losing dedicated domain navigation.

## Acceptance criteria

- [ ] Provide direct Tasks/Workouts/Food navigation plus Today with due/next human actions, waiting reasons, active session and quick food capture.
- [ ] Use a practical one-handed phone layout, adaptive iPad list/detail management and denser keyboard-friendly web planning.
- [ ] Retain useful navigation/view state without mixing histories or hiding failed/pending work.
- [ ] Cover empty, loading, offline, no-permission and recoverable-error states; preserve in-progress input.
- [ ] Verify compact/wide tablet sizes, rotation/resizing, non-drag alternatives and navigation to each underlying record.

## Verification

Use one fictional day containing due work, an agent handoff, an active workout and a food entry on all three client layouts.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
