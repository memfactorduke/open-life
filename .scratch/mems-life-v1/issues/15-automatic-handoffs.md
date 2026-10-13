# 15: Continue released workflows and pause for people

Status: ready-for-agent
State: claimed
Blocked by: 14
Spec: [Mem's Life first release](../spec.md)
Coverage: US-15–17
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Released workflows progress through eligible agent steps while clearly handing human actions back to the owner.

## Acceptance criteria

- [ ] Moving work to Next deliberately releases it; first accepted action/claim moves it Active.
- [ ] After a valid prerequisite finishes, expose all eligible agent steps automatically without an extra Start action.
- [ ] Human requirements and unmet dependencies pause progression with an accurate Needs you/Waiting reason.
- [ ] Pause prevents new claims; Planned tasks remain dormant even when their dependencies are satisfied.
- [ ] Preserve single task identity and complete the parent only when required steps and final review are satisfied.

## Verification

Finish an agent step, complete the human handoff, observe the next claimable step, and prove an equivalent Planned task is never claimable.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
