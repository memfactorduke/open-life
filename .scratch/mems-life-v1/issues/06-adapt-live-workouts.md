# 06: Adapt a live workout without rewriting its plan

Status: ready-for-agent
State: resolved
Blocked by: 04
Spec: [Mem's Life first release](../spec.md)
Coverage: US-37–38, US-43, US-46
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

Change the workout as it happens while preserving actual results and the reusable routine.

## Acceptance criteria

- [x] Add, substitute, reorder, skip and remove session exercises and add/edit/remove actual sets with notes.
- [x] Clearly distinguish skipping a planned activity from erasing a recorded result; retain correction history.
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

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 06.1–06.5: [session service execution](../evidence/sessions-service/receipt.json), [immutable native mixed-workout/diary execution](../evidence/native-gym-food/results.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); session test assertions cover adding/removing/substituting/reordering/skipping, retained actuals and correction history, explicit future routine update and stale revisions. Actual iPad adaptation retained routine revision 1 and recorded results (`session-adapted.json`, `routine-after-session-adaptation.json`); later safe-area repair is already recorded by ticket 03. No unchanged session operation needs a repeat solely because the food cache changed.
