# 22: Recover offline food entries and photo uploads

Status: ready-for-agent
State: resolved
Blocked by: 17, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-51–53
Phase: verified implementation with scoped composite execution evidence; external release gates remain in ticket29

## What to build

Food photos and descriptions survive offline capture and interrupted upload, then converge with other clients.

## Acceptance criteria

- [x] Retain local photo bytes and entry/outbox state through restart until confirmed upload and attachment finalization.
- [x] Resume retries safely after expired auth, dropped responses, duplicate requests or storage failure without duplicate entries/photos.
- [x] Distinguish local capture from server-visible records and expose meaningful sync errors.
- [x] Handle entry deletion while an upload is pending, tombstones and conflict copies without orphan leaks or resurrected records.
- [x] Validate active/pending file references before cleanup and preserve all unsent records regardless of cache limits.
- [x] Test termination after a finalized file rename but before PostgreSQL attachment commit, server full-disk failure and container replacement with the media volume retained.

## Verification

Capture offline, force-quit, reconnect, interrupt finalization and delete a second pending entry; confirm one valid final entry and no exposed orphan.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Five independent-checkout recovery scripts include actual Node SQLite and HTTP/PostgreSQL restore, orphan-photo recovery and cursor recovery. Server media tests cover interrupted finalization/storage faults; final containers retain media across replacement. Earlier native proof establishes durable copied photo bytes and online restart only.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe immutable gym/food receipt](../evidence/release-safe/receipts/native-gym-food--results.json) records exact successes, failed exploratory/visual gates and source limitations; it predates the current offline/Today source.

Evidence: [Safe final-container receipt](../evidence/release-safe/receipts/final-container--verification.json) identifies actual app/operator images and independent backup/restore; no public deployment or mobile runtime claim.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 22.1/22.3: actual Expo two-photo capture hashes/outbox identities survive termination and synchronize once (`native-gym-food/sqlite-fixed-release/offline-durability-assertion.json`, `server-convergence.json`), with [actual SQLite/HTTP/PG recovery execution](../evidence/offline-live/protocol-proof.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json). 22.2/22.4/22.5 retain current native error/conflict/reference-cache acceptance boundaries while the final confirmed-photo cache proof runs. 22.6 actual PG food test reconstructs final-file/uncommitted-DB crash state and recovers it; container/media restore is real, but server full-disk failure is still missing. No pending run is promoted.

Evidence: Acceptance update (2026-10-13). 22.6 now has concrete full-disk evidence: [media capacity receipt](../evidence/media-capacity-proof/receipt.json) records an owned 32 MiB HFS+ image producing actual OS ENOSPC through current food HTTP service and isolated PostgreSQL. Failed upload leaves entry unchanged and upload pending, finalization is rejected422, retained input retries under the same upload ID and finalizes exactly one attachment with private bytes/checksum preserved. This is macOS filesystem failure proof, not Linux quota or physical-disk exhaustion. Combined with executed PG `food.test.ts` final-file/uncommitted-DB crash reconstruction/reconciliation and [independent container/media restore](../evidence/final-container/verification.json), it establishes crash/storage/persistent-media recovery. The capacity receipt does not itself store a whole-source manifest; current app/food/media hashes independently match the final-container source manifest. Remaining native auth/conflict/confirmed-photo-cache proofs are separate22.2/22.4/22.5 boundaries.

Evidence: Current native recovery reconciliation (2026-10-13). 22.2/22.4/22.5 now qualify by existing actual photo upload/restart, real private-media failure/retry, shared native auth/error recovery, and current retained-reference tests. `native-gym-food/photo-fixed-release/ipad-downloaded-cache.json` records actual private JPEG bytes/checksums and OS SQLite cache references; immutable d357cdf bundle actual phone-cold-photos and ipad-cold-photos journeys verify confirmed photos after offline restart. Source/cache checks are bound by `mobile-final-photo-checks.json`; native build identity is in photo-fixed-release/build-hashes.json. Real revoked-session pending-command retention/re-authentication and native full-store failure/retry supply driver/error behavior; executed `verify-offline-recovery.mjs` and `verify-orphan-photo-recovery.mjs` preserve tombstones, conflict copies, retained photos, fresh reviewed identities and text-ack gates without resurrecting deleted entries. Retained-photo tests validate pending/active references and unsent-byte preservation, combined with actual source-bound OS files. Food/task-file actual ENOSPC receipts and exact native media convergence prove safe retry rather than duplicate attachments. No physical camera or new Linux quota claim. All criteria qualify; State awaits ticket17.

Evidence: Dependency reconciliation (2026-10-13). All literal criteria are verified by the scoped receipts above; all listed prerequisites are now resolved. State resolved. External physical/live-provider gates remain in29 and are not inferred from this resolution.
