# Mem's Life implementation tickets

Status: ready-for-agent
Phase: implementation authorized by the active full-project goal

These 29 tickets are vertical slices of the [first-release specification](spec.md). Each includes the relevant service, persistence, UI and verification behavior; they are not separate database/backend/frontend work queues. The maintainer approved the planning and then set the full-project implementation goal. Read each ticket's current State and evidence, rather than treating the initial planning index as a completion report.

Read the [wayfinding map](../mems-life-wayfinding/map.md) for decision evidence. Select an open ticket only when every listed blocker is resolved, then claim it by changing its State before work. A ready-for-agent triage status describes specification readiness, not authorization to start during this planning phase.

## Dependency-ordered slices

| Ticket | Blocked by | What it delivers |
| --- | --- | --- |
| [Private first run across web and mobile](issues/01-private-first-run.md) | None | A fresh private installation can provision its owner, sign in from web and native clients, and retain an owner-scoped record through restart. |
| [Capture and progress a task](issues/02-capture-and-progress-tasks.md) | 01 | Capture a simple task, add context, move through its lifecycle, and find the completed result on another client. |
| [Build reusable workout routines](issues/03-reusable-workout-routines.md) | 01 | Create and manage a useful exercise catalog and reusable routines on web and native clients. |
| [Record and finish a workout session](issues/04-record-a-workout-session.md) | 03 | Start from a routine or an empty session, record actual training and notes, and finish with an accurate saved result. |
| [Organize and find work](issues/05-organize-and-find-work.md) | 02 | Use configurable boards, projects, tags, priorities, ordering and search to manage a real task collection. |
| [Adapt a live workout without rewriting its plan](issues/06-adapt-live-workouts.md) | 04 | Change the workout as it happens while preserving actual results and the reusable routine. |
| [Schedule dates and recurring work](issues/07-dates-and-recurring-work.md) | 02 | Track due/scheduled work and recurring responsibilities with stable occurrence history. |
| [Train with supersets and reliable timers](issues/08-supersets-and-timers.md) | 06 | Group exercises into supersets and use rest/exercise timers that remain understandable through backgrounding and restart. |
| [Use previous performance and workout history](issues/09-workout-history-and-progress.md) | 04 | See previous comparable performance while logging and browse meaningful session/exercise progress. |
| [Break outcomes into human and agent steps](issues/10-mixed-human-agent-steps.md) | 02 | Represent one outcome with ordered subtasks, responsibility and parallel dependencies, showing what can happen next. |
| [Manage tasks through generic MCP](issues/11-generic-mcp-task-access.md) | 05, 10 | A generic external MCP client can securely read and change the same task records and configuration used by the person. |
| [Let authorized agents assist with workouts](issues/12-mcp-workout-assistance.md) | 04, 11 | An authorized agent can prepare routines and record explicitly reported training through the same rules as the UI. |
| [Bind reusable skills to agent steps](issues/13-bind-reusable-agent-skills.md) | 10, 11 | Give an agent step a reusable procedure, inputs and a defined deliverable without hosting agent execution. |
| [Claim and report an agent attempt](issues/14-claim-and-report-agent-work.md) | 13 | External workers safely compete for eligible work, maintain ownership and report durable progress/results. |
| [Continue released workflows and pause for people](issues/15-automatic-handoffs.md) | 14 | Released workflows progress through eligible agent steps while clearly handing human actions back to the owner. |
| [Recover interrupted and uncertain agent work](issues/16-recover-agent-attempts.md) | 15 | Failures, cancellation, takeover and lost connections produce recoverable history without duplicate external effects. |
| [Preserve and synchronize offline workouts](issues/17-durable-offline-workouts.md) | 06, 08, 09 | A full native workout survives weak connectivity, force-quit and synchronization conflicts without losing acknowledged results. |
| [Preserve ordinary task edits offline](issues/18-durable-offline-task-edits.md) | 05, 07, 15, 17 | Native task capture and ordinary edits work offline while execution-sensitive actions wait for the service. |
| [Keep a private photo-and-text food diary](issues/19-private-food-diary.md) | 01 | Create, browse and correct dated food entries with multiple private photos on phone, tablet and web. |
| [Review private versioned deliverables](issues/20-private-artifacts-and-review.md) | 14, 19 | Attach private files/results, review a specific version and request revisions without losing earlier work. |
| [Prove the complete YouTube handoff workflow](issues/21-youtube-workflow-proof.md) | 16, 20 | An editable example workflow demonstrates the entire mixed human/agent production path using test artifacts. |
| [Recover offline food entries and photo uploads](issues/22-offline-food-capture.md) | 17, 19 | Food photos and descriptions survive offline capture and interrupted upload, then converge with other clients. |
| [Connect and disconnect an official WHOOP account](issues/23-connect-whoop.md) | 01 | The owner configures and consents to an optional WHOOP connection with reliable credential lifecycle handling. |
| [Use WHOOP context without replacing local training](issues/24-whoop-context-and-linking.md) | 04, 11, 23 | Display fresh read-only WHOOP observations and explicitly link them to local sessions without duplicate activity. |
| [Use a daily focus view across phone, tablet and web](issues/25-daily-focus-and-adaptive-navigation.md) | 04, 07, 10, 15, 19 | Reach the next useful action across tasks, active training and food without losing dedicated domain navigation. |
| [Receive useful opt-in reminders and handoff alerts](issues/26-useful-opt-in-notifications.md) | 07, 08, 16, 25 | Opt into reminders and human-action alerts that open the right record without routine notification spam. |
| [Export, back up and restore personal records](issues/27-export-backup-and-restore.md) | 18, 22, 24 | Keep usable data exports and recover an installation with matching database/media state and intact offline clients. |
| [Manage food diary records through MCP](issues/28-mcp-food-assistance.md) | 11, 19 | An authorized external agent can read or record explicitly reported food entries through the same service used by the diary. |
| [Verify and package the first complete release](issues/29-verify-first-release.md) | 12, 21, 26, 27, 28 | A reproducible release candidate demonstrates the complete product, with remaining external validation gates reported accurately. |

## Starting frontier

[Private first run across web and mobile](issues/01-private-first-run.md) is the initial unblocked ticket. Its completion opens [Capture and progress a task](issues/02-capture-and-progress-tasks.md), [Build reusable workout routines](issues/03-reusable-workout-routines.md), [Keep a private photo-and-text food diary](issues/19-private-food-diary.md), and [Connect and disconnect an official WHOOP account](issues/23-connect-whoop.md). Account consent is not a prerequisite for work on the core product.

Tasks and workouts should progress together as blockers allow; completing every productivity ticket before beginning the gym experience would miss the equal-priority requirement. Dependencies express actual prerequisites, not a demand to run every ticket serially. The food diary introduces private media independently; later task-artifact review reuses that capability.

## External verification gates

- Real WHOOP account consent and configured developer credentials.
- A reachable certificate-valid HTTPS endpoint for external phone/MCP/WHOOP callback checks.
- Authorized Apple signing identities and provisioning for a distribution build.
- Coordinated access to real iPhone/iPad hardware; simulator results are recorded separately.
- Configured notification credentials for actual optional remote-push delivery.

Provider-adapter tickets can complete implementation and fixture-based verification with an explicit outstanding live gate. [Verify and package the first complete release](issues/29-verify-first-release.md) retains that gate, so absent credentials do not block unrelated implementation or become a false claim of production readiness.
