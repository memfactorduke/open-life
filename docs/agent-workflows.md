# Agent workflow coordination

Mem's Life stores the plan, immutable execution snapshots, progress, results and review history. An external worker discovers work through Streamable HTTP MCP and performs it elsewhere. No agent runtime, process launcher, video editor, upload integration or shell execution is embedded in the application. Skill instructions and linked resources are untrusted data for the external worker; selecting a skill cannot increase its credential scopes.

## Release and handoff

A Planned task is dormant. Move it to Next deliberately. A claim on a ready bound agent/either step moves the parent Active. Paused tasks accept no new claims. Dependencies and human steps use the existing task graph: completing a prerequisite exposes all ready agent steps automatically, without another Start action. Human recording, review, thumbnail attachment and publication remain separate actions.

Each skill reference retains every version. A binding selects a specific version, supplies all required inputs and declares keyed output requirements, retry policy and effect risk. Binding requirements cannot remove required outputs from the selected procedure. Choose `requiresApproval: true` when a person must approve the result; otherwise a valid finished result completes the step immediately. A no-review result has no fabricated human approval. Approval names a specific latest result ID/version. Viewing or submitting a preview does not approve it.

## MCP contract

Use a manually configured expiring, revocable agent credential with `tasks:read` for discovery and `tasks:write` for mutations. Transport, grant expiry and live authorization are shared with ordinary product operations.

| Tool | Purpose |
| --- | --- |
| `agent_skills_list` | Read reusable skill versions. |
| `agent_steps_eligible` | Discover released, unpaused, dependency-ready work with a binding. |
| `agent_workflow_read` | Read the task, steps, bindings, immutable attempts and result versions. |
| `agent_workflow_command` | Submit validated skill/binding edits, claims, heartbeats, progress, results and recovery operations. |

Owner sessions use `GET /api/agent-workflows/skills`, `GET /api/agent-workflows/eligible`, `GET /api/tasks/:id/agent-workflow` and `POST /api/agent-workflows/commands`. Both adapters call the same service. Domain response schemas validate the same authoritative shapes in clients. Agents cannot approve results, request human review changes, cancel another participant's work or reconcile consequential outcomes. They also cannot remove an existing required human review gate or turn a required human step into agent work. Those operations require an owner session.

For a claim, securely generate 32 random bytes and encode them as unpadded base64url (43 characters). Send that `ownershipToken` with `attempt.claim`, keep it privately in the worker's durable pending-operation state, and reuse it for the owned attempt's heartbeat/progress/finish/fail/yield. The claim receipt returns attempt identity and expiry; it does not reveal a secret the caller already possesses. The server stores only its SHA-256 verifier, including in operation-receipt request data. Another grant cannot use a stolen attempt token: both grant identity and verifier must match.

Claims have a server-controlled two-minute lease. Renew before expiry with `attempt.heartbeat`; read `expiresAt` from the response. The initial claim snapshots step instructions, binding revision, resolved skill version, inputs, completion requirements and dependency revisions. Later skill edits preserve earlier snapshots. Changed step content, binding or prerequisite execution revisions reject stale authoritative writes. Execution revisions change when instructions or status actually change; assigning a different reviewer does not invalidate a running dependent attempt. Approving an already approved current version is a no-op. Revisions are independent from the protected ownership token.

Every mutation has a UUID operation ID. After live authorization, a matching committed receipt is returned before checking a new mutation's lease or revisions. Keep the same payload and ID after a lost response. Reusing an ID for different content is an error. This permits a committed finish to be recovered after its original lease expired. Revocation/expiry still denies receipt access. Progress, attempt changes, result approval and invalidation enter the same committed owner feed and attributable audit history as ordinary product work.

## Results and recovery

Results contain keyed bounded text, HTTP/HTTPS links without embedded credentials, or opaque finalized private task-file IDs. The service checks required key/type pairs and rejects duplicate keys, unfinished files, another owner's files and another task's files. Local filesystem paths are never an artifact contract. File transfer uses authenticated bounded staging/finalization endpoints; result references do not bypass those checks.

`result.request-changes` records feedback on the old version, clears its approval and returns the step for a new attempt if retry is enabled. A later result receives a new immutable version and file IDs. Approval of an older version cannot approve its replacement. Instruction or prerequisite changes reopen current readiness and invalidate affected acceptance; prior execution events remain in history. Parent completion requires all required steps, their current declared output/review requirements and any final review.

`attempt.cancel` requests cooperative stopping. It does not report that an upload or publication was undone. The worker can acknowledge a stopped outcome with fail/yield, or record an unknown outcome. A cancellation prevents further lease renewal or finish. A lease expiry alone never proves an external action stopped. For an `external-effect` binding, expiry, uncertain failure or invalidation becomes Outcome unknown and blocks another consequential claim.

An owner uses `attempt.reconcile` with evidence after checking the external destination. Before `not-performed` can permit another external-effect attempt, provide separate `workerStoppedEvidence`; destination absence alone is insufficient. A live running or cancel-requested lease cannot be replaced through reconciliation. After expiry or terminal acknowledgment, the owner must still verify that the old worker and outstanding job have stopped.

`performed` requires validated outputs and preserves the original attempt and external receipt evidence. A compatible no-review result completes automatically; a declared review gate still needs human approval. An old result incompatible with current instructions is retained as historical evidence and does not satisfy current requirements or permit another effect. Only explicit `allowReplacement: true`, together with stopped-worker evidence, authorizes replacing that known effect. Human takeover uses this same cancel-and-reconcile path; it never fabricates a rollback.

## Editable example

An owner submits `{type: "workflow.youtube-create", operationId, taskId}` through the ordinary workflow command endpoint to create the eight-step fictional YouTube example atomically. The response returns its new Planned task. Skills, bindings, steps, the thumbnail branch and review requirements are editable through ordinary operations. Repeating the same creation operation returns its original task without duplicating the graph. Deliberate release remains a separate owner choice; no worker or real publication starts when the template is created.

## Verification fixtures

`apps/server/test/agent-workflows.test.ts` uses isolated PostgreSQL and an editable fictional graph: script → human recording → agent edit → human review → private upload; thumbnail drafting branches after script, then human thumbnail approval/attachment and human publication. It runs a rejected-edit scenario and an uncertain-upload scenario, each preserving exactly one human publication fixture event and one verified private-upload attempt. No real media or publication side effects run.

`apps/server/test/mcp-workflows.test.ts` uses two real SDK clients and separate scoped grants against PostgreSQL. It proves competing claims, claim/finish receipt recovery, stale ownership rejection, grant-bound tokens and denial of human-only operations. Database fixtures establish coordinator behavior; they do not establish a live editor, video provider, public HTTPS deployment, native review UI or any particular agent product's compatibility.
