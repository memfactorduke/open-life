# 28: Manage food diary records through MCP

Status: ready-for-agent
State: claimed
Blocked by: 11, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-30
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

An authorized external agent can read or record explicitly reported food entries through the same service used by the diary.

## Acceptance criteria

- [ ] Expose food entry read/create/edit operations and an authorized bounded attachment workflow through the generic MCP adapter.
- [ ] Require appropriate domain scopes and source attribution; never infer that a plan was eaten or invent nutrient measurements.
- [ ] Reuse the private media lifecycle without exposing storage paths, credentials or another owner's photos.
- [ ] Preserve revisions and idempotency so retries do not create duplicate food entries or attachments.
- [ ] Demonstrate an agent-created fictional entry in web/native history and reject a read-only or revoked client's write.

## Verification

Record an explicitly reported fictional meal with an authorized MCP client, view it on phone, retry the request and confirm one entry with preserved provenance.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
