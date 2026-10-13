# 23: Connect and disconnect an official WHOOP account

Status: ready-for-agent
State: claimed
Blocked by: 01
Spec: [Mem's Life first release](../spec.md)
Coverage: US-54, US-58–59
Phase: implementation authorized; work in progress

## What to build

The owner configures and consents to an optional WHOOP connection with reliable credential lifecycle handling.

## Acceptance criteria

- [ ] Use registered per-installation developer credentials, a configured HTTPS callback, authorization-code OAuth and state validation.
- [ ] Request only the specified read/profile/refresh scopes; protect server-side credentials and rotated tokens and serialize concurrent refresh.
- [ ] Show connection, expiry/reconnect and error states; the rest of the app works without WHOOP.
- [ ] Disconnect stops polling, attempts remote revocation, deletes local credentials and reports failure honestly; default retained observations are labelled disconnected with explicit deletion offered.
- [ ] Test fixtures and provide exact private-configuration/consent instructions. Implementation acceptance can resolve with the live read/refresh/revoke gate explicitly transferred to final release verification; never describe an untested account as connected or request secrets in chat.
- [ ] Account replacement creates a new provider-account synchronization boundary; retained old-account records remain clearly identified and excluded from current-account summaries.

## Verification

Exercise consent callback and refresh/revoke with fixtures, then perform the documented live check only when the owner supplies the configuration and approves consent.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
