# 05: Organize and find work

Status: ready-for-agent
State: resolved
Blocked by: 02
Spec: [Mem's Life first release](../spec.md)
Coverage: US-08–09, US-12
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

Use configurable boards, projects, tags, priorities, ordering and search to manage a real task collection.

## Acceptance criteria

- [x] Create/edit boards and columns, explicitly map columns to lifecycle phases, and keep completed work retrievable.
- [x] Group tasks into projects, apply tags/priorities, filter and search task text with clear empty states.
- [x] Support drag ordering where suitable and keyboard/menu alternatives on web and tablet; keep phone management practical.
- [x] Changing a column label or project membership cannot release work accidentally or sever task identity/history.
- [x] Persist configuration through the same validated owner-scoped operations intended for later MCP use.

## Verification

Create a project with two board layouts, rename a phase label, find archived/completed work and reproduce the view after restart.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL productivity test covers configuration, phase mapping, organization/search, stable identity and recurrence/graph safety. The 15 three-engine productivity browser cases include actual drag and Move up ordering, reload persistence and stale-write review.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 05.1–05.5: [three-engine productivity execution](../evidence/productivity-web/verification.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); `apps/server/test/productivity.test.ts` and mobile `tests/productivity.test.tsx` cover configuration, phase safety, organization, exact retries and saved-version review. Actual drag and Move up alternatives passed across three browser engines; native board read is recorded in `native-gym-food/cold-start-release/phone-board-read/`. Ordinary UI component evidence is combined with real service/browser/native smoke; it does not claim an OS notification or device-rotation test.
