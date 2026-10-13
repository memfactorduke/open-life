# 13: Bind reusable skills to agent steps

Status: ready-for-agent
State: resolved
Blocked by: 10, 11
Spec: [Mem's Life first release](../spec.md)
Coverage: US-23
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

Give an agent step a reusable procedure, inputs and a defined deliverable without hosting agent execution.

## Acceptance criteria

- [x] Create/edit skill references and bind a selected version with inputs and expected outputs to a step.
- [x] Keep the skill binding separate from the worker connection and credential permissions.
- [x] Surface missing skill/input details before work is eligible and preserve human-readable execution instructions.
- [x] Snapshot resolved instruction/skill version for an attempt so later edits do not rewrite execution history.
- [x] Treat instructions and linked content as data, not privileged app code; enforce the same binding operations through UI/MCP.

## Verification

Bind a script-writing procedure, revise it, and show that an earlier execution snapshot and the next plan refer to the correct versions.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. PostgreSQL agent-workflow tests bind versioned skills with inputs/output requirements and preserve the attempt instruction snapshot after a later skill edit; workflow UI browser/component checks provide bounded presentation evidence.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 13.1–13.5: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json), browser execution `agent-workflow-ui/browser-tests.log` and current native `features/__tests__/agent-workflow.test.tsx`. Real PG `agent-workflows.test.ts` snapshots instruction/skill versions, preserves missing-input eligibility boundaries and unprivileged instructions; the real SDK workflow test enforces binding and human-review scope policy. These are ordinary binding/UI/service proofs; no agent execution runtime is introduced.
