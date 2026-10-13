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
- [x] Session edits affect that session only unless the owner explicitly chooses an update-routine action.
- [x] Updating a routine from a session applies selected future-plan changes without rewriting completed activity.
- [x] Test revision conflicts and a routine change while an older session is in progress.

## Verification

Substitute an occupied-machine exercise, reorder the session, finish it and compare the original routine, explicit updated routine and saved result.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL session test changes routines while a session is active, keeps session snapshots intact, rejects stale routine updates transactionally, applies an explicit future-routine update, retains substituted results and records corrections. Earlier iPad journey demonstrated skip/reorder/add/substitute with routine still revision 1.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe immutable gym/food receipt](../evidence/release-safe/receipts/native-gym-food--results.json) records exact successes, failed exploratory/visual gates and source limitations; it predates the current offline/Today source.

Evidence remaining: Final native editing flow and phone modal layout need current-bundle review; recorded service evidence does not resolve ticket 04. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
