# 14: Claim and report an agent attempt

Status: ready-for-agent
State: resolved
Blocked by: 13
Spec: [Mem's Life first release](../spec.md)
Coverage: US-24–25, US-27
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

External workers safely compete for eligible work, maintain ownership and report durable progress/results.

## Acceptance criteria

- [x] Implement eligible-step listing, atomic claim, lease renewal, progress/output submission, finish/fail/yield and attempt lookup.
- [x] Claim snapshots the instruction revision and returns attempt identity plus a protected ownership token and server-controlled expiry.
- [x] Only one live claim succeeds; stale/expired owners cannot renew or submit authoritative completion.
- [x] Persist validated outputs/history before acknowledging success; repeated operation IDs recover the original result.
- [x] Exercise two real generic test clients against PostgreSQL, including competing claims and a lost completion response.
- [x] Authenticate/authorize and return an existing matching operation receipt before new lease/revision validation; retry a successfully committed finish after its lease expired and recover the original result.

## Verification

Race two claims, renew the winner, record progress, finish, and recover the same finished result after discarding the first response.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. `apps/server/test/mcp-workflows.test.ts` races two actual generic SDK clients against PostgreSQL, permits one atomic claim, rejects stolen ownership, persists output, and discards/retries a committed finish after lease expiry to recover exactly the original result. It rejects a fresh late finish and checks ownership tokens absent from receipts/audit/feed/attempt JSON.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 14.1–14.6: [independent clean-checkout execution](../evidence/clean-checkout/verification.json); named actual PG `agent-workflows.test.ts` and real SDK `mcp-workflows.test.ts` cover eligible listing, claim/heartbeat/progress/finish/fail/yield/lookup, immutable instruction snapshot and protected token, atomic races, expired-owner rejection, durable history and exact operation replay after lease expiry. These literal service criteria do not require repeating an unchanged native UI journey.
