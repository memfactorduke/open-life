# 08: Train with supersets and reliable timers

Status: ready-for-agent
State: claimed
Blocked by: 06
Spec: [Mem's Life first release](../spec.md)
Coverage: US-39, US-45
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Group exercises into supersets and use rest/exercise timers that remain understandable through backgrounding and restart.

## Acceptance criteria

- [ ] Create and execute ordered superset groups while keeping results attached to the correct exercise and round.
- [ ] Support start, pause, resume, reset and optional auto-rest after a recorded set, without silently marking an exercise complete.
- [ ] Persist timer state/deadlines and derive elapsed/remaining time after backgrounding; handle device-clock changes deliberately.
- [ ] Provide optional sound/haptic/local notification with graceful denied-permission behavior and avoid duplicate alerts across devices.
- [ ] Verify foreground, background and process-restart behavior; do not rely on continuous JavaScript or guaranteed background execution.
- [ ] Cancel or replace obsolete local notifications when timers change, finish or resume; reconcile persisted timer/notification state on app startup.

## Verification

Run a two-exercise superset, background during rest, relaunch and compare the persisted timer and recorded sets.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
