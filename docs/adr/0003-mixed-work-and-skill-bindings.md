---
status: accepted
date: 2026-10-12
---

# Tasks contain human and agent steps

Use one task model for outcomes and their subtasks. Responsibility belongs to the work currently being done, so a single outcome can alternate between people and agents. Separate human and agent views show the relevant tasks or steps without creating another copy. Tasks that need no decomposition remain ordinary tasks.

## Alternatives considered

- **Separate human and agent task stores:** make each queue easy to specialize, but require copying or linking work during handoffs and allow completion histories to disagree.
- **One assignee and one agent run per parent task:** simple, but cannot express an outcome containing multiple human decisions and agent attempts.
- **A full visual workflow graph for every task:** expressive, but makes ordinary life administration too demanding. Use a list of subtasks with explicit dependencies underneath; allow parallel steps without requiring a graph editor.

## Progress and completion

Planned, Next, and Active are the default everyday view. Next means deliberately selected work, distinct from subtask readiness. Show what is happening within active tasks: an agent is running, a person needs to respond, or a dependency is unfinished. Preserve configurable board columns rather than giving a column's display name hidden execution behavior.

A run completing can satisfy its assigned subtask only under that subtask's result requirements. For intentionally released work, continue automatically through eligible agent steps and pause for human steps. A person completing a prerequisite releases the next eligible agent step without a second Start action. Planned work remains dormant. Completing one step never implies that the parent outcome is done; required subtasks and any explicit review must be satisfied first.

Retries create new runs on the same subtask. Preserve prior outputs and failures. Detect stale instructions when a person edits work while an agent runs. Taking over or cancelling must account for the existing run rather than silently starting duplicate work; cancellation does not undo completed effects.

## Skill binding and execution

A skill binding selects a reusable procedure and supplies the inputs and expected result for a subtask. It is distinct from the agent connection that can execute the procedure. Resolve and record the skill version for each run so later edits to a skill do not rewrite the history of what was executed.

Support registered Agent Skills packages where compatible. The package format contains instructions and optional resources; it is not itself a background execution service. Expose first-class MCP operations for external watchers and agents, which execute the work. The initial app does not host its own agent runtime. See [ADR-0004](0004-external-agent-execution.md).

Skill instructions never expand a connection's permissions. The app validates result submissions and task transitions through the shared service. Task movement is a consequence of those validated operations and configured policies, not merely of an agent saying it finished.

## Domain records remain separate

A subtask may refer to a workout plan, workout session, or food entry. Moving a card or preparing a plan must not create a false record of exercise performed or food consumed. Agents can write records based on reported or imported facts, with authorship preserved.

## Sources checked

- [Agent Skills package specification](https://agentskills.io/specification)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
