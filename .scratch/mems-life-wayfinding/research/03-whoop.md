# WHOOP integration research

Verified against current official WHOOP documentation on 2026-10-12 (America/New_York). Planning evidence only; no account was connected and no credentials were requested. WHOOP integration is confirmed by the user; the choices below are recommendations for the implementation specification. No historical-record migration is required.

## Recommendation

Build an optional, read-only WHOOP connection using the public consumer v2 API. Show provider observations alongside locally logged workouts; keep exercises, sets, repetitions, loads, and personal notes locally authoritative. Start with bounded polling and manual refresh, not a required public webhook receiver. Local task/workout use must continue when WHOOP is unconfigured, offline, stale, or disconnected.

## Verified public API surface

The consumer endpoints use `/developer/v2`. OAuth scopes include `read:workout`, `read:cycles`, `read:recovery`, `read:sleep`, `read:profile`, and `read:body_measurement`.

| Observation | Available summary fields |
| --- | --- |
| Workout | Sport, start/end, strain, average/maximum heart rate, energy, recording percentage, distance, altitude, heart-rate-zone durations |
| Cycle | Start/end, strain, energy, average/maximum heart rate, step count |
| Recovery | Recovery score, resting heart rate, HRV, SpO2, skin temperature, calibration state |
| Sleep | Start/end, nap, stage totals, disturbances, sleep need, respiratory rate, performance, consistency, efficiency |

Resources include IDs, timestamps and score state. Collections paginate with maximum page size 25. Detailed strength sets/reps and consumer workout write-back are absent from the published surface. The separate trusted-partner laboratory write endpoints are not consumer workout access. Revoke uses `DELETE /developer/v2/user/access`. [API reference](https://developer.whoop.com/api/)

Continuous heart-rate samples are not available through this API. WHOOP also says developers need a device and membership; API access itself is currently free. [Support](https://developer.whoop.com/docs/developing/support/)

## Connecting a private installation

A WHOOP developer app supplies its own client ID and secret and registered redirect URI; the OAuth request must match a registered URI. Request only needed scopes. Independent self-hosters should configure their own app credentials rather than receive a shared secret in source code. [Getting started](https://developer.whoop.com/docs/developing/getting-started/)

Use authorization-code OAuth with state validation. Authorization and token URLs are `https://api.prod.whoop.com/oauth/oauth2/auth` and `https://api.prod.whoop.com/oauth/oauth2/token`. Request `offline` for a refresh token; refresh responses supply a new access token and refresh token, which should be saved atomically. Respect returned expiry rather than assuming a permanent token. Revocation stops associated webhooks. The documentation's redirect examples are HTTPS and custom schemes; acceptance of a particular localhost HTTP callback remains unverified and must be tested before documenting a local installation path. [OAuth](https://developer.whoop.com/docs/developing/oauth/)

New apps have Sandbox access for up to 10 members without a request. Higher tiers are Build (100), Growth (1,000), Scale (5,000), and Production (unlimited), requested consecutively. From Build onward, advancement requires at least half the current limit connected. Review asks for tested behavior, accurate app/contact/privacy information, and compliance with WHOOP's terms and design guidelines. This is sufficient evidence that one private connection need not wait for public launch approval, but it does not verify this user's dashboard or consent. [App approval](https://developer.whoop.com/docs/developing/app-approval/)

Recommended initial scope set: workout, cycles, recovery, sleep, and offline. Obtain the provider user ID from returned records when present; add profile scope only if the implementation actually needs the profile endpoint for identity/empty-account handling. Do not request body measurements merely because available. Store client secret and tokens only in private server-side configuration/storage; never expose them to the browser, agent transcripts, committed fixtures, or repository.

## Webhooks and request limits

Webhooks require HTTPS. v2 is the default; v1 is no longer published despite legacy examples remaining. Updates/deletions exist for workout, sleep, and recovery; creation appears as update. Recovery v2 events identify the associated sleep UUID. Events are notifications requiring API fetches, can duplicate or be missed, and need reconciliation. There are no cycle/day-strain/body-measurement events. Validate the signature with base64 HMAC-SHA256 over timestamp plus raw body using the app secret. Failed delivery is retried five times over roughly an hour; return 2xx promptly after durable acceptance. [Webhooks](https://developer.whoop.com/docs/developing/webhooks/)

Default limits are 100 requests/minute and 10,000/day. Headers describe remaining budget/reset; over-limit requests return 429. [Rate limiting](https://developer.whoop.com/docs/developing/rate-limiting/)

## Alternatives and bounded behavior

| Choice | Assessment |
| --- | --- |
| Read-only summaries with polling | Recommended first: matches public access, works without inbound public HTTPS, covers cycles as well as activities. |
| Webhooks plus reconciliation | Later option for an always-reachable deployment; faster changes but extra endpoint/security/queue work and polling still needed. |
| Provider as the workout editor | Reject for the first slice: public consumer API does not supply the required strength detail or workout write-back. |
| Defer WHOOP entirely | Conflicts with the confirmed integration requirement; it may remain optional to configure without disappearing from the plan. |

Proposed polling policy: while the service runs and is connected, refresh no more often than hourly, plus a rate-limited manual refresh. Reconcile a rolling seven-day window and the current cycle; paginate completely inside that window. This is an engineering starting value, not a promise of WHOOP update latency. A four-collection, one-page-per-collection hourly schedule is about 96 data requests/day before pagination, manual refresh and OAuth traffic. A stopped local service cannot promise background freshness.

Use a connection timestamp as the initial lower bound: no automatic full-history backfill. A small context window for an ongoing cycle/sleep spanning connection time is operational synchronization, not a migration; show this behavior in connection copy. The final spec should make that window explicit.

Keep provider kind, connected account ID, resource type/ID, provider update time, observation time interval/timezone, retrieval time, and score state with every observation. Upsert by account/type/provider ID; never infer identity from date alone. Preserve missing or pending scores as unavailable, not zero. Label values as WHOOP observations, show last successful refresh and failures, and do not label stale data as live. Local workouts may link explicitly to a WHOOP workout without overwriting local detail or counting it twice. Similar timestamps may suggest a match but must not silently merge records.

For provider deletion, remove/tombstone the provider observation and its derived contribution; preserve local workouts and invalidate their optional provider link. A record missing from one page/window is not by itself deletion evidence. On disconnect, stop sync, revoke while a token is available, delete local credentials, and report a failed remote revocation honestly. Offer retaining or deleting cached observations explicitly; cached data must remain marked disconnected if retained. Do not delete local workout records. A later policy must decide the default cache retention; it is not settled here.

## Implementation verification versus account consent

Automated tests can use fictional provider responses to cover paging, repeat sync, late score updates, missing values, account separation, expiry/refresh rotation, 401 reconnect, 429/backoff, failure freshness, and disconnect. If webhooks are implemented later, add signature/replay checks, duplicates, deletion, and reconciliation tests. No real health records are needed for these tests.

Live completion requires the owner to register/configure their developer app, provide credentials through private configuration, and personally approve WHOOP consent. Verify a successful v2 read, subsequent refresh, and disconnect using that authorized account. Do not ask for a password, secret, or token in chat. Until then, report the adapter as built/tested with fixtures, not as a working account connection.

## Remaining implementation gates

- Select the installation callback URI and test its actual acceptance; public docs do not establish that a desired localhost URI works.
- Confirm whether profile scope is necessary to establish identity before observations exist.
- Specify cached-observation retention on disconnect.
- Set the deployment-specific scheduler and refresh window in the implementation spec.

These are explicit implementation decisions, not blockers to resolving the research question.
