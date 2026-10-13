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
