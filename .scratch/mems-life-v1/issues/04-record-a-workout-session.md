# 04: Record and finish a workout session

Status: ready-for-agent
State: claimed
Blocked by: 03
Spec: [Mem's Life first release](../spec.md)
Coverage: US-34–37, US-43, US-46
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Start from a routine or an empty session, record actual training and notes, and finish with an accurate saved result.

## Acceptance criteria

- [x] Copy a routine into a session snapshot; separate target sets from performed sets and distinguish warm-up from working sets.
- [ ] Record applicable repetitions, load, time and distance with exercise/session notes, inline correction and useful validation.
- [ ] Preserve active input while moving between exercises; visibly distinguish planned, in-progress, partial/abandoned and finished activity.
- [x] Finishing is explicit; unfinished planned exercises are not fabricated as completed results.
- [ ] Show a persisted completed session on another client; later routine edits do not change its actual results or notes.

## Verification

Complete a mixed workout with warm-up and working sets, abandon a second partial session, revise the routine and confirm both histories remain accurate.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Session snapshots, separate targets/actuals, all four measurement modes, warm-up exclusion, explicit completion, abandonment, correction history and revision/replay rules pass in real PostgreSQL (`apps/server/test/sessions.test.ts`). Earlier immutable native gym/food proof records an iPad completed mixed session with 612 kg-reps and a corrected abandoned phone session; it is not final-source offline proof.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe immutable gym/food receipt](../evidence/release-safe/receipts/native-gym-food--results.json) records exact successes, failed exploratory/visual gates and source limitations; it predates the current offline/Today source.

Evidence remaining: Persisted cross-client results and native input retention have bounded historical proof; final native Session safe-area sign-off and current-bundle regression remain. Preserve ticket 03 blocker until its literal acceptance is qualified. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
