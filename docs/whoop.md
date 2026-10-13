# Optional WHOOP connection

WHOOP supplements local workouts with read-only provider observations. Local exercises, sets, notes and session totals stay authoritative. Unconfigured, disconnected, stale or failed WHOOP access never prevents logging a workout.

## Private operator configuration

Register a separate developer application for this installation in the [WHOOP developer dashboard](https://developer.whoop.com/docs/developing/getting-started/). Register the exact HTTPS callback `https://YOUR-INSTALLATION/api/whoop/callback`. Configure these values only in the server's private environment:

- `WHOOP_CLIENT_ID`: developer application client identifier.
- `WHOOP_CLIENT_SECRET`: developer application secret.
- `WHOOP_REDIRECT_URI`: exact registered HTTPS callback.
- `WHOOP_TOKEN_KEY`: independently generated 32-byte encryption key, represented as 64 hexadecimal characters. Generate it privately, for example with `openssl rand -hex 32`; never paste the output into chat.

All four values are optional together. Without all four, WHOOP is unconfigured. Keep the encryption key outside the database, source tree and browser/native configuration. Back it up separately in protected operator storage; a database backup alone cannot decrypt tokens. Losing the key requires fresh consent. Never rotate the encryption key without first re-encrypting credentials or disconnecting. The installation needs a reachable HTTPS service and registered callback; support for an arbitrary localhost callback is unverified.

Tokens use AES-256-GCM encryption at rest. Client secrets and tokens never enter API responses, synchronization feeds or audit values. Configure infrastructure access logs to omit query strings on OAuth callback paths: the short-lived authorization code and state must not be retained in logs. Server application logging is disabled.

## Owner consent

Sign into the installation, open WHOOP, and select Connect. Only the owner can initiate consent. The requested scopes are `read:profile read:workout read:cycles read:recovery read:sleep offline`. Profile establishes a stable provider identity when there are no observations. Body measurements are not requested.

Web consent returns to the HTTPS callback using the original signed-in browser session. Native consent uses Expo's authentication browser. For native flows the HTTPS callback returns only the temporary code and state to the fixed `memslife://whoop-callback` app URL; the original authenticated native session submits these to the server. No provider tokens enter that URL. The native callback is not an open redirect and does not exchange credentials until the original owner/session is authenticated. A state is one-use, expires after ten minutes, and is consumed durably before token exchange. If exchange fails, start a new consent flow.

A replacement account creates a new synchronization boundary even if it is the same provider identity. Retained observations from previous connections remain labelled as previous/disconnected account context and excluded from current summaries.

## Synchronization and provenance

The running server checks for due synchronization once a minute, but each connection can refresh at most hourly, including manual and targeted refreshes. Initial synchronization begins 24 hours before connection. Later windows use the later of that fixed boundary and the rolling seven-day boundary, plus the current cycle. Each collection paginates completely, with a safety bound of 100 pages per collection; an excessive or repeated pagination cursor produces a failed refresh rather than a false success. There is no automatic history import.

Every observation retains account/type/provider ID, provider update time, interval/time-zone fields when supplied, retrieval time, score state and availability. Pending or missing scores stay unavailable rather than becoming zero. Recovery IDs are cycle IDs, matching the resource-specific endpoint. Older observations can be rechecked explicitly. An authenticated resource-specific 404 marks that observation unavailable and removes its optional local link; missing collection records alone never imply deletion. Other errors preserve observations and report failed freshness; 401 requires reconnect, and 429 postpones refresh according to Retry-After with at least the hourly bound.

The server PostgreSQL pool must allow at least two connections (the default pool allows ten), so a held connection lock and the independent durable credential write can progress. A busy provider connection is skipped by background polling and returns a readable retry conflict for manual commands; waiting callers do not occupy the spare database connection required for durable token rotation. Connection row locks serialize provider refresh, disconnect and replacement across server processes. Provider calls do not hold the installation row lock, so task/workout edits can continue during a slow WHOOP response. Rotated credentials are saved atomically in a separate credential statement while the connection lock is held, before observation writes. This prevents a later observation transaction rollback from losing the valid refresh token. Connection/feed commits are short and occur after provider work. Provider polling is recorded as system activity in `whoop_history`; explicit commands have owner audit entries, operation receipts and change-feed results.

Local-session links are explicit. The clients offer actual local sessions to choose from; timestamps never merge data automatically. One provider workout can link to one local session, and a local session can link to one workout within a connection/account boundary. Retained links from an old account do not block a new account's link. Provider observations are context, not extra local session totals.

## Disconnect and cache deletion

Disconnect stops polling, attempts remote revocation, and deletes local credentials even if WHOOP is unavailable. Remote revocation failure is reported honestly; remove application access in WHOOP settings if necessary. Cached observations are retained by default and labelled disconnected. Delete cached observations is a separate explicit action; it does not delete local workouts or sets.

## Verification and release gate

Fictional upstream fixtures with an isolated real PostgreSQL database test paging, missing/scored values, refresh rotation, 401/429/404, replacement identity boundaries, callback replay/session binding, native return routing, disconnect and revocation failure. Tests do not access a WHOOP account.

The live release gate remains separate: the owner privately configures developer credentials, personally approves consent, and verifies a v2 read, a later rotated refresh, and successful remote revoke. Native consent on a real configured device also remains unverified until that owner-approved exercise. Do not describe fixture success as a connected account.

Official sources independently checked on 2026-10-12: [WHOOP OAuth](https://developer.whoop.com/docs/developing/oauth/), [v2 API reference](https://developer.whoop.com/api/), and [Expo WebBrowser](https://docs.expo.dev/versions/latest/sdk/webbrowser/). The published consumer API supplies summaries; it does not provide detailed strength sets/reps, continuous heart-rate streams, or workout write-back. Webhooks were compared with bounded polling: polling covers cycles without requiring public inbound webhook infrastructure, while webhooks would still require reconciliation and can be added later.
