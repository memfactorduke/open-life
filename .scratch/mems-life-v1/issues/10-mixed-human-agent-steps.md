# 10: Break outcomes into human and agent steps

Status: ready-for-agent
State: claimed
Blocked by: 02
Spec: [Mem's Life first release](../spec.md)
Coverage: US-13–16
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Represent one outcome with ordered subtasks, responsibility and parallel dependencies, showing what can happen next.

## Acceptance criteria

- [ ] Support one level of required/optional subtasks assigned to human, agent or either, without copying tasks into separate stores.
- [ ] Validate an acyclic dependency graph and reject cross-owner edges or deletion that silently breaks required work.
- [ ] Separate dependency readiness, deliberate release, assignment and active execution; Planned work remains dormant.
- [ ] Show next actions and waiting reasons in the parent and human/agent filtered views.
- [ ] Apply parent completion/reopening rules without treating one finished step as the entire outcome.

## Verification

Model a small mixed workflow with two parallel branches, reject a cycle and verify that only required satisfied steps allow parent completion.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL productivity tests exercise mixed responsibility, acyclic/cross-owner graph rules, dormant Planned tasks and parent completion readiness. Fifteen three-engine productivity cases cover mixed parallel dependencies and next-action UI; native component evidence is bounded to rendered component behavior.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Actual current native human/agent filtered views and complete/reopen dependency journey remain unverified. Ticket02 prerequisite is retained. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
