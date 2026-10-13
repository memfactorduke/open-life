# Product brief

## Purpose

Mem's Life is a personal system for Mem's tasks, workouts, food, and human/agent work. Build the way Mem wants to work, with opinionated defaults rather than a broad-market product. Other people may use the open-source project with their own records and connections.

## Confirmed direction

- The initial areas are configurable task Kanban, full workout tracking, and a food diary. Productivity and gym tracking are equally first-class products within the app, not a full task manager with a token workout module. Full nutrition tracking and meal planning follow later.
- Tasks routinely combine human and agent work. Support subtasks, agent-selected skills, and handoffs within the same outcome.
- The default task view is Planned, Next, and Active, with completed work accessible separately. Workflow configuration must be editable by the person and by an authorized agent.
- Workout tracking includes sets, repetitions, weight, timers, notes, and history. Keep editable workout plans separate from actual sessions and recorded performance. Agents can author plans and record reported results without inventing completed activity.
- Importing existing task or workout records is not required for the initial release.
- WHOOP is the confirmed first wearable integration, through its official API. Keep local workout records authoritative for sets, repetitions, weights, and notes; verify the provider's actual API capabilities before promising any additional synchronization.
- The initial food diary supports taking photos and writing what was eaten. Detailed nutrition logging is later scope; a food entry does not imply that calories or nutrients have been measured.
- iPhone is the primary daily interface. iPad is a first-class interface, and a web app supports management on Mac. A native Mac app is later scope.
- The project is personal-first and intended to be open source. Other people can adopt the same approach, but their preferences do not drive the initial scope.
- Personal details, accounts, credentials, life categories, and service choices belong in user data or configuration rather than hardcoded application behavior.
- External agents and watchers should execute agent steps through a first-class MCP interface. The initial app does not host its own agent runtime.
- MCP servers and an installation experience that agents can help with are part of the intended direction.
- Establish documentation and the development workflow before implementing the application.

## Decision ownership

The maintainer delegates technology selection, architecture, and routine implementation decisions to the agent. The agent must research credible alternatives and explain consequential decisions in ordinary English. Product interviews should resolve actual behavior and personal priorities, rather than require the maintainer to select technical options.

The aim is a cohesive initial build with limited routine review overhead. Capture decisions as they land and resolve important product ambiguity before treating a specification as approved.

## Agent integration

The initial responsibility boundary is settled:

1. Mem's Life owns the task, subtask, dependency, claim, result, and handoff state and exposes operations through MCP.
2. External agents or watchers discover eligible work and execute it using their existing tools and skills.
3. Keep the interface generic to MCP. The maintainer has not selected an agent runtime, and this choice must not block the application build. Verify the contract with a test client; do not claim compatibility with a particular runtime without testing it.
4. Agent-assisted installation and configuration remain part of the product direction.

Connecting the app itself to arbitrary external tool servers is unnecessary for this initial boundary. The external agent can use its own connections. Development skills in this repository do not implement the product's MCP interface.

## Mixed human and agent work

Use a shared task model. A parent task expresses an outcome and can contain subtasks with different responsibilities. Human and agent queues are views over this work, not separate stores that require copying a task during a handoff.

Keep an ordinary task simple until it needs steps. Present subtasks as an ordered list, with dependencies available for steps that can run alongside each other. A skill binding describes how an agent should perform a particular step; an agent run records one attempt to perform it. See [ADR-0003](adr/0003-mixed-work-and-skill-bindings.md).

Planned, Next, and Active are the primary everyday distinctions. Next is an intentional queue, not a list of everything technically executable. Waiting for a person, waiting on a dependency, and an agent currently running are indicators within that view. Completion of one agent run is not proof that a whole task or a real-world activity is complete.

For an intentionally released task, eligible agent steps continue automatically when their prerequisites are complete. Marking recording complete, for example, makes editing eligible without a second Start action. Execution pauses at human steps and resumes after the person completes them. Planned tasks remain dormant. This permission to continue the workflow does not grant new permissions to external services.

The [YouTube workflow](workflows/youtube.md) anchors the initial design: script, recording, edit, human review, upload, thumbnail, human thumbnail approval, and human publication. Upload and publication are separate actions. An approval belongs to a particular artifact version.

## Working defaults for the first build

The maintainer confirmed the workout scope below, including notes, and delegates the remaining choices that do not require personal knowledge. Use these defaults unless corrected:

- Workouts support weighted, bodyweight, timed, and distance-based exercises, reusable routines, custom exercises, supersets, previous performance, rest timers, exercise and session notes, and changes during a session. Session edits do not silently rewrite the reusable plan. Units are configurable.
- Productivity includes quick capture, configurable boards, projects, subtasks, dependencies, due dates, recurring tasks, priorities, tags, search, notes, and the agreed human/agent workflow. Choose a coherent interface for these standard features without another feature-by-feature interview.
- After initial setup, mobile can record workouts and food entries, view downloaded records, and save ordinary task edits without a connection. Save immediately on the device and synchronize later. Agent execution and actions that release or approve external work require server confirmation.
- Phone navigation prioritizes the next useful action in Tasks, Workouts, and Food. iPad and web use the additional space for planning and management.
- Notifications are opt-in and focus on work needing the person and timers, rather than every routine agent update.
- The core app works independently of external fitness, calendar, or food services. WHOOP is the confirmed first wearable connection. No import of existing records is required. Generic MCP remains required.

## Planning handoff

The selected client and shared-service direction is recorded in [ADR-0001](adr/0001-mobile-and-web-clients.md) and [ADR-0002](adr/0002-shared-service-for-people-and-agents.md). The [wayfinding map](../.scratch/mems-life-wayfinding/map.md) now resolves access/deployment, durable offline records/private media, WHOOP scope, toolchain verification, and licensing. These are researched choices, not claims of working implementation.

The [first-release specification](../.scratch/mems-life-v1/spec.md) defines the behavior and implementation boundaries. Its [29 implementation tickets](../.scratch/mems-life-v1/tickets.md) cover the work and verification in dependency order. The maintainer authorized completing this planning sequence and will set the implementation goal separately.

Remaining implementation-time inputs include exact compatible dependency patches, the deployment hostname, owner-provided credentials/consent, and available signed-build/device access. They do not require reopening the product interview or choosing an agent runtime. Ask only when an unavailable input genuinely blocks its corresponding verification.

## Scope discipline

The initial experience must reflect a life manager rather than a generic board with future modules promised. Deliver tasks, full workout tracking, and the simple food diary as coherent workflows. Meal planning, grocery features, and detailed nutrition logging belong to the later food-management expansion.

Use fictional fixtures and configurable defaults. Do not ship the original creator's actual boards, identities, routines, or connected accounts as product defaults.
