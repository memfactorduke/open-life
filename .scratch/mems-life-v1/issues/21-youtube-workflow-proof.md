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
