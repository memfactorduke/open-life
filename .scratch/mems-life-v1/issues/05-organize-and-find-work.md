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

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL productivity test covers configuration, phase mapping, organization/search, stable identity and recurrence/graph safety. The 15 three-engine productivity browser cases include actual drag and Move up ordering, reload persistence and stale-write review.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Native board/project/search management, tablet alternatives and restart reproduction are not established by browser viewport or component fixtures. Ticket02 remains the prerequisite. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
