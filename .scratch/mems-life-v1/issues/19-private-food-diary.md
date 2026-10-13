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
- [x] Reject unauthenticated copied URLs and traversal paths; serve no public static media route and apply private/no-store download headers.

## Verification

Capture a fictional meal with two photos, backdate and edit it, read it elsewhere and prove another identity cannot fetch its images.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL food/media tests and three-engine production journey verify private validated photo upload/download, no-store access and task-file sharing boundary. Earlier immutable native phone imports two fictional photos to app storage; phone/iPad relaunch show exact entry and images. Same-record text correction and tablet post-delete read are explicitly not proven.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe immutable gym/food receipt](../evidence/release-safe/receipts/native-gym-food--results.json) records exact successes, failed exploratory/visual gates and source limitations; it predates the current offline/Today source.

Evidence: [Safe final-container receipt](../evidence/release-safe/receipts/final-container--verification.json) identifies actual app/operator images and independent backup/restore; no public deployment or mobile runtime claim.

Evidence remaining: Current native permission denial/capture cancel/error behavior and final layout regression remain. Simulator camera UI does not prove a hardware photograph; no calories/nutrients/meal plans are inferred. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
