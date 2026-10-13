# 02: Capture and progress a task

Status: ready-for-agent
State: resolved
Blocked by: 01
Spec: [Mem's Life first release](../spec.md)
Coverage: US-06–07, US-10, US-12
Phase: verified task lifecycle; later productivity extensions remain in their own tickets

## What to build

Capture a simple task, add context, move through its lifecycle, and find the completed result on another client.

## Acceptance criteria

- [x] Create, edit and order tasks with descriptions/notes in default Planned, Next and Active views plus completed history.
- [x] Use explicit phase transitions, stable identity, actor history and revision checks; column text is not executable business logic.
- [x] Complete, reopen, archive and delete deliberately, with useful undo or correction behavior that preserves history.
- [x] Web and native clients show confirmed changes consistently and preserve input after validation or connection errors.
- [x] Exercise the shared operation boundary with duplicate operation IDs, stale revisions and denied ownership; do not create duplicate tasks on retry.

## Verification

Capture on phone, read and move it on web, complete and reopen it on iPad; reload all clients and inspect the retained history.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments


Evidence: Real PostgreSQL lifecycle, ordering, actor history, replay, stale revisions, authorization and rollback are covered by [service execution receipts](../evidence/foundation-service/results.json) and apps/server/test/features.test.ts. Browser task lifecycle and exact retry cases passed across Chromium, Firefox and WebKit. The immutable iOS bundle 272579f32b83031f225ad96f961d563f5653e0c90403ac8e9d5519957c1a9ec1 exercised capture and phase changes on iPhone, and shared-record completion, reopening, archive, delete/restore, history and restart on iPad. See [native results](../evidence/native-features/results.json) and [checkpoint](../evidence/native-features/checkpoint.md). Native validation/retry controls also have component interaction coverage; native task reordering and denial/retry journeys were not included in the simulator run. Later board/recurrence/agent features require their own verification. The modal safe-area defect is being repaired and will be recaptured in the next integrated native build.
