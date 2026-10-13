# Mem's Life

## Project direction

Read [the product brief](docs/product.md) before changing product scope and [the roadmap](docs/roadmap.md) before planning implementation. The roadmap distinguishes proposals from approved work.

Design for Mem's actual workflows first. Other people may run the same opinionated product with their own configuration; broad market appeal and a general-purpose workflow builder are not goals. Keep identities, credentials, service accounts, and personal records in configuration or user data. Use fictional records in fixtures.

Treat human and agent interaction as product concerns from the start. Coding-agent skills are development tools; they are separate from the application's future agent integration.

The initial product is a first-class MCP workflow coordinator. External agents or watchers execute the work. Keep the interface independent of any particular agent runtime; the maintainer has not selected one. Do not add an embedded agent execution platform or a runtime-specific adapter to the initial scope.

## Decision ownership

For the initial release, follow Wayfinder → To Spec → To Tickets. Those phases are complete, and the maintainer's active goal explicitly authorizes full implementation. Read the specification and each ticket's blockers before starting work. Preserve the distinctions between decision tickets and implementation tickets.

The maintainer delegates technical decisions and routine implementation choices to the agent. Compare credible alternatives, verify material facts, and record the reasoning for consequential choices. Ask for clarification about unresolved product behavior and personal priorities; do not send routine engineering decisions or every document edit back for approval.

Open pull requests for coherent changes, review them, resolve material findings, and merge when the relevant checks pass. The maintainer authorizes agents to open and merge routine PRs using their judgment. Keep source merging separate from deployment and Apple distribution acceptance.

Ask product interview questions directly in chat, rather than using a separate multiple-choice tool. Infer likely dictation errors from context and clarify only when they materially change the design.

Build toward a broad life manager with mixed human/agent tasks, full workout tracking, and food management. The initial food experience is a photo-and-text diary; full nutrition tracking and meal planning follow later. iPhone is the primary daily interface, iPad is a first-class interface, and web supports management on Mac. Treat native Mac support as later scope. Preserve these platform priorities when selecting frameworks and sequencing work.

Coordinate ownership before using a physical device that another agent may be testing. Device availability alone is not permission to interrupt another test.

## Agent skills

Committed skill sources are in `.claude/skills/` and can be read directly. Native skill invocation depends on each client's installation and discovery mechanism. Use the repository configuration below with these sources or already installed skills.

### Issue tracker

Development specs and tickets live in local Markdown under `.scratch/<feature>/`. See [issue tracker conventions](docs/agents/issue-tracker.md).

The initial release's wayfinding map is [.scratch/mems-life-wayfinding/map.md](.scratch/mems-life-wayfinding/map.md). Its destination is a buildable specification and implementation tickets, not application code.

### Triage labels

Use the five default triage roles. See [triage labels](docs/agents/triage-labels.md).

### Domain docs

Use one domain glossary at `GLOSSARY.md` and decision records in `docs/adr/` when a decision warrants one. `CONTEXT.md` is a compatibility pointer for older skills. See [domain documentation rules](docs/agents/domain.md).
