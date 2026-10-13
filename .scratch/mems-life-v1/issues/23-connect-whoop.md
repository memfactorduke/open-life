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

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL WHOOP adapter fixture test exercises session-bound OAuth state, configured HTTPS callback, pagination, concurrent serialized refresh, encrypted/rotated credentials, 401/429, account replacement, 404, honest failed revocation and deleted credentials; provider HTTP is fictional. It proves ordinary local task work continues during a blocked provider call.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: All provider results remain fixture-labelled. Actual native connection/reconnect/disconnect UI journey is not indexed. Live personal consent/read/refresh/revoke is explicitly transferred to ticket 29 final release gate as permitted by criterion 23.5; no account is claimed connected and no secrets are requested in chat. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
