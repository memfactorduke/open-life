# 11: Manage tasks through generic MCP

Status: ready-for-agent
State: resolved
Blocked by: 05, 10
Spec: [Mem's Life first release](../spec.md)
Coverage: US-03, US-22, US-31
Phase: verified implementation by scoped composite execution; external gates remain in ticket 29

## What to build

A generic external MCP client can securely read and change the same task records and configuration used by the person.

## Acceptance criteria

- [x] Expose validated task/project/board/subtask operations through Streamable HTTP and a real header-capable MCP test client.
- [x] The owner creates scoped expiring revocable agent credentials; display secrets once, store safe verifiers and log only grant identity.
- [x] Reject insufficient scope, expired/revoked grants and cross-owner access on every call; agent grants cannot administer credentials.
- [x] Demonstrate bidirectional UI/MCP consistency and idempotent/stale-write behavior through the shared application service.
- [x] Document manually configured credential support accurately; do not advertise automatic OAuth interoperability or a named runtime without verification.

## Verification

Configure two generic test clients with different scopes, edit a task/configuration, observe it in UI, then revoke one and prove access stops.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. `apps/server/test/mcp.test.ts` runs a real header-capable Streamable HTTP SDK client against PostgreSQL: scopes, actor attribution, exact replay, stale writes, cross-owner denial, owner-only grant administration, immediate revocation and expiry. Production browser auth checks are separate owner-session evidence.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 11.1–11.5: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [actual SDK and exact web records](../evidence/native-mcp-roundtrip/receipt.json); `apps/server/test/mcp.test.ts`, `mcp-workflows.test.ts`, shared productivity tests and the UI access browser journey establish real Streamable HTTP SDK transport, owner-issued scoped/revocable/expired grants, credential administration rejection, shared records and idempotency. Task/project/board/step operations use validated shared service boundaries. `docs/mcp.md` describes manually configured header credentials; no automatic OAuth/runtime/public HTTPS claim. Native meal/routine proof is supplementary shared-adapter evidence.
