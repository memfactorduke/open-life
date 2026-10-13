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

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL task-file/agent-workflow tests cover bounded private files, finalization/replay/storage faults, version-specific review/invalidation, provenance and human-only approval. Production three-engine journey includes authenticated private task-file transfer. Workflow browser/component checks cover bounded approval presentation.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe final-container receipt](../evidence/release-safe/receipts/final-container--verification.json) identifies actual app/operator images and independent backup/restore; no public deployment or mobile runtime claim.

Evidence remaining: Current native versioned file/review journey and actual disconnect/lost-response approval reconciliation remain to be indexed. A rendered success or viewed artifact is not accepted approval. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
