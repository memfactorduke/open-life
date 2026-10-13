# 03: Build reusable workout routines

Status: ready-for-agent
State: claimed
Blocked by: 01
Spec: [Mem's Life first release](../spec.md)
Coverage: US-32–33, US-42–43
Phase: implementation in progress; acceptance and foundation native proof remain pending

## What to build

Create and manage a useful exercise catalog and reusable routines on web and native clients.

## Acceptance criteria

- [x] Provide a general nonpersonal catalog plus custom weighted, bodyweight, timed and distance exercises with relevant fields.
- [x] Create routines with ordered exercises, planned sets/targets and notes; rename, duplicate and archive without damaging existing references.
- [x] Make units configurable, preserve physical quantities during display conversion, and distinguish absent data from zero.
- [x] Validate targets and numeric input without requiring irrelevant measurements or making historical names unintelligible after exercise edits.
- [ ] Support comfortable phone selection/logging preparation and iPad/web routine management, with persistence and owner authorization.

## Verification

Build a mixed routine, change display units, reload it on another client and inspect targets and exercise history-safe metadata.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments


Evidence: Routine/exercise shared-boundary checks passed against real PostgreSQL. [Archive recovery receipts](../evidence/archive-recovery/verification.json) establish web recovery, zero-repetition persistence, conflict review and exact retry across all three browser engines plus native component cases. [Native results](../evidence/native-features/results.json) establish four exercise modes, shared snapshots, targets, ordering, duplication, archive recovery, unit conversion without quantity changes, and restart persistence on iPhone/iPad. The final comfort/layout criterion remains open until the repaired modal safe-area container is inspected in a new native build. Older bundle proof is bounded by its hash/source snapshot.
