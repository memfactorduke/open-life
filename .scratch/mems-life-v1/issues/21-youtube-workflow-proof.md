# 21: Prove the complete YouTube handoff workflow

Status: ready-for-agent
State: resolved
Blocked by: 16, 20
Spec: [Mem's Life first release](../spec.md)
Coverage: US-20, US-24–28, US-31
Phase: verified complete fictional SDK workflow; actual external integrations remain outside initial scope

## What to build

An editable example workflow demonstrates the entire mixed human/agent production path using test artifacts.

## Acceptance criteria

- [x] Represent script, human recording, agent edit, human review, private upload, agent thumbnail, human thumbnail approval/attachment and human publication.
- [x] Allow thumbnail drafting after the script in parallel with recording/editing; publication waits for both accepted paths.
- [x] Distinguish watching, approval, private upload and publication, with version-specific evidence and feedback loops.
- [x] Exercise automatic continuation, pause, competing workers, stale output and uncertain-upload recovery end to end.
- [x] Use generic MCP test clients and fictional artifacts; do not build real editors/upload integrations or publish personal media.

## Verification

Run the full scenario twice, once with rejected edit/retry and once with lost upload response; both end with exactly one verified human publication event.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. PostgreSQL fictional YouTube scenarios exercise parallel thumbnail/edit paths, rejected edit/retry, uncertain upload and exactly one verified human publication event; generic SDK claim/finish tests separately exercise two clients. No real editor/upload integration or personal publication is performed.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 21.1–21.4: [independent clean-checkout execution](../evidence/clean-checkout/verification.json); both full eight-step `apps/server/test/agent-workflows.test.ts` stories cover script, recording, edit/review, private upload, parallel thumbnail, attachment/approval and publication with fictional artifacts, competing claims, pause/stale/rejection/unknown-upload recovery. Three-engine template journey confirms eight editable dormant steps. 21.5 stays unchecked until the full external-agent story is run through generic SDK; `mcp-workflows.test.ts` currently proves a separate smaller SDK story and must not be relabelled as all eight steps.

Evidence: Acceptance update (2026-10-13). 21.5 now has actual full-story transport evidence: [SDK eight-step receipt](../evidence/youtube-sdk-proof/receipt.json) records both rejected-edit and lost-fictional-upload scenarios, all eight completed steps, parallel thumbnail claim, real owner HTTP human gates, explicit unknown-outcome reconciliation, one fictional external action, exact finish replay and durable complete state through a fresh SDK connection. External-agent actions use official SDK 1.32.1 Streamable HTTP; destinations/artifacts/publication are fictional and no real upload/publication occurs. Receipt binds its verifier script SHA-256 rather than a complete service manifest; current app/agent/MCP source hashes were independently compared with the existing final-container source manifest and match. Historical smaller SDK receipt remains bounded; this new receipt closes the prior full-SDK gap. State remains claimed until ticket20 resolves.

Evidence: Acceptance dependency update (2026-10-13). Tickets16 and20 now resolve; all five criteria have actual scoped composite proof including [full eight-step SDK execution](../evidence/youtube-sdk-proof/receipt.json). Ticket21 resolves without asserting a real editor, upload or publication.
