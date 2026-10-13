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
