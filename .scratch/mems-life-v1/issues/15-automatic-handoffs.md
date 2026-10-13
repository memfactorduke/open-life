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

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. PostgreSQL agent-workflow scenarios exercise deliberate release, automatic eligibility, parallel branches, human handoffs, pause/dormant Planned work and final parent review. Browser workflow tests cover released-work presentation; no embedded agent runtime is implied.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current native Needs you/Waiting progression and parent completion/reopening journey remain; ticket 14 blocker remains claimed. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
