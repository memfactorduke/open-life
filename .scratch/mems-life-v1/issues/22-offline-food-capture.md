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
