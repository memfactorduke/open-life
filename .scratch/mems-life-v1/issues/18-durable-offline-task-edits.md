# 18: Preserve ordinary task edits offline

Status: ready-for-agent
State: claimed
Blocked by: 05, 07, 15, 17
Spec: [Mem's Life first release](../spec.md)
Coverage: US-21
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

Native task capture and ordinary edits work offline while execution-sensitive actions wait for the service.

## Acceptance criteria

- [ ] Cache useful task views and preserve new Planned tasks, descriptions and ordinary edits in the durable outbox.
- [ ] Clearly distinguish saved locally, pending, synced and conflicted state.
- [ ] Require online confirmation for release and changes/completion that can trigger agent work; do not falsely show those effects as committed. Artifact-approval offline gating is verified by the versioned-deliverable ticket.
- [ ] Handle edit/delete races and recurrence conflicts without resurrecting tombstoned work or fabricating occurrence completion.
- [ ] Respect account partitions and pending changes on logout; web remains honestly online-first.

## Verification

Capture and edit tasks offline in a dataset containing a released mixed workflow, attempt a forbidden release/completion, reconnect after a competing delete and preserve rejected content for review without advancing agent work.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, historical [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. Independent checkout includes offline projection/outbox, online-sensitive gating and recovery component tests plus actual Node SQLite/HTTP recovery scripts. PostgreSQL synchronization and task revision/tombstone behavior are passing service coverage.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence remaining: Current actual native offline capture/edit, forbidden consequential action, competing delete/recurrence conflict and logout-pending-state journey remains. Component mocks cannot establish Expo durability or claim committed agent effects. Unchecked criteria retain their complete literal requirement; implemented/passing subsets are recorded above. State remains claimed until all criteria and blockers qualify. Raw detailed logs/screenshots named by receipts are local-only evidence; safe receipts are the shareable index.
