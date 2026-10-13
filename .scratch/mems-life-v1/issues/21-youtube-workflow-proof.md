# 21: Prove the complete YouTube handoff workflow

Status: ready-for-agent
State: claimed
Blocked by: 16, 20
Spec: [Mem's Life first release](../spec.md)
Coverage: US-20, US-24–28, US-31
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

An editable example workflow demonstrates the entire mixed human/agent production path using test artifacts.

## Acceptance criteria

- [ ] Represent script, human recording, agent edit, human review, private upload, agent thumbnail, human thumbnail approval/attachment and human publication.
- [ ] Allow thumbnail drafting after the script in parallel with recording/editing; publication waits for both accepted paths.
- [ ] Distinguish watching, approval, private upload and publication, with version-specific evidence and feedback loops.
- [ ] Exercise automatic continuation, pause, competing workers, stale output and uncertain-upload recovery end to end.
- [ ] Use generic MCP test clients and fictional artifacts; do not build real editors/upload integrations or publish personal media.

## Verification

Run the full scenario twice, once with rejected edit/retry and once with lost upload response; both end with exactly one verified human publication event.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. PostgreSQL fictional YouTube scenarios exercise parallel thumbnail/edit paths, rejected edit/retry, uncertain upload and exactly one verified human publication event; generic SDK claim/finish tests separately exercise two clients. No real editor/upload integration or personal publication is performed.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Do not conflate the operation-boundary full scenario with a fully SDK-driven scenario or final native visibility. End-to-end generic-client and cross-client acceptance boundaries need final review; tickets 16/20 remain prerequisites. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
