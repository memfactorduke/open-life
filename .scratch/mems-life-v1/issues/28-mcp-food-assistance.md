# 28: Manage food diary records through MCP

Status: ready-for-agent
State: claimed
Blocked by: 11, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-30
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

An authorized external agent can read or record explicitly reported food entries through the same service used by the diary.

## Acceptance criteria

- [ ] Expose food entry read/create/edit operations and an authorized bounded attachment workflow through the generic MCP adapter.
- [ ] Require appropriate domain scopes and source attribution; never infer that a plan was eaten or invent nutrient measurements.
- [ ] Reuse the private media lifecycle without exposing storage paths, credentials or another owner's photos.
- [ ] Preserve revisions and idempotency so retries do not create duplicate food entries or attachments.
- [ ] Demonstrate an agent-created fictional entry in web/native history and reject a read-only or revoked client's write.

## Verification

Record an explicitly reported fictional meal with an authorized MCP client, view it on phone, retry the request and confirm one entry with preserved provenance.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real header-capable SDK/PostgreSQL MCP food tests exercise reported provenance, scopes, revision/replay and authorized media lifecycle. Independent production browser proves private diary history, while earlier native history receipt identifies separately created fictional records.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: The exact same agent-created fictional meal still needs final web/native history proof with read-only/revoked-write rejection linked to that journey. Separate native food examples do not prove MCP visibility; retain tickets 11/19 blockers. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
