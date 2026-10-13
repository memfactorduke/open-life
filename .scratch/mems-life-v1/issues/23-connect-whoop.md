# 23: Connect and disconnect an official WHOOP account

Status: ready-for-agent
State: resolved
Blocked by: 01
Spec: [Mem's Life first release](../spec.md)
Coverage: US-54, US-58–59
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

The owner configures and consents to an optional WHOOP connection with reliable credential lifecycle handling.

## Acceptance criteria

- [x] Use registered per-installation developer credentials, a configured HTTPS callback, authorization-code OAuth and state validation.
- [x] Request only the specified read/profile/refresh scopes; protect server-side credentials and rotated tokens and serialize concurrent refresh.
- [x] Show connection, expiry/reconnect and error states; the rest of the app works without WHOOP.
- [x] Disconnect stops polling, attempts remote revocation, deletes local credentials and reports failure honestly; default retained observations are labelled disconnected with explicit deletion offered.
- [x] Test fixtures and provide exact private-configuration/consent instructions. Implementation acceptance can resolve with the live read/refresh/revoke gate explicitly transferred to final release verification; never describe an untested account as connected or request secrets in chat.
- [x] Account replacement creates a new provider-account synchronization boundary; retained old-account records remain clearly identified and excluded from current-account summaries.

## Verification

Exercise consent callback and refresh/revoke with fixtures, then perform the documented live check only when the owner supplies the configuration and approves consent.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL WHOOP adapter fixture test exercises session-bound OAuth state, configured HTTPS callback, pagination, concurrent serialized refresh, encrypted/rotated credentials, 401/429, account replacement, 404, honest failed revocation and deleted credentials; provider HTTP is fictional. It proves ordinary local task work continues during a blocked provider call.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 23.1–23.6 implementation accepted with labelled provider fixtures: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), executed `apps/server/test/whoop.test.ts`, `docs/whoop.md` and native/web connection-state implementation. Assertions cover configured HTTPS/state/native redirect, minimal scopes/encrypted rotated tokens/serialized refresh, honest reconnect/errors, continued local work, failed remote revocation with local credential deletion, observation retention/deletion and account replacement boundaries. As expressly permitted by 23.5, real personal consent/read/refresh/revoke moves to ticket 29 and `release-gates.md`; no WHOOP account is described as live connected.
