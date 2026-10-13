---
status: accepted
date: 2026-10-12
---

# Coordinate external agents through MCP

Mem's Life owns workflow state and exposes first-class MCP operations. External watchers and agents execute the work using their existing skills and tools. The initial product does not host language-model sessions or require its own agent runtime. The maintainer has not selected an external runtime; keep this boundary generic to MCP.

## Alternatives considered

- **An embedded execution platform:** gives the app direct control of model sessions but adds provider management, process supervision, runtime isolation, and costs beyond its initial purpose.
- **A runtime-specific application backend:** can reuse a particular agent product's task execution, but makes the personal system depend on that runtime and its own board state.
- **Read/write task tools without work coordination:** enough for manual agent interaction, but insufficient when several watchers might execute the same step or disconnect during work.

## Coordination contract

Expose a small set of domain operations to discover eligible steps, claim a step, renew a claim, report progress, submit a result, report failure, and request human input. Claims must be atomic. Record the instruction revision and operation identifier so retries and late results cannot silently duplicate or overwrite work.

Eligibility requires an intentionally selected task, satisfied prerequisites, a suitable assignment, and the required permissions. Merely being technically unblocked does not authorize work in Planned. Once work is intentionally released, continue automatically through eligible agent steps and pause for human steps. Completing a human prerequisite makes the next eligible agent step available without a second Start action.

The app records execution status from the watcher; it does not assume that a disconnected client has stopped. An expired claim on an upload or another external action calls for reconciliation before retry, because an effect may already have happened. Keep this visible as uncertain work rather than reporting a false success or automatically duplicating the action.

The same result-validation and task-transition rules apply to manual UI changes and external agent submissions. Human steps remain human steps until the person completes them. For the YouTube workflow, publishing is explicitly human-owned.

## Client compatibility

Verify the application's claims, results, and handoffs with a generic MCP test client. Do not require a particular agent product, select one on the maintainer's behalf, or build a runtime-specific adapter as part of the initial application. Compatibility with any named client must be verified before it is described as supported. Detailed connection setup can follow when the maintainer selects the client.

## Sources checked

- [MCP tool interface](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
