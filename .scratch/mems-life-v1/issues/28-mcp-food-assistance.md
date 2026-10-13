# 28: Manage food diary records through MCP

Status: ready-for-agent
State: resolved
Blocked by: 11, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-30
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

An authorized external agent can read or record explicitly reported food entries through the same service used by the diary.

## Acceptance criteria

- [x] Expose food entry read/create/edit operations and an authorized bounded attachment workflow through the generic MCP adapter.
- [x] Require appropriate domain scopes and source attribution; never infer that a plan was eaten or invent nutrient measurements.
- [x] Reuse the private media lifecycle without exposing storage paths, credentials or another owner's photos.
- [x] Preserve revisions and idempotency so retries do not create duplicate food entries or attachments.
- [x] Demonstrate an agent-created fictional entry in web/native history and reject a read-only or revoked client's write.

## Verification

Record an explicitly reported fictional meal with an authorized MCP client, view it on phone, retry the request and confirm one entry with preserved provenance.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real header-capable SDK/PostgreSQL MCP food tests exercise reported provenance, scopes, revision/replay and authorized media lifecycle. Independent production browser proves private diary history, while earlier native history receipt identifies separately created fictional records.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 28.1–28.5: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [actual SDK and exact web records](../evidence/native-mcp-roundtrip/receipt.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json), actual native exact meal history in `native-gym-food/sqlite-fixed-release/ipad-shared/`. SDK receipt names exact meal ID, reported actor/history, one-entry retry, read-only and revoked-write denials plus exact web display. Shared PG/SDK food/media assertions cover bounded private transfer, revisions/attribution/owner authorization. This supersedes the stale claim that the same MCP meal has not reached native/web.
