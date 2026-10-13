# 12: Let authorized agents assist with workouts

Status: ready-for-agent
State: resolved
Blocked by: 04, 11
Spec: [Mem's Life first release](../spec.md)
Coverage: US-29
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

An authorized agent can prepare routines and record explicitly reported training through the same rules as the UI.

## Acceptance criteria

- [x] Expose routine/exercise reads and allowed planning mutations plus session/result operations under distinct scopes.
- [x] Require reported/imported provenance for agent-written actual results; preparing a plan never invents a performed session.
- [x] Keep routine revisions separate from session snapshots and preserve actor/history on corrections.
- [x] Validate irrelevant/invalid measurements and reject stale session writes without losing the person's newer data.
- [x] Demonstrate a generic client creating a routine and recording fictional reported results visible on phone/web.

## Verification

Author a routine by MCP, start it in the UI, submit an explicitly reported set and reject an unscoped or stale correction.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real SDK/PostgreSQL MCP tests create a routine and explicitly reported actual set, verify grant actor history, replay and stale-set rejection. Session service proof establishes plan/snapshot isolation and irrelevant-mode validation.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 12.1–12.5: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [actual SDK and exact web records](../evidence/native-mcp-roundtrip/receipt.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); `apps/server/test/mcp.test.ts` covers planning/result scopes, reported provenance, snapshots, attribution and denied/stale writes. Exact routine/native-started session IDs and reported 3×22 kg versus planned 8×30 kg appear in `native-gym-food/sqlite-fixed-release/mcp-native-start-server.json`, `mcp-session-agent-history-server.json`, phone-mcp-start and iPad-mcp-result/history. Phone cold-start opens that same session and preserves a later 4×23 kg actual; exact web history is in the SDK receipt. This is composite phone/web proof, not unrelated fictional records.
