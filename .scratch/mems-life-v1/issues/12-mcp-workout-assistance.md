# 12: Let authorized agents assist with workouts

Status: ready-for-agent
State: claimed
Blocked by: 04, 11
Spec: [Mem's Life first release](../spec.md)
Coverage: US-29
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

An authorized agent can prepare routines and record explicitly reported training through the same rules as the UI.

## Acceptance criteria

- [ ] Expose routine/exercise reads and allowed planning mutations plus session/result operations under distinct scopes.
- [ ] Require reported/imported provenance for agent-written actual results; preparing a plan never invents a performed session.
- [ ] Keep routine revisions separate from session snapshots and preserve actor/history on corrections.
- [ ] Validate irrelevant/invalid measurements and reject stale session writes without losing the person's newer data.
- [ ] Demonstrate a generic client creating a routine and recording fictional reported results visible on phone/web.

## Verification

Author a routine by MCP, start it in the UI, submit an explicitly reported set and reject an unscoped or stale correction.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real SDK/PostgreSQL MCP tests create a routine and explicitly reported actual set, verify grant actor history, replay and stale-set rejection. Session service proof establishes plan/snapshot isolation and irrelevant-mode validation.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: A final phone/web journey of that same MCP-created routine and reported result remains required; separate fixture records or native UI mocks cannot establish this cross-client criterion. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
