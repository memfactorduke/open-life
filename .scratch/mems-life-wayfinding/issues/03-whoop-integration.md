# WHOOP data and connection boundary

Type: research
Status: resolved
Blocked by: None

## Question

What can the current official WHOOP API reliably add to Mem's Life, how is a private installation connected, and how should imported provider observations coexist with locally recorded workouts? The user confirmed WHOOP and requires no migration of past records.

## Resolution criteria

- Verify current API version, scopes, OAuth, app registration/approval, refresh, revocation, and webhook behavior from primary sources.
- Identify the available workout, recovery, strain, and sleep fields and explicitly distinguish unsupported detailed strength logging or write-back.
- Choose a bounded, nonblocking integration with visible freshness, provenance, deduplication, and disconnect behavior.
- Separate build/test work from the human account-consent step. No credentials or account changes during research.

## Comments


## Answer

Verified the current official consumer v2 API and documented a bounded read-only integration in [WHOOP research](../research/03-whoop.md). Recommend workout/cycle/recovery/sleep observations, optional account configuration, hourly/manual bounded polling first, and local strength records remaining authoritative. No historical migration or consumer workout write-back is planned.

A private app can connect up to 10 members on the current Sandbox tier without submitting approval. Real completion still requires developer-app configuration and the owner's OAuth consent; no credentials or account access were used here. Callback acceptance, minimum identity scope, cache retention and exact polling window remain implementation-spec gates. Webhooks are optional later and require public HTTPS plus reconciliation. The evidence, alternatives, limits, failure behavior and test/consent boundary are in the linked note.
