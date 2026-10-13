# Roadmap

## Current stage

The product interview and the requested Wayfinder → To Spec → To Tickets phases are complete. The maintainer has set the full-project implementation goal and delegates engineering choices to the agent. This roadmap describes implementation order, not completed functionality. See the [wayfinding map](../.scratch/mems-life-wayfinding/map.md), [specification](../.scratch/mems-life-v1/spec.md), and [29 implementation tickets](../.scratch/mems-life-v1/tickets.md). The [implementation program](../.scratch/mems-life-v1/implementation.md) and ticket evidence record current progress.

## Confirmed delivery priorities

- iPhone is the primary daily interface.
- iPad receives a first-class experience.
- Web on Mac supports planning and management.
- A native Mac app may follow later.
- Initial areas are configurable tasks with mixed human/agent subtasks, full workout tracking, and a photo-and-text food diary. Productivity and gym tracking receive equal first-class treatment.
- Full nutrition tracking and meal planning follow the initial food diary.
- Optimize for Mem's workflows first; other people may run the same product with their own configuration.
- Planned, Next, and Active are the default board stages. External agents execute work through MCP.

The selected architecture uses Expo/React Native for mobile, a separate React web interface, shared TypeScript product rules, and a PostgreSQL-backed service shared by UI and MCP. See [ADR-0001](adr/0001-mobile-and-web-clients.md), [ADR-0002](adr/0002-shared-service-for-people-and-agents.md), [ADR-0003](adr/0003-mixed-work-and-skill-bindings.md), and [ADR-0004](adr/0004-external-agent-execution.md). Validate representative slices before expanding implementation; the choices do not imply completed platform support.

## Proposed implementation sequence

1. **Shared foundation and a real task workflow.** Prove persisted tasks, configurable workflow, and the same authorized operation through web, mobile, and MCP. Start validating iPhone and iPad layouts here.
2. **Mixed human/agent work.** Add subtasks, dependencies, skill bindings, claims, execution history, and handoffs. Prove the [YouTube workflow](workflows/youtube.md) through a generic MCP test client, including automatic continuation of released work and pauses for human steps. Do not build an embedded agent runtime or depend on a particular external agent product.
3. **Workout execution.** Deliver plans and sessions, set/repetition/weight recording, supersets, custom exercises, exercise and session notes, timers, previous performance, and history. Preserve what was performed when the source plan changes. Include durable local recording for the agreed offline workflows and the confirmed WHOOP connection.
4. **Food diary.** Capture photos and written descriptions, organize entries by date, and synchronize them across devices with private media access.
5. **Complete the initial release.** Test clean installation, independent user configuration, recovery after interruption, and a coherent daily experience across all three areas.

These slices define implementation order, not separate products or permission gates. Use each completed slice to validate the architecture before expanding it.

## Planning handoff

Personal workflow requirements and automatic continuation are confirmed. The specification records the researched offline, access, deployment, WHOOP, toolchain, and license choices. Exact dependency patches and external credentials are checked when their implementation tickets run.

The specification and separate implementation tickets are saved under `.scratch/mems-life-v1/`. Their `ready-for-agent` status records clear behavior, boundaries, and acceptance criteria. That status describes readiness, not authorization to begin implementation during this planning phase.

## Candidate acceptance criteria

- A clean installation succeeds using documented prerequisites and steps.
- Another person can run the same opinionated product using their own settings without source edits or shared personal data.
- A person can create a board and card and move that card between columns.
- Board and card state survives restart.
- An authorized agent can read and change the same state through the chosen interface; rejected operations leave state unchanged and return a useful error.
- Changes made by either interface appear correctly in the other.
- Task identity survives human/agent handoffs; retries retain earlier results and errors.
- Planned work is not picked up just because a dependency is satisfied; Next is an intentional queue.
- A failed or uncertain external operation is reconciled before retrying it.
- YouTube upload, thumbnail approval, and final publication remain distinct steps with version-specific evidence.
- A completed agent step does not falsely complete its parent task, a workout, or a food record.
- Completed workout records remain separate from editable future plans.
- Workout recording remains usable throughout a gym session, including notes, substitutions, interruption, background timers, and resuming locally saved progress.
- Existing records do not need to be imported for a successful first installation.
- Food photos and descriptions are stored as the person's records; the initial diary does not fabricate nutrition measurements.
- iPad layouts are tested at compact and wide sizes; physical-device tests are coordinated with other agents.
- Committed examples and fixtures contain fictional data and no credentials.

The implementation specification must turn these into concrete, testable cases for the selected environment and interface.

## Later scope

Expand food management into nutrition logging, meal plans, recipes, and groceries. Select other life-management workflows from concrete needs. Collaboration with other people, deep platform integrations, and a native Mac client remain uncommitted until their need is established.
