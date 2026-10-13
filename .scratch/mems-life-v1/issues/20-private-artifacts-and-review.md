# 20: Review private versioned deliverables

Status: ready-for-agent
State: resolved
Blocked by: 14, 19
Spec: [Mem's Life first release](../spec.md)
Coverage: US-18–19, US-52
Phase: verified implementation by scoped composite execution; external gates remain in ticket29

## What to build

Attach private files/results, review a specific version and request revisions without losing earlier work.

## Acceptance criteria

- [x] Reuse the food diary's authenticated bounded media transfer and private persistent volume for task files and result artifacts, with immutable IDs and appropriate type/size/checksum validation.
- [x] Handle the database/filesystem finalization gap, retries, orphan cleanup and storage failure without broken finalized attachments.
- [x] Create result versions; viewing is not acceptance, and explicit approval names the accepted version.
- [x] Requesting changes returns the work for another attempt with feedback; changed artifacts invalidate relevant approval/readiness.
- [x] Approval requires online confirmation; disconnect or lose the response during approval and prove that the UI never claims acceptance before reconciling the server result.
- [x] Protect owner access, strip private media metadata from newly derived display copies where appropriate, and preserve useful history and original provenance.

## Verification

Upload and approve a fictional edit, replace it, confirm approval is invalidated, and test interrupted finalization plus unauthorized file access.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Real PostgreSQL task-file/agent-workflow tests cover bounded private files, finalization/replay/storage faults, version-specific review/invalidation, provenance and human-only approval. Production three-engine journey includes authenticated private task-file transfer. Workflow browser/component checks cover bounded approval presentation.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe final-container receipt](../evidence/release-safe/receipts/final-container--verification.json) identifies actual app/operator images and independent backup/restore; no public deployment or mobile runtime claim.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 20.1/20.3/20.4/20.6: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [final independent container/restore execution](../evidence/final-container/verification.json), actual PG agent/file/food tests, three-engine `agent-workflow-ui/browser-tests.log` and [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json). Named assertions cover private bounded/checksummed task files, immutable result versions, viewing versus exact approval, feedback/revision invalidation, owner access/derived display metadata/provenance. 20.2 retains the unproven media storage-failure boundary; 20.5 awaits an actual dropped approval response UI assertion that no approval is claimed before reconciliation. Existing component exact-retry proof is preserved and bounded.

Evidence: Acceptance update (2026-10-13). 20.5 now established by [actual approval reconciliation](../evidence/artifact-approval-reconciliation/receipt.json): built Chromium and real PostgreSQL commit approval then abort its200 response before browser receipt. UI never displays Approved before reconciliation; retained review note and exact retry recover one operation receipt/one exact-result approval event; independent page reload also recovers committed approval without another write. Receipt records b5cdf94 and exact web/mobile workflow/service/build hashes; Chromium proof is transport/UI behavior, not a native OS claim. Separately, [history diagnosis](../evidence/artifact-approval-reconciliation/history-diagnosis.json) shows persisted `task.file.finalize` is rejected by the task-history response enum, producing400 for file-bearing task history.20.6 is reopened for that concrete history defect until its contract fix and actual route regression are verified.20.2 storage-failure proof remains separate.

Evidence: Acceptance update (2026-10-13). 20.2 storage-failure requirement now established independently for task files by [streamed task-file ENOSPC receipt](../evidence/media-capacity-proof/task-file-receipt.json). An owned 32 MiB HFS+ image produces actual OS ENOSPC in the distinct task-file stream writer through HTTP/PostgreSQL; temporary files are removed, task unchanged, attachment pending and finalization rejected as UPLOAD_PENDING. The same allocated file retries once after capacity recovery, reconciles to received, finalizes one immutable attachment, replays idempotently and privately downloads original checksum-matching bytes. Source and compiled domain hashes match before/after. Earlier actual finalization-gap/reconciliation and private-volume proofs supply the other clauses; this receipt is filesystem failure evidence, not a Linux quota or physical-disk-full claim. The task-history enum repair at cdf1f84 is being verified separately; old approval receipt retains its historical JavaScript identity.

Evidence: Acceptance update (2026-10-13). 20.6 repaired and verified at cdf1f84: [fresh built-web approval/history receipt](../evidence/artifact-approval-reconciliation/receipt.json) records both real PostgreSQL file-bearing tasks returning history200 with task.file.finalize and no invalid-values banner, plus exact private attachment access and truthful approval reconciliation. The current built JavaScript is index-BjiVYRrP.js, SHA-256096fdde3f1f95c1fb04f3e851e80dbabfb8eea32bbc274e5be52c030cac8d718; it is not the older failing artifact. Receipt binds current domain source/compiled tasks schema and server routes. The history contract now includes finalize and detach; task-file service regression source preserves actor/revision/snapshot/idempotency assertions. Earlier authorization/metadata/provenance/history receipts still supply those unchanged clauses. The historical red receipt, screenshots and diagnosis are retained separately; this supersedes the prior20.6 reopen. With all criteria and resolved14/19 prerequisites, ticket20 is resolved. Later final container refresh is a separate ticket29 packaging boundary.

Evidence: Current source refresh (2026-10-13). [Current canonical workspace receipt](../evidence/final-history-workspace-checks.json) records cdf1f84:39 domain,119 mobile and23 actual PG/server tests (181 total), zero failures/skips, all workspace types/lint/format. [Fresh final-history app/operator image receipt](../evidence/final-history-container/verification.json) records stable source manifestd9efa2c3, app6f4e94b8 and operator376afc90, real compiled task-file finalize/restart/detach history200, private transfers, independent protected restore and zero matching advisory packages in each212-package npm inventory. This bounded npm check excludes native/OS vulnerability review; source-license/external distribution gates remain. Later mobile131 tests overlap119; do not sum them. These receipts supersede older container/source limitations for packaging but do not complete29.3/29.4 quality/physical gates.
