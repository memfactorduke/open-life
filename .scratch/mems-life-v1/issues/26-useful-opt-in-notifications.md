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

- [x] Keep an in-app attention list available without OS permission or a configured push provider.
- [ ] Use native local timer/due reminders and an optional configured Expo push adapter for remote handoff/failure alerts.
- [ ] Deduplicate delivery events, honor user preferences and logout/revocation, avoid private-content previews by default and deep-link correctly.
- [ ] Handle denied permission, invalid tokens, provider failure and receipt errors without losing the underlying task event.
- [x] Document project/Apple credential setup and distinguish fixture/provider tests from real configured delivery; self-hosted core use requires no push service.

## Verification

Trigger a due reminder and simulated handoff, verify opt-out/dedup/deep-link behavior, and record real device delivery only when credentials are configured.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL attention and Expo protocol tests prove in-app events, deduplication, opt-in/session revocation, private default payloads and provider/receipt error handling. Native component checks are fixture coverage only; independent checkout includes them in its 94 passing mobile tests.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 26.1/26.5: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), executed PG `attention.test.ts`, setup instructions `docs/notifications.md` and current component/native attention/settings smoke. In-app attention works without permission/provider and setup distinguishes adapter fixtures from real delivery. 26.2–26.4 still require actual native local permission/schedule/deep-link/logout behavior; Expo protocol fixture receipts establish remote adapter/error semantics, not actual push delivery. Real configured remote push remains ticket 29.

Evidence: Current delta/gate boundary (2026-10-13). Optional remote Expo push is explicitly deferred for the local release candidate and disabled by default, as recorded in [release gates](../release-gates.md). Current adapter/protocol fixtures and local notification implementation remain in scope; actual configured remote delivery becomes an external gate if enabled. Native local permission/scheduling/deep-link/logout proof is still required for26.2–26.4. Apple development signing/provisioning is being investigated against an authorized physical iPad; no completed physical or signed-build result is asserted.
