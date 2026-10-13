# 07: Schedule dates and recurring work

Status: ready-for-agent
State: resolved
Blocked by: 02
Spec: [Mem's Life first release](../spec.md)
Coverage: US-11–12
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

Track due/scheduled work and recurring responsibilities with stable occurrence history.

## Acceptance criteria

- [x] Support optional due and scheduled dates and daily, selected-weekday/weekly and monthly recurrence in an IANA time zone.
- [x] Keep a recurrence series separate from each occurrence; complete/skip affects one occurrence and series edits explicitly affect future ones.
- [x] Generate the next outstanding occurrence idempotently without flooding the board with fabricated past completions.
- [x] Use the last valid day for missing monthly dates and document/test daylight-saving transitions and late completion behavior.
- [x] Show upcoming/overdue work and let the person cancel a series without losing completed occurrence history.

## Verification

Complete an overdue weekly task twice through retried requests, edit future recurrence, and test month-end and daylight-saving examples.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL productivity and domain calendar tests cover occurrence/series identity, retries, future edits and month-end/DST boundaries. Three-engine productivity proof covers future monthly edit, skip and cancellation without losing archived history.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 07.1–07.5: [three-engine productivity execution](../evidence/productivity-web/verification.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); named `productivity.test.ts` calendar/PG cases and mobile date/recurrence cases cover month-end, DST, occurrence identity, retries, future-series edit and conflict review. Three-engine future edit/skip/cancel journeys preserve completed history; actual native date/time picker is in `native-gym-food/sqlite-fixed-release/phone-fixed-modals/`. These establish calendar/service behavior without claiming a new native OS clock test.
