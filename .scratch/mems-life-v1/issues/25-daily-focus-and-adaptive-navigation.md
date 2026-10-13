# 25: Use a daily focus view across phone, tablet and web

Status: ready-for-agent
State: claimed
Blocked by: 04, 07, 10, 15, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-60–62, US-66
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

Reach the next useful action across tasks, active training and food without losing dedicated domain navigation.

## Acceptance criteria

- [ ] Provide direct Tasks/Workouts/Food navigation plus Today with due/next human actions, waiting reasons, active session and quick food capture.
- [ ] Use a practical one-handed phone layout, adaptive iPad list/detail management and denser keyboard-friendly web planning.
- [ ] Retain useful navigation/view state without mixing histories or hiding failed/pending work.
- [ ] Cover empty, loading, offline, no-permission and recoverable-error states; preserve in-progress input.
- [ ] Verify compact/wide tablet sizes, rotation/resizing, non-drag alternatives and navigation to each underlying record.

## Verification

Use one fictional day containing due work, an agent handoff, an active workout and a food entry on all three client layouts.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Recorded live PostgreSQL Today day projection and browser journeys cover direct domain navigation and exact underlying records at five viewport sizes; independent production web passes three engines and bounded phone/tablet focus/overflow checks.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current native Today compact/wide/rotation, retained state and error/offline navigation remain. Browser sizes do not prove actual iPad rotation, and bounded 125% text/focus checks are not a full accessibility audit. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
