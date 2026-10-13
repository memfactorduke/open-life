# 24: Use WHOOP context without replacing local training

Status: ready-for-agent
State: claimed
Blocked by: 04, 11, 23
Spec: [Mem's Life first release](../spec.md)
Coverage: US-30, US-55–57, US-59
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Display fresh read-only WHOOP observations and explicitly link them to local sessions without duplicate activity.

## Acceptance criteria

- [ ] Read v2 workout/cycle/recovery/sleep observations with bounded hourly polling, manual refresh throttling, pagination and the specified connection-time/seven-day window.
- [ ] Upsert by provider account/type/ID with score state, time zone, interval, provider revision time and retrieval freshness.
- [ ] Show missing/unscored and stale/failed states honestly; handle 401, 429, rotated credentials and duplicate/reordered observations.
- [ ] Offer explicit suggested-session linking; never silently merge by timestamp, overwrite local sets/notes or double count one activity.
- [ ] Expose permitted provider reads through MCP without credentials; do not promise unsupported write-back, detailed strength data or continuous heart-rate streams.
- [ ] Recheck known IDs within the bounded reconciliation window and support manual refresh for older observations; authenticated resource-specific 404 marks provider data unavailable without deleting local workout results.

## Verification

Replay paginated fictional observations with updates, missing scores and outages, link one to a session and confirm stable totals and intact local results.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. WHOOP real-PG fixtures cover hourly throttling, pages, score-null versus scored, identity/freshness, replacement account separation, errors and authenticated resource 404 unlinking while preserving local workout results. Shared app/SDK wiring tests exercise scoped credential-free WHOOP reads.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current native freshness/unavailable/source/linking views and exact polling-window acceptance need final index/review. Fixture OAuth/observations are adapter proof only; live WHOOP remains ticket 29 gate. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
