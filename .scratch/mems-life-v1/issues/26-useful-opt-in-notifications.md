# 26: Receive useful opt-in reminders and handoff alerts

Status: ready-for-agent
State: claimed
Blocked by: 07, 08, 16, 25
Spec: [Mem's Life first release](../spec.md)
Coverage: US-63–64
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

Opt into reminders and human-action alerts that open the right record without routine notification spam.

## Acceptance criteria

- [ ] Keep an in-app attention list available without OS permission or a configured push provider.
- [ ] Use native local timer/due reminders and an optional configured Expo push adapter for remote handoff/failure alerts.
- [ ] Deduplicate delivery events, honor user preferences and logout/revocation, avoid private-content previews by default and deep-link correctly.
- [ ] Handle denied permission, invalid tokens, provider failure and receipt errors without losing the underlying task event.
- [ ] Document project/Apple credential setup and distinguish fixture/provider tests from real configured delivery; self-hosted core use requires no push service.

## Verification

Trigger a due reminder and simulated handoff, verify opt-out/dedup/deep-link behavior, and record real device delivery only when credentials are configured.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL attention and Expo protocol tests prove in-app events, deduplication, opt-in/session revocation, private default payloads and provider/receipt error handling. Native component checks are fixture coverage only; independent checkout includes them in its 94 passing mobile tests.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Actual native permission/tap/deep-link/cancel/logout notification behavior and configured real push delivery remain unverified. Setup documentation and fixture protocol success cannot establish OS delivery; real push/signing belongs ticket 29. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
