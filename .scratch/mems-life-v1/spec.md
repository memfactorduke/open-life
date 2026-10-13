# Mem's Life: first complete release

Status: ready-for-agent
State: open
Phase: implementation authorized by the maintainer's active full-project goal

## Problem Statement

Mem needs one personal system that is a capable productivity app and a capable gym tracker, with a simple food diary. Work frequently alternates between Mem and external agents. Separate boards or disconnected records make those handoffs difficult to follow, and a plan must never be mistaken for completed activity. The system must work naturally on an iPhone, make good use of an iPad, and support planning and management in a Mac browser.

The software is personal-first and open source. Other people may run it using their own data and connections, without changing source code or inheriting Mem's accounts. It is not a general-purpose hosted workflow marketplace. Its external agent interface is generic MCP; no particular agent runtime has been selected.

## Solution

Deliver three coherent areas: Tasks, Workouts, and Food, with a daily focus view. Productivity and workout execution each receive a complete useful workflow. Tasks support configurable boards, projects, recurring work, and mixed human/agent steps. Workouts support reusable routines, real sessions, detailed logging, timers, notes, and history. Food starts as dated photos and text; nutrition calculations and meal planning follow later.

One shared service is authoritative across web, native clients, and MCP. Native clients preserve agreed work locally while offline and synchronize explicitly. The app coordinates agent work; external agents execute it. A WHOOP connection supplements local workouts with clearly sourced observations, without becoming a prerequisite for using the app.

## User Stories

### Personal installation and access

1. **US-01:** As the owner, I want a private installation with my own settings and accounts, so that my data is independent of the original creator's data.
2. **US-02:** As the owner, I want to sign in on iPhone, iPad, and web, so that I can use the same records across devices.
3. **US-03:** As the owner, I want to revoke sessions and agent credentials, so that I control continued access.
4. **US-04:** As an operator, I want documented setup, recovery, upgrade, and backup procedures, so that the application can be maintained without a hosted vendor.
5. **US-05:** As the owner, I want to export my records and attachments, so that I can retain usable copies independently of the application.

### Productivity

6. **US-06:** As the owner, I want quick task capture, so that recording work does not interrupt what I am doing.
7. **US-07:** As the owner, I want Planned, Next, and Active views with completed history, so that future intentions and current work are distinct.
8. **US-08:** As the owner, I want configurable board columns and ordering, so that the board matches how I work.
9. **US-09:** As the owner, I want projects, priorities, tags, and search, so that I can organize and find work.
10. **US-10:** As the owner, I want descriptions and notes on tasks, so that instructions and context travel with the work.
11. **US-11:** As the owner, I want due dates, scheduled dates, and recurring tasks, so that time-based responsibilities remain visible.
12. **US-12:** As the owner, I want to complete, reopen, archive, and delete tasks deliberately, so that my board remains useful without losing history unexpectedly.
13. **US-13:** As the owner, I want subtasks with human, agent, or either responsibility, so that one outcome can include different participants.
14. **US-14:** As the owner, I want dependencies and parallel steps, so that only the work with satisfied prerequisites becomes ready.
15. **US-15:** As the owner, I want a clear next action and waiting reason, so that an Active task remains understandable during handoffs.
16. **US-16:** As the owner, I want to release and pause agent work deliberately, so that merely recording a plan does not start execution.
17. **US-17:** As the owner, I want eligible agent steps to continue automatically after a prerequisite is completed, so that I do not repeatedly press Start.
18. **US-18:** As the owner, I want files and result links attached to work, so that I can review the actual deliverable.
19. **US-19:** As the owner, I want to accept a particular result version or request changes, so that later revisions cannot silently inherit my approval.
20. **US-20:** As the owner, I want the YouTube workflow represented by one task, so that script, recording, editing, review, upload, thumbnail, and publication remain connected.
21. **US-21:** As the owner, I want ordinary task capture and edits preserved offline, so that a lost connection does not discard work.

### External agents

22. **US-22:** As an authorized agent, I want to read and edit boards, projects, tasks, and steps through MCP, so that I act on the same records as the person.
23. **US-23:** As the owner, I want a reusable skill binding with inputs and expected results, so that an agent step has useful execution instructions.
24. **US-24:** As an agent, I want to claim eligible work atomically, so that another worker cannot independently claim the same attempt.
25. **US-25:** As an agent, I want to report progress, outputs, failure, or a need for human input, so that the app reflects what happened.
26. **US-26:** As the owner, I want retries and previous attempts preserved, so that failures do not erase useful work.
27. **US-27:** As the owner, I want stale or disconnected workers prevented from overwriting current work, so that late results are handled honestly.
28. **US-28:** As the owner, I want uncertain external actions reconciled before retry, so that a timeout does not cause duplicate uploads or other repeated effects.
29. **US-29:** As an authorized agent, I want to create workout plans and record explicitly reported workout results, so that I can help without inventing completed activity.
30. **US-30:** As an authorized agent, I want to read or add food records and read connected observations within my granted scope, so that assistance covers the app's domains.
31. **US-31:** As an operator, I want generic MCP compatibility demonstrated with a real test client, so that support claims do not depend on an untested agent product.

### Gym and workout tracking

32. **US-32:** As a lifter, I want built-in and custom weighted, bodyweight, timed, and distance exercises, so that I can record my actual training.
33. **US-33:** As a lifter, I want reusable routines with ordered exercises and targets, so that I can prepare workouts in advance.
34. **US-34:** As a lifter, I want to start a routine or an empty session, so that both planned and spontaneous workouts are supported.
35. **US-35:** As a lifter, I want to record sets, repetitions, weight, duration, and distance where appropriate, so that performance is accurate.
36. **US-36:** As a lifter, I want warm-up and working sets, so that summaries reflect the training I intended to measure.
37. **US-37:** As a lifter, I want exercise and session notes, so that technique, discomfort, substitutions, and context are available next time.
38. **US-38:** As a lifter, I want to add, substitute, reorder, skip, and remove exercises during a session, so that a busy gym does not break the plan.
39. **US-39:** As a lifter, I want supersets and rest/exercise timers, so that the session supports how I train.
40. **US-40:** As a lifter, I want previous performance beside current inputs, so that I can choose the next set without searching through history.
41. **US-41:** As a lifter, I want completed session and exercise histories with useful progress summaries, so that I can assess training over time.
42. **US-42:** As a lifter, I want configurable units with correct conversions, so that changing display preference does not change what I lifted.
43. **US-43:** As a lifter, I want edits to a routine kept separate from actual session results, so that future planning cannot rewrite the past.
44. **US-44:** As a lifter, I want every acknowledged set and note saved locally, so that interruption or force-quit does not lose a workout.
45. **US-45:** As a lifter, I want timers to resume correctly after backgrounding, so that the app does not depend on continuous foreground execution.
46. **US-46:** As a lifter, I want to finish, correct, or abandon a session explicitly, so that history does not falsely report a planned workout as performed.
47. **US-47:** As a lifter, I want a visible conflict when two devices edit the same session, so that one device does not silently discard the other's records.

### Food diary

48. **US-48:** As the owner, I want to photograph food and write what I ate, so that logging is quick and does not require nutrient calculations.
49. **US-49:** As the owner, I want dated entries with editable times and multiple photos, so that late logging and corrections are easy.
50. **US-50:** As the owner, I want a readable daily history, so that I can review what I recorded.
51. **US-51:** As the owner, I want captures preserved offline and uploaded later, so that weak reception does not lose photos or notes.
52. **US-52:** As the owner, I want food photos private and deletable, so that a copied storage path does not bypass authorization.
53. **US-53:** As the owner, I want saved, pending, and conflicted entries distinguished, so that I know whether another device can see them.

### WHOOP

54. **US-54:** As the owner, I want to connect my own WHOOP account through the official consent flow, so that the app can read the observations I authorize.
55. **US-55:** As the owner, I want workout, strain, recovery, and sleep context with source and freshness, so that I can distinguish WHOOP observations from local records.
56. **US-56:** As the owner, I want missing or unscored observations shown as unavailable, so that absence is not mistaken for zero.
57. **US-57:** As the owner, I want to link a WHOOP workout to my recorded session explicitly, so that the same activity is not counted twice.
58. **US-58:** As the owner, I want disconnect and reconnect controls, so that I retain control of the connection without deleting local workouts.
59. **US-59:** As the owner, I want the app usable when WHOOP is unconfigured or unavailable, so that provider problems do not stop my workout.

### Daily use and quality

60. **US-60:** As an iPhone user, I want fast one-handed logging and a useful daily focus view, so that the primary device is practical during the day and in the gym.
61. **US-61:** As an iPad user, I want adaptive list/detail layouts, rotation, resizing, and keyboard support, so that the tablet is a first-class client.
62. **US-62:** As a web user, I want efficient board and routine management with keyboard access, so that planning is comfortable on a Mac.
63. **US-63:** As the owner, I want opt-in reminders and human-handoff notifications, so that I am alerted when useful without a notification for every agent update.
64. **US-64:** As the owner, I want notifications to open the relevant record, so that responding is quick.
65. **US-65:** As a user with accessibility needs, I want readable text, adequate contrast, labels, focus order, and reduced-motion support, so that essential actions are accessible.
66. **US-66:** As the owner, I want honest loading, empty, permission-denied, offline, and error states, so that failures are understandable and recoverable.
67. **US-67:** As an operator, I want verified migrations and restore behavior, so that an upgrade or recovery does not silently corrupt client state.
68. **US-68:** As a contributor, I want fictional fixtures, repeatable checks, and self-contained tickets, so that I can develop without accessing anyone's personal data.

## Implementation Decisions

### Architecture and delivery

- Use a TypeScript monorepo, Expo/React Native for iPhone/iPad, and a separate React web interface. Share domain rules, validation, and typed operation contracts; presentation and persistence adapters remain platform-specific.
- Use the supported stable Expo 57 family with its paired React/React Native versions, Node 24 LTS, npm workspaces, and a lockfile. Reverify exact compatible patches when implementing. The installed Xcode 27 path requires the documented Expo scene-lifecycle support and a corresponding launch test.
- Use Fastify, PostgreSQL, and embedded Better Auth. The production default is one Compose host with a private database, persistent media volume, and Caddy HTTPS. Local development uses the same service/database model. Hosting provider and public hostname are configuration, not baked into the application.
- Supply original project source under MIT, retaining third-party notices and verifying asset rights. Applying a license uses the actual copyright holder during implementation; no personal records or credentials belong in source.
- Public signup is disabled. An administrator with host access bootstraps the first owner once and can perform documented credential recovery with session revocation. Email delivery is optional, not a setup prerequisite. Use supported authentication APIs; do not improvise password hashing.
- Browser sessions use secure HttpOnly cookies and origin/CSRF defenses. Native credentials use the supported auth integration and OS secure storage; personal content uses an account/installation-partitioned local store. Logout must not silently discard pending local changes.

### Product operations and records

- A shared application-service boundary enforces ownership, permission, validation, legal transitions, revision checks, and audit authorship. HTTP UI clients and MCP invoke those operations. Database constraints and transactions defend the same invariants.
- Every mutation has a stable operation ID. Authenticate and authorize the caller first, then return an existing matching receipt for that actor/request before applying lease or revision checks to a new mutation. The same ID and payload return the original result even when its original lease has since expired; reuse with changed content is rejected. Expected revisions reject stale new writes. Idempotency receipts, deletion tombstones, and synchronization history are retained for the initial release; future pruning requires a resnapshot policy.
- Records include owner identity, stable ID, revision, and relevant event times. Use UTC instants plus the applicable IANA time zone for scheduled local dates. Display-unit changes never reinterpret stored measurements. History retains meaningful exercise names/units even after library edits.
- First-release concepts are projects, boards, columns, tasks, subtasks, dependencies, skill bindings, agent runs, result versions/approvals, exercises, routines, workout sessions/set results/notes, food entries/photos, and provider observations. Plans and completed activity remain separate records.
- All user-facing mutations create attributable history. Corrections are supported; the UI distinguishes a corrected result from the original event rather than treating history as an uneditable mistake.

### Tasks and handoffs

- Default phases are Planned, Next, Active, and completed history. User-defined column labels map to explicit phase behavior; execution never depends on matching a label string. Dragging, menus, keyboard actions, and agent edits use the same transitions.
- Moving work from Planned to Next deliberately releases it. The first accepted action/claim moves it to Active. Planned work is dormant. Pausing released work prevents new claims, and cancelling a running attempt requests cooperative stopping while preserving its actual outcome.
- Keep simple tasks simple. First release supports one level of actionable subtasks with an ordered default display and an acyclic dependency graph. Required steps govern parent completion; optional steps are explicit. Reject cycles, cross-owner dependencies, and deletion that silently breaks required work. Deeper nesting is outside this release.
- Human, agent, or either is a capability assignment, separate from readiness, an active attempt, and approval. A person may perform an either step without spawning an agent. Active tasks display Running, Needs you, Waiting, Failed, or Outcome unknown as appropriate.
- Within released work, completing a prerequisite automatically makes eligible agent steps available. Human steps stop progression until explicitly completed. The server does not launch an agent: availability is consumed by external clients.
- Recurrence supports daily, selected weekdays/weekly, and monthly schedules with a local time zone. A series and each occurrence have distinct identity. Complete/skip affects the occurrence; series edits explicitly apply to future occurrences. Generate the next outstanding occurrence without flooding the board with silently completed historical occurrences. A missing monthly day uses that month's last day; daylight-saving behavior is deterministic and tested.
- A simple task can be completed directly. A parent with required steps completes only when their requirements and any final review are satisfied. Reopening preserves history and re-evaluates dependent readiness; an ordinary undo cannot pretend an external upload or publication was reversed.

### Generic MCP and agent execution

- Required first-release interoperability is Streamable HTTP with a manually configured, scoped, revocable agent credential, exercised by a real header-capable MCP test client. This is explicitly not a claim of automatic OAuth discovery/consent compatibility. Add standardized OAuth interoperability when a chosen client requires it; no particular runtime or runtime-specific adapter is required now.
- Agent credentials are separate principals from owner sessions. Store secret verifiers safely, display new secrets once, and enforce expiry/revocation and domain scopes on every request. An agent grant cannot bootstrap an owner, recover credentials, issue grants, or expose other connection secrets.
- Expose discover/read and authorized product mutations, eligible-step listing, atomic claim, heartbeat, progress/output recording, finish/fail/yield, and attempt recovery. Cover tasks/configuration, workout plans and explicitly reported results, food records, and permitted provider reads. The SDK/tool schema is a transport interface, not an alternative set of business rules.
- Claiming snapshots instructions, their revision, skill identity/version, inputs, expected outputs, and actor. Renewals and terminal writes require the current attempt ownership token and a live server-controlled lease. Reject stale owners and changed instruction revisions. Retrying creates a new attempt on the same step.
- Skill bindings refer to reusable instructions and bounded resources. They are not arbitrary executable code hosted by the app and do not increase the connection's permissions. Persist the actual execution snapshot even when the external skill is later edited.
- Step results must satisfy declared completion requirements. Store progress/results durably before acknowledging them. Reconnection can discover the outcome of a lost response. Expired claims do not prove external actions stopped; risky unknown outcomes require reconciliation before another attempt can perform that effect.
- Upload evidence, explicit approval, and final publication are separate facts. The YouTube workflow uses test artifacts: script → human recording → agent edit → human review → private upload, with thumbnail drafting in parallel, then human thumbnail approval/attachment and human publication. A view is not approval, and an accepted old artifact cannot approve a changed version.

### Workout behavior

- Seed a useful fictional/general exercise catalog and allow custom exercises. Support weighted repetitions, bodyweight repetitions, duration, and distance/duration as appropriate, optional weight where meaningful, warm-up/working sets, routine targets, and supersets. Do not require irrelevant fields or invent missing values.
- Starting a routine copies its plan into a session snapshot. Starting empty is supported. Record performed sets separately from targets. Editing the active session does not silently edit the routine; an explicit update-routine action can apply selected changes to future sessions.
- Log set/exercise/session notes, substitutions, skips, order changes, additions, and corrections. Active-session controls preserve in-progress inputs. Completion requires an explicit finish; abandoning preserves clearly labelled partial activity rather than deleting or marking the whole plan performed.
- Show previous comparable performance during logging, session history, and exercise trends. Define summaries clearly: measured volume comes from completed weighted working sets; incomparable exercise modes are not added into a misleading total. Estimated metrics, if any, are labelled; a gym tracker does not prescribe medical or recovery decisions.
- Store active timer state, target/deadline, and pause information. Derive display from saved state on resume instead of counting background JavaScript ticks. Handle clock changes deliberately. Native alerts are best effort and permission-dependent; the initiating device owns the alert to avoid duplicate sounds on every device.

### Offline, conflict, and media behavior

- Use native SQLite for confirmed snapshots, local projections, pending commands, conflicts, cursor, and active-session state. Commit a local edit and its outbox operation atomically before acknowledging it as saved. Store photos durably in the app's document storage before acknowledging capture.
- Native offline scope includes downloaded views, workout recording/completion, food capture/editing, new Planned tasks, and ordinary task edits. Release, approval, claims, run completion, consequential dependency edits, and completion that releases agent work need online confirmation. Never show an offline command as already committed on the server.
- Synchronize at launch, foreground/reconnect, and after edits. Background transfer is best effort. Preserve pending work through crashes, token expiry, storage errors, and unsuccessful uploads. Retry the same operation after an uncertain response, with bounded backoff and useful error states.
- Use a durable per-owner committed change feed and consistent snapshot watermark. Allocate feed positions in commit-safe order; apply a whole transaction/page and cursor atomically. A server restore rotates the installation epoch; clients pause automatic replay, resnapshot, and retain local work. Distinguish never-sent commands from previously attempted commands whose receipts may have been lost in the restore. Reconcile previously sent or uncertain effects before replay; ordinary never-sent edits can be revalidated against the restored snapshot. Do not claim that epoch rotation alone preserves exactly-once effects or recovers data beyond the backup point. Live notifications can accelerate reads but do not replace durable catch-up.
- Preserve conflicting versions and offer keep-server, reviewed resubmission, or save-as-new where meaningful. Never automatically overwrite a completed workout, resurrect a deleted record, or discard an unsent edit. Reject dependent commands after their prerequisite command conflicts while allowing unrelated records to sync.
- Web is online-first and retains failed form input. It does not promise durable offline storage or terminated-browser background activity.
- Default server media storage is a private persistent filesystem volume with authenticated bounded transfer endpoints, opaque immutable file IDs, staging, checksum/type/size validation, and recoverable finalization. The database/filesystem gap is handled with explicit staging states and startup reconciliation. A failed or duplicate upload cannot produce a broken finalized attachment. S3-compatible storage is a later adapter, not a required service.
- Backups include database, media, and required private configuration in a documented coherent procedure: enter a maintenance window, pause mutations/uploads/cleanup, drain in-flight work, then capture the database and media. Verify attachment checksums after restore. Exports omit credentials. Deletion revokes app access and propagates tombstones; physical file cleanup follows reference checks and backup policy, never a sweep over pending local work.

### WHOOP and notifications

- Use official WHOOP v2 OAuth and read-only workout, cycle, recovery, sleep, and profile scopes plus refresh access. Profile is included to establish a stable connected identity even for an empty account; body-measurement access is not requested initially. Tokens and client secret remain server-side and encrypted/protected under operator-managed configuration. Serialize refreshes and save rotated credentials atomically.
- An owner configures their own registered developer app and callback. Use a configured HTTPS callback for the supported path; do not assume localhost HTTP is accepted. Connection consent is interactive. Build and fictional-fixture testing proceed before this real-account verification gate.
- Poll at most hourly while the service runs, with bounded manual refresh and complete pagination. At initial connection include only the current context from the previous 24 hours; subsequent reconciliation uses the later of that fixed lower bound and the rolling seven-day window, plus the current cycle. This is bounded observation synchronization, not historical migration.
- Store provider account/resource IDs, source time zone and interval, provider update time, retrieval time, and score state. Upsert by provider identity; missing/unscored is not zero. Show freshness and connection failures. Explicit local-session linkage prevents double counting; similar timestamps may suggest but never silently establish a link.
- On disconnect, stop scheduled sync, attempt provider revocation, delete local credentials, and report revocation failure accurately. Keep cached observations by default with a clear disconnected label; offer explicit deletion. Neither choice deletes locally recorded workouts. Reconnecting to a different provider account creates a new account-specific synchronization boundary; retained old-account observations keep their provenance and are excluded from current-account summaries and automatic links.
- A missing record in a fetched window alone does not establish provider deletion. Recheck known resource IDs within the reconciliation window, and support targeted refresh for an older displayed observation. A resource-specific 404 from a healthy authenticated connection marks that observation unavailable/tombstoned and removes its derived contribution or provider link; other failures mark freshness/error state rather than deletion. Preserve the local workout. Older cached observations carry retrieval time and are not presented as guaranteed-current provider state.
- In-app attention is always available. Native local reminders/timers are opt-in. Provide an optional Expo push adapter for due/handoff/failure alerts, requiring configured project/Apple credentials and real delivery verification; a self-hosted installation remains usable without it. Disable routine step-success spam, deduplicate events, hide sensitive content in default notification previews, and deep-link to the record. Web system push is outside this release.

### UI and accessibility

- Phone prioritizes fast capture and recording; iPad uses adaptive list/detail layouts where useful; web supports denser planning. Tasks, Workouts, and Food are directly reachable, with a Today view for next human actions, due work, active training, and food capture. A cross-domain view does not merge domain histories.
- Support light/dark appearance, text scaling, screen-reader labels, keyboard focus/actions, non-drag alternatives, touch-sized controls, and reduced motion. Show meaningful empty/loading/offline/permission/error states and preserve unsaved input on recoverable failures.

## Testing Decisions

- The highest useful shared seam is the application-service operation boundary backed by real PostgreSQL. Assert observable results, ownership, transactionality, and history through that seam; exercise HTTP and MCP adapters with contract/integration tests. No existing application test suite exists to extend.
- Use Jest for shared/service behavior, jest-expo and React Native Testing Library for meaningful component interactions, Playwright for running web journeys, and Maestro plus physical checks for native journeys. Avoid broad snapshot tests and mocks that replace the invariant being tested.
- Each vertical ticket adds only relevant tests and a demonstrated user path. Critical cases include permission denial, duplicate mutations, stale edits, competing claims, lost responses after commit, cancellation, expired ownership, changed artifacts, recurrence at date boundaries, and honest failure states.
- Native durability checks include airplane-mode workout/food capture, forced termination after acknowledged writes, outbox replay, two-device conflicts, clock changes, expired auth, full storage, interrupted image finalization, and server restore with a changed epoch. Mock-only component checks do not establish these guarantees.
- Validate iPhone and iPad compact/wide layouts, rotation/resizing, keyboard and accessibility. Run web critical flows in Chromium, Firefox, and WebKit. Record actual device/OS/build evidence; simulator success does not imply a physical release is verified.
- Verify WHOOP with fixtures for pagination, refresh rotation, unscored/missing values, 401/429/404 handling, freshness, disconnect, account replacement, identity separation, and duplicate observations. A live read/refresh/revoke check requires owner consent and is recorded separately from fixture success. Upstream integration tickets may finish their implementation and automated acceptance with this live gate explicitly outstanding; final release verification owns the unresolved gate and must not describe the account as connected.
- Native signing, real notification delivery, physical camera/OAuth behavior, and externally reachable HTTPS/MCP are separate gates with honest blocked status if credentials or devices are unavailable. Do not bypass them by renaming an unsigned simulator build as a distributable.
- Final verification includes a clean install, migration from an earlier test schema, export without secrets, database/media restore into an independent installation, epoch resynchronization, and a scan for personal data or credentials in distributable assets and logs.

## Out of Scope

- Application implementation was outside the original planning task. The maintainer has now set the full-project implementation goal.
- Choosing, bundling, hosting, or deploying an agent runtime; a Hermes-specific adapter; actual video editing/uploading/publishing integrations. The YouTube workflow proves coordination with test artifacts.
- Full nutrition analysis, calories/macros, recipes, grocery lists, and meal planning; automated food recognition.
- Historical migration from other task/workout apps; unlimited WHOOP backfill; unsupported WHOOP strength detail, continuous heart-rate streams, or workout write-back.
- Native Mac and Android release certification, Apple Watch, Apple Health, calendar integration, public hosted multi-user signup, household/team collaboration, payments, plugins/marketplace, and arbitrary user-supplied code execution.
- General-purpose workflow scripting, nested subtask trees beyond one level, fully offline web, CRDT/general database replication, and guaranteed background execution.
- Buying infrastructure, using personal credentials, publishing to an app store, or changing the repository name as part of planning.

## Further Notes

The maintainer explicitly approved finishing Wayfinder, To Spec, and To Tickets and delegated technical choices, test boundaries, and ticket sizing. The resulting readiness labels do not authorize implementation in this phase. No additional approval of routine planning artifacts is required.

The existing product interview, glossary, architecture decisions, and resolved wayfinding tickets are the sources of this specification. See the [wayfinding map](../mems-life-wayfinding/map.md), [product brief](../../docs/product.md), [glossary](../../GLOSSARY.md), and [ticket index](tickets.md). The [offline/media](../mems-life-wayfinding/research/02-offline-media.md), [access/deployment](../mems-life-wayfinding/research/01-access-deployment.md), [WHOOP](../mems-life-wayfinding/research/03-whoop.md), and [toolchain](../mems-life-wayfinding/research/04-toolchain-release.md) research record alternatives and primary sources.

The optional push choice uses [Expo's service overview](https://docs.expo.dev/push-notifications/overview/) and [setup requirements](https://docs.expo.dev/push-notifications/push-notifications-setup/); source-supported capability is distinct from configured delivery. Exact package patches and external platform requirements must be checked again when the corresponding implementation ticket runs.
