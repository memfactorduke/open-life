# 09: Use previous performance and workout history

Status: ready-for-agent
State: resolved
Blocked by: 04
Spec: [Mem's Life first release](../spec.md)
Coverage: US-40–42, US-46
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

See previous comparable performance while logging and browse meaningful session/exercise progress.

## Acceptance criteria

- [x] Display previous relevant results beside active set inputs and navigate complete, partial and corrected sessions.
- [x] Provide exercise history and clear comparable trends without mixing incompatible measurement types.
- [x] Define weighted working-set volume explicitly; do not report unperformed targets or missing data as actual volume.
- [x] Preserve historical units/exercise meaning and label estimates if introduced; aggregate corrections consistently.
- [x] Support practical pagination/filtering and accessible charts or equivalent readable values on each client.

## Verification

Log several fictional sessions in different units, correct one result and confirm previous-performance views and progress calculations update accurately.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. PostgreSQL session test explicitly excludes warm-up/unperformed targets and incomparable modes from measured working-set volume, recomputes corrections, filters previous performance and paginates history. Earlier native phone displayed the completed tablet actuals and 612 kg-reps.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe immutable gym/food receipt](../evidence/release-safe/receipts/native-gym-food--results.json) records exact successes, failed exploratory/visual gates and source limitations; it predates the current offline/Today source.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 09.1–09.5: [session service execution](../evidence/sessions-service/receipt.json), [immutable native mixed-workout/diary execution](../evidence/native-gym-food/results.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); native phone showed previous tablet actuals and 612 kg-reps, retained corrected partial history; mobile named comparable-history/pagination/stale-response/unit/correction tests and `apps/server/test/sessions.test.ts` establish comparable trends, canonical quantities and readable values. Historical screenshots stay bound to their original bundle; current component assertions are ordinary UI verification, not an invented native lifecycle proof.
