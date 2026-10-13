# 22: Recover offline food entries and photo uploads

Status: ready-for-agent
State: claimed
Blocked by: 17, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-51–53
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

Food photos and descriptions survive offline capture and interrupted upload, then converge with other clients.

## Acceptance criteria

- [ ] Retain local photo bytes and entry/outbox state through restart until confirmed upload and attachment finalization.
- [ ] Resume retries safely after expired auth, dropped responses, duplicate requests or storage failure without duplicate entries/photos.
- [ ] Distinguish local capture from server-visible records and expose meaningful sync errors.
- [ ] Handle entry deletion while an upload is pending, tombstones and conflict copies without orphan leaks or resurrected records.
- [ ] Validate active/pending file references before cleanup and preserve all unsent records regardless of cache limits.
- [ ] Test termination after a finalized file rename but before PostgreSQL attachment commit, server full-disk failure and container replacement with the media volume retained.

## Verification

Capture offline, force-quit, reconnect, interrupt finalization and delete a second pending entry; confirm one valid final entry and no exposed orphan.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Five independent-checkout recovery scripts include actual Node SQLite and HTTP/PostgreSQL restore, orphan-photo recovery and cursor recovery. Server media tests cover interrupted finalization/storage faults; final containers retain media across replacement. Earlier native proof establishes durable copied photo bytes and online restart only.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe immutable gym/food receipt](../evidence/release-safe/receipts/native-gym-food--results.json) records exact successes, failed exploratory/visual gates and source limitations; it predates the current offline/Today source.

Evidence: [Safe final-container receipt](../evidence/release-safe/receipts/final-container--verification.json) identifies actual app/operator images and independent backup/restore; no public deployment or mobile runtime claim.

Evidence remaining: Fresh actual Expo offline capture/force-quit/interrupted upload/auth/delete-conflict and reference-safe local cleanup remain. Finalized rename/commit gaps are service proof, not blanket OS/native acceptance. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
