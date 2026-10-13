# 16: Recover interrupted and uncertain agent work

Status: ready-for-agent
State: claimed
Blocked by: 15
Spec: [Mem's Life first release](../spec.md)
Coverage: US-26–28
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Failures, cancellation, takeover and lost connections produce recoverable history without duplicate external effects.

## Acceptance criteria

- [ ] Retry creates a new attempt while retaining prior progress, outputs and errors; respect configured retryability.
- [ ] Cancellation is cooperative and visible; it does not claim an already performed external action was undone.
- [ ] Block late completion from expired/replaced owners or incompatible changed instructions.
- [ ] Represent unknown external outcomes explicitly and require reconciliation evidence before allowing a duplicate consequential attempt.
- [ ] Support human takeover/yield/recovery through authorized operations and test lease expiry, server restart and stale responses.

## Verification

Expire a worker during a simulated upload, reject its late finish, reconcile the external receipt and avoid a second upload.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. PostgreSQL agent-workflow scenarios include retry history, cooperative cancellation, expired ownership, outcome-unknown reconciliation and retained outcomes after reopening a database pool. Generic SDK tests independently prove lost finish-response recovery and stale owner denial.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Full current native takeover/retry/uncertain-outcome views are not established. Unknown external effects stay explicitly unknown until evidence is reconciled; cancellation never proves external undo. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
