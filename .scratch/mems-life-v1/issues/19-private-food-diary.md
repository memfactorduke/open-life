# 19: Keep a private photo-and-text food diary

Status: ready-for-agent
State: claimed
Blocked by: 01
Spec: [Mem's Life first release](../spec.md)
Coverage: US-30, US-48–50, US-52
Phase: implementation authorized; work in progress

## What to build

Create, browse and correct dated food entries with multiple private photos on phone, tablet and web.

## Acceptance criteria

- [ ] Capture/select photos with permission handling and add free text, editable date/time and daily history.
- [ ] Save camera/picker content to durable app-owned storage before acknowledging it; validate server-side photo type and bounded size.
- [ ] Introduce the protected private filesystem media lifecycle with staging, immutable identifiers, validated finalization and startup reconciliation; edit/delete preserves identity, authorization and audit history.
- [ ] Provide appropriate capture-first phone UI and readable iPad/web history with useful empty/error states.
- [ ] Do not infer calories, nutrients or meal plans. Provide the validated owner-scoped food operations that the later MCP slice can expose.
- [ ] Reject unauthenticated copied URLs and traversal paths; serve no public static media route and apply private/no-store download headers.

## Verification

Capture a fictional meal with two photos, backdate and edit it, read it elsewhere and prove another identity cannot fetch its images.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
