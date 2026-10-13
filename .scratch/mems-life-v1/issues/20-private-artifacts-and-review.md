# 20: Review private versioned deliverables

Status: ready-for-agent
State: claimed
Blocked by: 14, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-18–19, US-52
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Attach private files/results, review a specific version and request revisions without losing earlier work.

## Acceptance criteria

- [ ] Reuse the food diary's authenticated bounded media transfer and private persistent volume for task files and result artifacts, with immutable IDs and appropriate type/size/checksum validation.
- [ ] Handle the database/filesystem finalization gap, retries, orphan cleanup and storage failure without broken finalized attachments.
- [ ] Create result versions; viewing is not acceptance, and explicit approval names the accepted version.
- [ ] Requesting changes returns the work for another attempt with feedback; changed artifacts invalidate relevant approval/readiness.
- [ ] Approval requires online confirmation; disconnect or lose the response during approval and prove that the UI never claims acceptance before reconciling the server result.
- [ ] Protect owner access, strip private media metadata from newly derived display copies where appropriate, and preserve useful history and original provenance.

## Verification

Upload and approve a fictional edit, replace it, confirm approval is invalidated, and test interrupted finalization plus unauthorized file access.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
