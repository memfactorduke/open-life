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
