# 07: Schedule dates and recurring work

Status: ready-for-agent
State: claimed
Blocked by: 02
Spec: [Mem's Life first release](../spec.md)
Coverage: US-11–12
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Track due/scheduled work and recurring responsibilities with stable occurrence history.

## Acceptance criteria

- [ ] Support optional due and scheduled dates and daily, selected-weekday/weekly and monthly recurrence in an IANA time zone.
- [ ] Keep a recurrence series separate from each occurrence; complete/skip affects one occurrence and series edits explicitly affect future ones.
- [ ] Generate the next outstanding occurrence idempotently without flooding the board with fabricated past completions.
- [ ] Use the last valid day for missing monthly dates and document/test daylight-saving transitions and late completion behavior.
- [ ] Show upcoming/overdue work and let the person cancel a series without losing completed occurrence history.

## Verification

Complete an overdue weekly task twice through retried requests, edit future recurrence, and test month-end and daylight-saving examples.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL productivity and domain calendar tests cover occurrence/series identity, retries, future edits and month-end/DST boundaries. Three-engine productivity proof covers future monthly edit, skip and cancellation without losing archived history.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current native date/recurrence/upcoming/overdue management journey is not indexed; implementation and fixture coverage do not qualify all-client acceptance. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
