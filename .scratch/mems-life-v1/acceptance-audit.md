# First-release acceptance evidence audit

Audit snapshot: 2026-10-13T04:20:46.437182+00:00. Read-only review of all 29 tickets and all 154 acceptance criteria; This retained audit describes the historical read-only review. Later ticket evidence reconciliation is recorded separately.

The tracker currently records **2 verified-complete tickets and 14/154 checked criteria**. That is tracker bookkeeping, not a measure of implementation volume: many later tickets have substantial passing PostgreSQL, browser, component and native artifact evidence but empty Comments sections. Existing evidence must be attached and bounded before acceptance is claimed.

## Evidence boundaries and next actions

1. **Freeze and identify final source.** Current production-web receipt hashes match every listed live file, including the lockfile. The gym-food native source snapshot differs from 13 current files (listed below), so its genuine native Photos/workout successes cannot establish the newer offline implementation. Rebuild and run fresh Expo-backed persistence/interruption/recovery, then produce a final commands/screenshots/results index.
2. **Finish integrated native proof.** Current native gym-food directory contains successful continuations and failed exploratory runs together. Use per-command outcomes and server records, not every YAML/manifest as a blanket pass. Cover native board/date/agent/Today/WHOOP/notification paths plus offline workout/task/photo conflicts, expired credentials, dropped responses and epoch restore.
3. **Run final independent-checkout checks.** The saved workspace receipt has 23/23 server tests, 39/39 domain tests and typechecks passing, but lint failed on two then-current files. Subsequent fixes may exist; this receipt does not prove a final clean lint/install/build. Recheck final freeze once; do not repeatedly rerun unchanged earlier evidence.
4. **Finish current container proof.** The runtime image receipt is explicitly a pre-freeze image. Actual separate Compose operator backup/restore passes and supersedes the old complaint about absent runtime pg_dump/pg_restore; do not require database tools in the minimal application image. Final app/operator image identity and source checks remain.
5. **Reconcile Today/Food timezone before final web proof.** Saved Today evidence notes Asia/Tokyo owner preference versus America/New_York browser Food date interpretation. Parent assigned the narrow repair. Existing Today live PG proof is real but predates that repair.
6. **Record acceptance rather than infer it.** Link receipts into each ticket only after checking the full wording, source boundary and blockers. Remaining feature verification is chiefly unrecorded integration/native evidence; this audit does not establish that every feature is finished.

## Historical local evidence index

| Key | Existing receipt | What it establishes |
|---|---|---|
| F | `evidence/foundation-service/results.json` | Real PG foundation plus 15 three-engine auth cases |
| N1 | `evidence/native-foundation/results.json` | Immutable foundation iPhone/iPad iOS26.5 release proof |
| N2 | `evidence/native-features/results.json` | Immutable task/routine native release proof, bounded omissions |
| R | `archive-recovery/verification.json` | Archive recovery browser and component checks |
| S | `sessions-service/receipt.json` | PG session invariants/modes/history/timers |
| SW | `sessions-web/verification.md` | Three-engine session UI evidence |
| P | `productivity-web/verification.json` | 15 three-engine organization/recurrence/graph cases |
| A | `agent-workflow-ui/browser-tests.log` | Six three-engine workflow UI cases |
| AC | `agent-workflow-ui/native-components.log` | Five native workflow component cases |
| W | `workspace-checks/checks.json` | Workspace command outcomes and captured hashes |
| WL | `workspace-checks/server-workspace.log` | 23 actual PG/SDK/integration tests, no skips |
| I | `integration-next/epoch-integration-proof.json` | Wired SDK/provider/epoch and native fixture checks |
| D | `daily-focus-web/verification.json` | Today fixture plus actual PG five-size proof |
| DL | `daily-focus-live/adaptive-final-browser/today-live-PostgreSQL-day--c1607-sk-workout-and-food-records-chromium/live-projection.json` | Exact live day projection used by browser journey |
| FW | `food-web/index.html` | Food browser evidence index |
| G | `evidence/native-gym-food/source-snapshot.json` | Earlier native gym-food source identity |
| GF | `evidence/native-gym-food/session-finished.json` | Persisted completed native session |
| GH | `evidence/native-gym-food/session-history.json` | Native session history records |
| GP | `evidence/native-gym-food/local-private-photo-files.json` | Actual copied private native photo paths |
| GT | `evidence/native-gym-food/tablet-food-exact-records.json` | Exact food records visible across native clients |
| M | `migration-reconciliation/verification.md` | Earlier-schema forward migration/reconciliation evidence |
| Z | `zod-alignment/checks.json` | Aligned Zod dependency/type/adapter checks |
| PROD | `../../../evidence/production-web/verification.json` | Three production engines, secure cookies/private photos, zero CSP |
| IMG | `../../../evidence/container-current/result.json` | Pre-freeze nonroot runtime image/DB/media restart proof |
| OP | `../../../.runtime/operator-verify-result.log` | Actual separate Compose operator export/backup/independent restore |

The raw paths above are local-only provenance. Shareable copies are in [the reviewed evidence index](evidence/release-safe/index.html). Receipts establish the runs they record. Tests present in source without an execution receipt are implementation coverage candidates, not proof of current execution. Workspace tests cover scopes/ownership and transactional invariants more broadly than browser fixtures. Native component tests do not establish OS SQLite/file/notification behavior.

## All acceptance criteria

Criterion IDs use ticket number and its one-based checkbox position. “Checked” below copies tracker state; it does not promote or change acceptance. Each criterion maps to concrete receipts via the evidence key. The scope column prevents receipt coverage from being mistaken for a full final release pass.

### 01: Private first run across web and mobile

Existing proof: **F,N1,W,PROD**. Remaining scope: Recorded acceptance; fresh final-source native regression and external distribution remain separate.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 01.1 | Checked | Create the supported workspace, service, database and client baseline with a pinned compatible toolchain and repeatable checks; include MIT for original source and preserve third-party notices. | F,N1,W,PROD: Toolchain/license. Full remaining scope stated above. |
| 01.2 | Checked | Provide documented one-time local owner bootstrap and recovery, with public signup disabled and no SMTP requirement. Repeated bootstrap refuses safely. | F,N1,W,PROD: bootstrap/recovery. Full remaining scope stated above. |
| 01.3 | Checked | Browser and native sign-in access the same private account; unrelated, absent, revoked and expired credentials cannot read or mutate its data. | F,N1,W,PROD: same account/denial. Full remaining scope stated above. |
| 01.4 | Checked | Use secure browser sessions, origin/CSRF defenses, supported password handling and OS secure storage; credentials never enter content caches, logs or client bundles. | F,N1,W,PROD: cookie/secure store. Full remaining scope stated above. |
| 01.5 | Checked | Demonstrate a real PostgreSQL-backed authenticated round trip from web, iPhone and iPad layouts, restart persistence, and session revocation. | F,N1,W,PROD: real PG/native roundtrip. Full remaining scope stated above. |

### 02: Capture and progress a task

Existing proof: **F,N2,W**. Remaining scope: Recorded acceptance; native reorder/denial/retry not in saved simulator journeys; final bundle regression outstanding.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 02.1 | Checked | Create, edit and order tasks with descriptions/notes in default Planned, Next and Active views plus completed history. | F,N2,W: Lifecycle/order. Full remaining scope stated above. |
| 02.2 | Checked | Use explicit phase transitions, stable identity, actor history and revision checks; column text is not executable business logic. | F,N2,W: history/revision. Full remaining scope stated above. |
| 02.3 | Checked | Complete, reopen, archive and delete deliberately, with useful undo or correction behavior that preserves history. | F,N2,W: correction/archive/delete. Full remaining scope stated above. |
| 02.4 | Checked | Web and native clients show confirmed changes consistently and preserve input after validation or connection errors. | F,N2,W: client consistency/errors. Full remaining scope stated above. |
| 02.5 | Checked | Exercise the shared operation boundary with duplicate operation IDs, stale revisions and denied ownership; do not create duplicate tasks on retry. | F,N2,W: replay/ownership. Full remaining scope stated above. |

### 03: Build reusable workout routines

Existing proof: **F,N2,R,G**. Remaining scope: First four criteria recorded checked. Fifth needs verifier’s final safe-area/layout sign-off on final bundle.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 03.1 | Checked | Provide a general nonpersonal catalog plus custom weighted, bodyweight, timed and distance exercises with relevant fields. | F,N2,R,G: Catalog. Full remaining scope stated above. |
| 03.2 | Checked | Create routines with ordered exercises, planned sets/targets and notes; rename, duplicate and archive without damaging existing references. | F,N2,R,G: routine targets/order/archive. Full remaining scope stated above. |
| 03.3 | Checked | Make units configurable, preserve physical quantities during display conversion, and distinguish absent data from zero. | F,N2,R,G: conversions. Full remaining scope stated above. |
| 03.4 | Checked | Validate targets and numeric input without requiring irrelevant measurements or making historical names unintelligible after exercise edits. | F,N2,R,G: validation. Full remaining scope stated above. |
| 03.5 | Unchecked | Support comfortable phone selection/logging preparation and iPad/web routine management, with persistence and owner authorization. | F,N2,R,G: phone/tablet comfort. Full remaining scope stated above. |

### 04: Record and finish a workout session

Existing proof: **S,SW,WL,GF,GH,G**. Remaining scope: Actual native workout proof exists on earlier gym-food artifact; final index/source reconciliation and mixed abandon/correction coverage still need verification.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 04.1 | Unchecked | Copy a routine into a session snapshot; separate target sets from performed sets and distinguish warm-up from working sets. | S,SW,WL,GF,GH,G: Session snapshot/actual-vs-target. Full remaining scope stated above. |
| 04.2 | Unchecked | Record applicable repetitions, load, time and distance with exercise/session notes, inline correction and useful validation. | S,SW,WL,GF,GH,G: modes/notes/correction. Full remaining scope stated above. |
| 04.3 | Unchecked | Preserve active input while moving between exercises; visibly distinguish planned, in-progress, partial/abandoned and finished activity. | S,SW,WL,GF,GH,G: navigation/preservation/status. Full remaining scope stated above. |
| 04.4 | Unchecked | Finishing is explicit; unfinished planned exercises are not fabricated as completed results. | S,SW,WL,GF,GH,G: explicit finish. Full remaining scope stated above. |
| 04.5 | Unchecked | Show a persisted completed session on another client; later routine edits do not change its actual results or notes. | S,SW,WL,GF,GH,G: cross-client immutable history. Full remaining scope stated above. |

### 05: Organize and find work

Existing proof: **P,WL,G**. Remaining scope: Web and PG evidence exists; actual final native board configuration/search/order and keyboard/tablet journey not indexed.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 05.1 | Unchecked | Create/edit boards and columns, explicitly map columns to lifecycle phases, and keep completed work retrievable. | P,WL,G: Boards/phase mapping. Full remaining scope stated above. |
| 05.2 | Unchecked | Group tasks into projects, apply tags/priorities, filter and search task text with clear empty states. | P,WL,G: projects/tags/search. Full remaining scope stated above. |
| 05.3 | Unchecked | Support drag ordering where suitable and keyboard/menu alternatives on web and tablet; keep phone management practical. | P,WL,G: drag/menu/keyboard. Full remaining scope stated above. |
| 05.4 | Unchecked | Changing a column label or project membership cannot release work accidentally or sever task identity/history. | P,WL,G: rename safety/history. Full remaining scope stated above. |
| 05.5 | Unchecked | Persist configuration through the same validated owner-scoped operations intended for later MCP use. | P,WL,G: shared owner operations. Full remaining scope stated above. |

### 06: Adapt a live workout without rewriting its plan

Existing proof: **S,SW,WL,G**. Remaining scope: Native adaptation run exists; establish final-source add/substitute/reorder/skip/remove/update-routine/conflict journey in finalized index.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 06.1 | Unchecked | Add, substitute, reorder, skip and remove session exercises and add/edit/remove actual sets with notes. | S,SW,WL,G: Session adaptation. Full remaining scope stated above. |
| 06.2 | Unchecked | Clearly distinguish skipping a planned activity from erasing a recorded result; retain correction history. | S,SW,WL,G: recorded-result correction. Full remaining scope stated above. |
| 06.3 | Unchecked | Session edits affect that session only unless the owner explicitly chooses an update-routine action. | S,SW,WL,G: session-only changes. Full remaining scope stated above. |
| 06.4 | Unchecked | Updating a routine from a session applies selected future-plan changes without rewriting completed activity. | S,SW,WL,G: selected future plan. Full remaining scope stated above. |
| 06.5 | Unchecked | Test revision conflicts and a routine change while an older session is in progress. | S,SW,WL,G: routine revision conflict. Full remaining scope stated above. |

### 07: Schedule dates and recurring work

Existing proof: **P,WL**. Remaining scope: PG recurrence and web dates verified; final native date picker, future-series edit/skip/cancel and timezone journey remains.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 07.1 | Unchecked | Support optional due and scheduled dates and daily, selected-weekday/weekly and monthly recurrence in an IANA time zone. | P,WL: Dates/recurrence/timezone. Full remaining scope stated above. |
| 07.2 | Unchecked | Keep a recurrence series separate from each occurrence; complete/skip affects one occurrence and series edits explicitly affect future ones. | P,WL: occurrence identity. Full remaining scope stated above. |
| 07.3 | Unchecked | Generate the next outstanding occurrence idempotently without flooding the board with fabricated past completions. | P,WL: idempotent generation. Full remaining scope stated above. |
| 07.4 | Unchecked | Use the last valid day for missing monthly dates and document/test daylight-saving transitions and late completion behavior. | P,WL: month-end/DST. Full remaining scope stated above. |
| 07.5 | Unchecked | Show upcoming/overdue work and let the person cancel a series without losing completed occurrence history. | P,WL: overdue/cancel history. Full remaining scope stated above. |

### 08: Train with supersets and reliable timers

Existing proof: **S,WL,G,I**. Remaining scope: Server deadlines/rounds verified; actual native background/kill/relaunch, clock change, alert replacement and startup reconciliation not yet indexed on final source.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 08.1 | Unchecked | Create and execute ordered superset groups while keeping results attached to the correct exercise and round. | S,WL,G,I: Superset rounds. Full remaining scope stated above. |
| 08.2 | Unchecked | Support start, pause, resume, reset and optional auto-rest after a recorded set, without silently marking an exercise complete. | S,WL,G,I: timer controls/auto-rest. Full remaining scope stated above. |
| 08.3 | Unchecked | Persist timer state/deadlines and derive elapsed/remaining time after backgrounding; handle device-clock changes deliberately. | S,WL,G,I: deadlines/clock. Full remaining scope stated above. |
| 08.4 | Unchecked | Provide optional sound/haptic/local notification with graceful denied-permission behavior and avoid duplicate alerts across devices. | S,WL,G,I: optional alerts/dedup/permission. Full remaining scope stated above. |
| 08.5 | Unchecked | Verify foreground, background and process-restart behavior; do not rely on continuous JavaScript or guaranteed background execution. | S,WL,G,I: actual background/restart. Full remaining scope stated above. |
| 08.6 | Unchecked | Cancel or replace obsolete local notifications when timers change, finish or resume; reconcile persisted timer/notification state on app startup. | S,WL,G,I: cancel/reconcile alerts. Full remaining scope stated above. |

### 09: Use previous performance and workout history

Existing proof: **S,SW,WL,GH,G**. Remaining scope: Service/browser history proof exists; final native previous-performance/corrected trend/filter/accessibility proof not indexed.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 09.1 | Unchecked | Display previous relevant results beside active set inputs and navigate complete, partial and corrected sessions. | S,SW,WL,GH,G: Previous results/history. Full remaining scope stated above. |
| 09.2 | Unchecked | Provide exercise history and clear comparable trends without mixing incompatible measurement types. | S,SW,WL,GH,G: comparable trends. Full remaining scope stated above. |
| 09.3 | Unchecked | Define weighted working-set volume explicitly; do not report unperformed targets or missing data as actual volume. | S,SW,WL,GH,G: working volume. Full remaining scope stated above. |
| 09.4 | Unchecked | Preserve historical units/exercise meaning and label estimates if introduced; aggregate corrections consistently. | S,SW,WL,GH,G: units/corrections. Full remaining scope stated above. |
| 09.5 | Unchecked | Support practical pagination/filtering and accessible charts or equivalent readable values on each client. | S,SW,WL,GH,G: pagination/filter/readable charts. Full remaining scope stated above. |

### 10: Break outcomes into human and agent steps

Existing proof: **P,WL,G**. Remaining scope: Shared PG graph and web proof exists; actual final native responsibility/dependency/next-action/completion/reopen journey remains.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 10.1 | Unchecked | Support one level of required/optional subtasks assigned to human, agent or either, without copying tasks into separate stores. | P,WL,G: Required/optional responsibility. Full remaining scope stated above. |
| 10.2 | Unchecked | Validate an acyclic dependency graph and reject cross-owner edges or deletion that silently breaks required work. | P,WL,G: DAG safety. Full remaining scope stated above. |
| 10.3 | Unchecked | Separate dependency readiness, deliberate release, assignment and active execution; Planned work remains dormant. | P,WL,G: release/readiness. Full remaining scope stated above. |
| 10.4 | Unchecked | Show next actions and waiting reasons in the parent and human/agent filtered views. | P,WL,G: waiting reasons. Full remaining scope stated above. |
| 10.5 | Unchecked | Apply parent completion/reopening rules without treating one finished step as the entire outcome. | P,WL,G: parent completion/reopen. Full remaining scope stated above. |

### 11: Manage tasks through generic MCP

Existing proof: **WL,I,A,AC**. Remaining scope: Real SDK Streamable HTTP and PG scopes proved; final native grant/revocation and bidirectional same-record journey not indexed; public remote MCP separately gated.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 11.1 | Unchecked | Expose validated task/project/board/subtask operations through Streamable HTTP and a real header-capable MCP test client. | WL,I,A,AC: Real MCP operations. Full remaining scope stated above. |
| 11.2 | Unchecked | The owner creates scoped expiring revocable agent credentials; display secrets once, store safe verifiers and log only grant identity. | WL,I,A,AC: one-time grant secret. Full remaining scope stated above. |
| 11.3 | Unchecked | Reject insufficient scope, expired/revoked grants and cross-owner access on every call; agent grants cannot administer credentials. | WL,I,A,AC: scope/revocation/owner. Full remaining scope stated above. |
| 11.4 | Unchecked | Demonstrate bidirectional UI/MCP consistency and idempotent/stale-write behavior through the shared application service. | WL,I,A,AC: UI/MCP consistency. Full remaining scope stated above. |
| 11.5 | Unchecked | Document manually configured credential support accurately; do not advertise automatic OAuth interoperability or a named runtime without verification. | WL,I,A,AC: accurate credential docs. Full remaining scope stated above. |

### 12: Let authorized agents assist with workouts

Existing proof: **WL,I,S**. Remaining scope: Generic SDK operations and shared service evidence; explicit MCP-authored routine/results viewed on final native phone and web needs indexed proof.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 12.1 | Unchecked | Expose routine/exercise reads and allowed planning mutations plus session/result operations under distinct scopes. | WL,I,S: Scopes/operations. Full remaining scope stated above. |
| 12.2 | Unchecked | Require reported/imported provenance for agent-written actual results; preparing a plan never invents a performed session. | WL,I,S: actual-result provenance. Full remaining scope stated above. |
| 12.3 | Unchecked | Keep routine revisions separate from session snapshots and preserve actor/history on corrections. | WL,I,S: snapshot/history. Full remaining scope stated above. |
| 12.4 | Unchecked | Validate irrelevant/invalid measurements and reject stale session writes without losing the person's newer data. | WL,I,S: invalid/stale writes. Full remaining scope stated above. |
| 12.5 | Unchecked | Demonstrate a generic client creating a routine and recording fictional reported results visible on phone/web. | WL,I,S: phone/web visibility. Full remaining scope stated above. |

### 13: Bind reusable skills to agent steps

Existing proof: **WL,A,AC**. Remaining scope: PG workflow/browser and native component proof; final native binding/version snapshot/eligibility journey not indexed.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 13.1 | Unchecked | Create/edit skill references and bind a selected version with inputs and expected outputs to a step. | WL,A,AC: Skill version/inputs. Full remaining scope stated above. |
| 13.2 | Unchecked | Keep the skill binding separate from the worker connection and credential permissions. | WL,A,AC: permissions separation. Full remaining scope stated above. |
| 13.3 | Unchecked | Surface missing skill/input details before work is eligible and preserve human-readable execution instructions. | WL,A,AC: missing details. Full remaining scope stated above. |
| 13.4 | Unchecked | Snapshot resolved instruction/skill version for an attempt so later edits do not rewrite execution history. | WL,A,AC: immutable attempt snapshot. Full remaining scope stated above. |
| 13.5 | Unchecked | Treat instructions and linked content as data, not privileged app code; enforce the same binding operations through UI/MCP. | WL,A,AC: UI/MCP unprivileged data. Full remaining scope stated above. |

### 14: Claim and report an agent attempt

Existing proof: **WL,I**. Remaining scope: Real generic-client claim race/lost-response test passes; preserve final frozen-source rerun and receipt binding.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 14.1 | Unchecked | Implement eligible-step listing, atomic claim, lease renewal, progress/output submission, finish/fail/yield and attempt lookup. | WL,I: Attempt operations. Full remaining scope stated above. |
| 14.2 | Unchecked | Claim snapshots the instruction revision and returns attempt identity plus a protected ownership token and server-controlled expiry. | WL,I: snapshot/token/expiry. Full remaining scope stated above. |
| 14.3 | Unchecked | Only one live claim succeeds; stale/expired owners cannot renew or submit authoritative completion. | WL,I: one winner/stale owner. Full remaining scope stated above. |
| 14.4 | Unchecked | Persist validated outputs/history before acknowledging success; repeated operation IDs recover the original result. | WL,I: durable outputs/replay. Full remaining scope stated above. |
| 14.5 | Unchecked | Exercise two real generic test clients against PostgreSQL, including competing claims and a lost completion response. | WL,I: two SDK clients. Full remaining scope stated above. |
| 14.6 | Unchecked | Authenticate/authorize and return an existing matching operation receipt before new lease/revision validation; retry a successfully committed finish after its lease expired and recover the original result. | WL,I: replay after lease expiry. Full remaining scope stated above. |

### 15: Continue released workflows and pause for people

Existing proof: **WL,P,A,AC**. Remaining scope: PG/browser workflow proof and component proof; final native release/pause/automatic continuation/human handoff journey remains.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 15.1 | Unchecked | Moving work to Next deliberately releases it; first accepted action/claim moves it Active. | WL,P,A,AC: Next release/Active claim. Full remaining scope stated above. |
| 15.2 | Unchecked | After a valid prerequisite finishes, expose all eligible agent steps automatically without an extra Start action. | WL,P,A,AC: continuation. Full remaining scope stated above. |
| 15.3 | Unchecked | Human requirements and unmet dependencies pause progression with an accurate Needs you/Waiting reason. | WL,P,A,AC: human waiting. Full remaining scope stated above. |
| 15.4 | Unchecked | Pause prevents new claims; Planned tasks remain dormant even when their dependencies are satisfied. | WL,P,A,AC: pause/dormancy. Full remaining scope stated above. |
| 15.5 | Unchecked | Preserve single task identity and complete the parent only when required steps and final review are satisfied. | WL,P,A,AC: parent identity/review. Full remaining scope stated above. |

### 16: Recover interrupted and uncertain agent work

Existing proof: **WL,A,AC**. Remaining scope: PG simulated effect recovery and UI proof exists; final integrated native attempt history/reconcile/takeover/restart journey remains.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 16.1 | Unchecked | Retry creates a new attempt while retaining prior progress, outputs and errors; respect configured retryability. | WL,A,AC: Retry history. Full remaining scope stated above. |
| 16.2 | Unchecked | Cancellation is cooperative and visible; it does not claim an already performed external action was undone. | WL,A,AC: cooperative cancel. Full remaining scope stated above. |
| 16.3 | Unchecked | Block late completion from expired/replaced owners or incompatible changed instructions. | WL,A,AC: stale finish. Full remaining scope stated above. |
| 16.4 | Unchecked | Represent unknown external outcomes explicitly and require reconciliation evidence before allowing a duplicate consequential attempt. | WL,A,AC: unknown effect reconciliation. Full remaining scope stated above. |
| 16.5 | Unchecked | Support human takeover/yield/recovery through authorized operations and test lease expiry, server restart and stale responses. | WL,A,AC: takeover/yield/restart. Full remaining scope stated above. |

### 17: Preserve and synchronize offline workouts

Existing proof: **WL,I,W**. Remaining scope: Core PG snapshot/feed and native offline tests exist, but fresh real Expo persistence/kill/relaunch/offline/conflict/epoch proof is pending after newer code.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 17.1 | Unchecked | Persist native record changes and immutable outbox commands transactionally before showing saved-on-device state. | WL,I,W: Atomic local acknowledgement. Full remaining scope stated above. |
| 17.2 | Unchecked | Implement ordered per-aggregate retry/idempotency, confirmed-state/local-projection separation and a durable committed change feed with atomic cursor advancement. | WL,I,W: ordered outbox/feed/cursor. Full remaining scope stated above. |
| 17.3 | Unchecked | Support consistent snapshot/reset and installation-epoch recovery while retaining pending work; pause automatic replay after epoch change and reconcile previously attempted commands whose receipts may have been lost. Never-sent edits are revalidated, not blindly replayed. | WL,I,W: snapshot/epoch/uncertain command. Full remaining scope stated above. |
| 17.4 | Unchecked | Preserve conflicting session versions, stop dependent commands and let unrelated records sync; expose reviewed resolution choices. | WL,I,W: conflict copies/unrelated sync. Full remaining scope stated above. |
| 17.5 | Unchecked | Test airplane-mode logging, full storage, forced termination, expired auth, lost server response, concurrent edits and server restore; timers remain honest. | WL,I,W: failure/interruption matrix. Full remaining scope stated above. |
| 17.6 | Unchecked | Test competing committed writers, transaction-preserving pagination, mutations during a consistent snapshot, and termination between page application and cursor advancement. | WL,I,W: concurrent writers/page atomicity. Full remaining scope stated above. |

### 18: Preserve ordinary task edits offline

Existing proof: **WL,I,W**. Remaining scope: Native offline unit/network tests exist; final real Expo task capture/edit/local status/online-sensitive gates/logout/tombstone journey pending.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 18.1 | Unchecked | Cache useful task views and preserve new Planned tasks, descriptions and ordinary edits in the durable outbox. | WL,I,W: Planned-task outbox. Full remaining scope stated above. |
| 18.2 | Unchecked | Clearly distinguish saved locally, pending, synced and conflicted state. | WL,I,W: local/pending/conflicted labels. Full remaining scope stated above. |
| 18.3 | Unchecked | Require online confirmation for release and changes/completion that can trigger agent work; do not falsely show those effects as committed. Artifact-approval offline gating is verified by the versioned-deliverable ticket. | WL,I,W: online-sensitive gates. Full remaining scope stated above. |
| 18.4 | Unchecked | Handle edit/delete races and recurrence conflicts without resurrecting tombstoned work or fabricating occurrence completion. | WL,I,W: deletion/recurrence races. Full remaining scope stated above. |
| 18.5 | Unchecked | Respect account partitions and pending changes on logout; web remains honestly online-first. | WL,I,W: account/logout partitions. Full remaining scope stated above. |

### 19: Keep a private photo-and-text food diary

Existing proof: **WL,FW,PROD,G,GP,GT**. Remaining scope: Real native Photos and shared food records exist on gym-food artifact; final verifier index and final-source media/date/timezone/camera-error proof pending.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 19.1 | Unchecked | Capture/select photos with permission handling and add free text, editable date/time and daily history. | WL,FW,PROD,G,GP,GT: Capture/date/history/permission. Full remaining scope stated above. |
| 19.2 | Unchecked | Save camera/picker content to durable app-owned storage before acknowledging it; validate server-side photo type and bounded size. | WL,FW,PROD,G,GP,GT: app-owned bytes/validation. Full remaining scope stated above. |
| 19.3 | Unchecked | Introduce the protected private filesystem media lifecycle with staging, immutable identifiers, validated finalization and startup reconciliation; edit/delete preserves identity, authorization and audit history. | WL,FW,PROD,G,GP,GT: private finalization/reconciliation. Full remaining scope stated above. |
| 19.4 | Unchecked | Provide appropriate capture-first phone UI and readable iPad/web history with useful empty/error states. | WL,FW,PROD,G,GP,GT: capture-first/history/errors. Full remaining scope stated above. |
| 19.5 | Unchecked | Do not infer calories, nutrients or meal plans. Provide the validated owner-scoped food operations that the later MCP slice can expose. | WL,FW,PROD,G,GP,GT: truthful food/shared operations. Full remaining scope stated above. |
| 19.6 | Unchecked | Reject unauthenticated copied URLs and traversal paths; serve no public static media route and apply private/no-store download headers. | WL,FW,PROD,G,GP,GT: private URL/traversal/no-store. Full remaining scope stated above. |

### 20: Review private versioned deliverables

Existing proof: **WL,A,AC,PROD**. Remaining scope: PG file lifecycle and explicit review proof exists; final native attachment/revision/offline approval-response reconciliation proof not indexed.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 20.1 | Unchecked | Reuse the food diary's authenticated bounded media transfer and private persistent volume for task files and result artifacts, with immutable IDs and appropriate type/size/checksum validation. | WL,A,AC,PROD: Private validated files. Full remaining scope stated above. |
| 20.2 | Unchecked | Handle the database/filesystem finalization gap, retries, orphan cleanup and storage failure without broken finalized attachments. | WL,A,AC,PROD: finalization/storage gap. Full remaining scope stated above. |
| 20.3 | Unchecked | Create result versions; viewing is not acceptance, and explicit approval names the accepted version. | WL,A,AC,PROD: version-specific approval. Full remaining scope stated above. |
| 20.4 | Unchecked | Requesting changes returns the work for another attempt with feedback; changed artifacts invalidate relevant approval/readiness. | WL,A,AC,PROD: request changes/invalidation. Full remaining scope stated above. |
| 20.5 | Unchecked | Approval requires online confirmation; disconnect or lose the response during approval and prove that the UI never claims acceptance before reconciling the server result. | WL,A,AC,PROD: online approval/lost response. Full remaining scope stated above. |
| 20.6 | Unchecked | Protect owner access, strip private media metadata from newly derived display copies where appropriate, and preserve useful history and original provenance. | WL,A,AC,PROD: metadata/privacy/provenance. Full remaining scope stated above. |

### 21: Prove the complete YouTube handoff workflow

Existing proof: **WL,A**. Remaining scope: Actual PG fictional rejected-edit and lost-upload full scenarios pass; final-source integration and cross-client visibility remain, no real YouTube integration required.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 21.1 | Unchecked | Represent script, human recording, agent edit, human review, private upload, agent thumbnail, human thumbnail approval/attachment and human publication. | WL,A: Complete template. Full remaining scope stated above. |
| 21.2 | Unchecked | Allow thumbnail drafting after the script in parallel with recording/editing; publication waits for both accepted paths. | WL,A: parallel thumbnail. Full remaining scope stated above. |
| 21.3 | Unchecked | Distinguish watching, approval, private upload and publication, with version-specific evidence and feedback loops. | WL,A: separate review/upload/publication. Full remaining scope stated above. |
| 21.4 | Unchecked | Exercise automatic continuation, pause, competing workers, stale output and uncertain-upload recovery end to end. | WL,A: races/unknown effects. Full remaining scope stated above. |
| 21.5 | Unchecked | Use generic MCP test clients and fictional artifacts; do not build real editors/upload integrations or publish personal media. | WL,A: real generic test clients/fictional artifacts. Full remaining scope stated above. |

### 22: Recover offline food entries and photo uploads

Existing proof: **WL,I,W,G,GP**. Remaining scope: Server interruption/private media tests and prior native photo copy exist; newer offline file/outbox implementation lacks fresh actual Expo kill/relaunch and interrupted-upload proof.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 22.1 | Unchecked | Retain local photo bytes and entry/outbox state through restart until confirmed upload and attachment finalization. | WL,I,W,G,GP: Local bytes/outbox. Full remaining scope stated above. |
| 22.2 | Unchecked | Resume retries safely after expired auth, dropped responses, duplicate requests or storage failure without duplicate entries/photos. | WL,I,W,G,GP: retries/auth/storage. Full remaining scope stated above. |
| 22.3 | Unchecked | Distinguish local capture from server-visible records and expose meaningful sync errors. | WL,I,W,G,GP: local/server status. Full remaining scope stated above. |
| 22.4 | Unchecked | Handle entry deletion while an upload is pending, tombstones and conflict copies without orphan leaks or resurrected records. | WL,I,W,G,GP: delete/tombstone/conflicts. Full remaining scope stated above. |
| 22.5 | Unchecked | Validate active/pending file references before cleanup and preserve all unsent records regardless of cache limits. | WL,I,W,G,GP: reference-safe cleanup. Full remaining scope stated above. |
| 22.6 | Unchecked | Test termination after a finalized file rename but before PostgreSQL attachment commit, server full-disk failure and container replacement with the media volume retained. | WL,I,W,G,GP: rename/commit/full-disk/container recovery. Full remaining scope stated above. |

### 23: Connect and disconnect an official WHOOP account

Existing proof: **WL,I**. Remaining scope: Real PG adapter fixture proof; exact UI documentation and final native states need sign-off. Live personal consent/read/refresh/revoke remain external ticket29 gate.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 23.1 | Unchecked | Use registered per-installation developer credentials, a configured HTTPS callback, authorization-code OAuth and state validation. | WL,I: OAuth/state/callback config. Full remaining scope stated above. |
| 23.2 | Unchecked | Request only the specified read/profile/refresh scopes; protect server-side credentials and rotated tokens and serialize concurrent refresh. | WL,I: bounded scopes/rotation. Full remaining scope stated above. |
| 23.3 | Unchecked | Show connection, expiry/reconnect and error states; the rest of the app works without WHOOP. | WL,I: optional connection states. Full remaining scope stated above. |
| 23.4 | Unchecked | Disconnect stops polling, attempts remote revocation, deletes local credentials and reports failure honestly; default retained observations are labelled disconnected with explicit deletion offered. | WL,I: honest revoke/disconnect. Full remaining scope stated above. |
| 23.5 | Unchecked | Test fixtures and provide exact private-configuration/consent instructions. Implementation acceptance can resolve with the live read/refresh/revoke gate explicitly transferred to final release verification; never describe an untested account as connected or request secrets in chat. | WL,I: fixtures/docs + transferred live gate. Full remaining scope stated above. |
| 23.6 | Unchecked | Account replacement creates a new provider-account synchronization boundary; retained old-account records remain clearly identified and excluded from current-account summaries. | WL,I: replacement account boundary. Full remaining scope stated above. |

### 24: Use WHOOP context without replacing local training

Existing proof: **WL,I**. Remaining scope: PG provider fixtures and scoped MCP reads prove adapter paths; final native source/freshness/unavailable/linking views need index. Live account claims remain unverified.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 24.1 | Unchecked | Read v2 workout/cycle/recovery/sleep observations with bounded hourly polling, manual refresh throttling, pagination and the specified connection-time/seven-day window. | WL,I: Bounded v2 polling. Full remaining scope stated above. |
| 24.2 | Unchecked | Upsert by provider account/type/ID with score state, time zone, interval, provider revision time and retrieval freshness. | WL,I: provider identity/freshness. Full remaining scope stated above. |
| 24.3 | Unchecked | Show missing/unscored and stale/failed states honestly; handle 401, 429, rotated credentials and duplicate/reordered observations. | WL,I: score/outage/rate-limit. Full remaining scope stated above. |
| 24.4 | Unchecked | Offer explicit suggested-session linking; never silently merge by timestamp, overwrite local sets/notes or double count one activity. | WL,I: explicit linking. Full remaining scope stated above. |
| 24.5 | Unchecked | Expose permitted provider reads through MCP without credentials; do not promise unsupported write-back, detailed strength data or continuous heart-rate streams. | WL,I: scoped MCP read. Full remaining scope stated above. |
| 24.6 | Unchecked | Recheck known IDs within the bounded reconciliation window and support manual refresh for older observations; authenticated resource-specific 404 marks provider data unavailable without deleting local workout results. | WL,I: bounded 404 reconciliation. Full remaining scope stated above. |

### 25: Use a daily focus view across phone, tablet and web

Existing proof: **D,DL,PROD,G**. Remaining scope: Live PG Today exact-record paths at five sizes passed/cleaned. Final native Today compact/wide/rotation/state proof pending; web Food timezone consistency repair assigned.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 25.1 | Unchecked | Provide direct Tasks/Workouts/Food navigation plus Today with due/next human actions, waiting reasons, active session and quick food capture. | D,DL,PROD,G: Today/direct navigation. Full remaining scope stated above. |
| 25.2 | Unchecked | Use a practical one-handed phone layout, adaptive iPad list/detail management and denser keyboard-friendly web planning. | D,DL,PROD,G: phone/tablet/web layout. Full remaining scope stated above. |
| 25.3 | Unchecked | Retain useful navigation/view state without mixing histories or hiding failed/pending work. | D,DL,PROD,G: retained state/pending failures. Full remaining scope stated above. |
| 25.4 | Unchecked | Cover empty, loading, offline, no-permission and recoverable-error states; preserve in-progress input. | D,DL,PROD,G: honest async states/input. Full remaining scope stated above. |
| 25.5 | Unchecked | Verify compact/wide tablet sizes, rotation/resizing, non-drag alternatives and navigation to each underlying record. | D,DL,PROD,G: five sizes/record navigation. Full remaining scope stated above. |

### 26: Receive useful opt-in reminders and handoff alerts

Existing proof: **WL,I,W**. Remaining scope: In-app attention/Expo fixture/native component checks exist; actual local notification tap/cancel/permission/logout proof pending. Configured real push is external gate.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 26.1 | Unchecked | Keep an in-app attention list available without OS permission or a configured push provider. | WL,I,W: Attention without permission. Full remaining scope stated above. |
| 26.2 | Unchecked | Use native local timer/due reminders and an optional configured Expo push adapter for remote handoff/failure alerts. | WL,I,W: local/optional push. Full remaining scope stated above. |
| 26.3 | Unchecked | Deduplicate delivery events, honor user preferences and logout/revocation, avoid private-content previews by default and deep-link correctly. | WL,I,W: dedup/private payload/deep link. Full remaining scope stated above. |
| 26.4 | Unchecked | Handle denied permission, invalid tokens, provider failure and receipt errors without losing the underlying task event. | WL,I,W: denial/provider errors. Full remaining scope stated above. |
| 26.5 | Unchecked | Document project/Apple credential setup and distinguish fixture/provider tests from real configured delivery; self-hosted core use requires no push service. | WL,I,W: exact setup vs actual delivery. Full remaining scope stated above. |

### 27: Export, back up and restore personal records

Existing proof: **WL,M,I,OP**. Remaining scope: Actual independent Compose DB/media backup/restore now passes through separate operator image. Final frozen operator receipt plus actual offline pending/uncertain restore convergence still required.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 27.1 | Unchecked | Export owner records and attachments in a documented machine-readable format, excluding passwords, tokens and private configuration secrets. | WL,M,I,OP: Secret-free export. Full remaining scope stated above. |
| 27.2 | Unchecked | Provide a coherent maintenance-window backup: pause mutations/uploads/cleanup, drain in-flight work, then dump PostgreSQL and archive private media plus separately protected configuration. Verify restored attachment checksums. | WL,M,I,OP: coherent protected backup/checksums. Full remaining scope stated above. |
| 27.3 | Unchecked | Restore into an independent test installation, rotate its synchronization epoch, pause replay and retain pending edits. Reconcile previously sent/uncertain commands whose idempotency receipts may have disappeared, then revalidate never-sent work. | WL,M,I,OP: independent restore/epoch/pending reconciliation. Full remaining scope stated above. |
| 27.4 | Unchecked | Test migrations from an earlier fixture schema and define failure/rollback recovery rather than silently starting empty. | WL,M,I,OP: migration recovery. Full remaining scope stated above. |
| 27.5 | Unchecked | Document retention/deletion effects and prevent cleanup from deleting referenced or pending media. | WL,M,I,OP: retention/reference-safe cleanup. Full remaining scope stated above. |

### 28: Manage food diary records through MCP

Existing proof: **WL,I,GT**. Remaining scope: SDK food/scopes/media tests exist; explicit agent-created fictional meal viewed in final native history and revoked/read-only write denial needs linked proof.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 28.1 | Unchecked | Expose food entry read/create/edit operations and an authorized bounded attachment workflow through the generic MCP adapter. | WL,I,GT: Scoped operations/attachment. Full remaining scope stated above. |
| 28.2 | Unchecked | Require appropriate domain scopes and source attribution; never infer that a plan was eaten or invent nutrient measurements. | WL,I,GT: explicit food provenance. Full remaining scope stated above. |
| 28.3 | Unchecked | Reuse the private media lifecycle without exposing storage paths, credentials or another owner's photos. | WL,I,GT: private lifecycle. Full remaining scope stated above. |
| 28.4 | Unchecked | Preserve revisions and idempotency so retries do not create duplicate food entries or attachments. | WL,I,GT: revisions/idempotency. Full remaining scope stated above. |
| 28.5 | Unchecked | Demonstrate an agent-created fictional entry in web/native history and reject a read-only or revoked client's write. | WL,I,GT: native/web visibility + denied writes. Full remaining scope stated above. |

### 29: Verify and package the first complete release

Existing proof: **W,WL,PROD,IMG,OP,N1,N2,G**. Remaining scope: Integrated release remains open. Final independent checkout/source freeze, native interruption/a11y proof, and literal external checks below are unfinished.

| ID | Tracker | Literal criterion | Existing proof / bounded coverage |
|---|---|---|---|
| 29.1 | Unchecked | Run clean lockfile install, static/type checks, relevant operation/component/PostgreSQL tests and production builds from an independent checkout. | W,WL,PROD,IMG,OP,N1,N2,G: Independent clean install/build/static/tests. Full remaining scope stated above. |
| 29.2 | Unchecked | Run critical web journeys in Chromium, Firefox and WebKit and native iPhone/iPad simulator journeys, including offline and interruption recovery. | W,WL,PROD,IMG,OP,N1,N2,G: three-engine + native/offline. Full remaining scope stated above. |
| 29.3 | Unchecked | Inspect light/dark, text scaling, screen readers/focus, reduced motion, keyboard, touch targets, camera/media errors and compact/wide tablet layouts. | W,WL,PROD,IMG,OP,N1,N2,G: full quality matrix. Full remaining scope stated above. |
| 29.4 | Unchecked | Coordinate before physical-device testing; verify real camera/OAuth/push behavior and the selected Apple build path, separately from simulator evidence. | W,WL,PROD,IMG,OP,N1,N2,G: physical camera/OAuth/push/Apple path. Full remaining scope stated above. |
| 29.5 | Unchecked | Record signed-distribution, real WHOOP and reachable remote MCP checks when authorized/configured; report unavailable credentials/devices as specific unmet gates, not completed support. | W,WL,PROD,IMG,OP,N1,N2,G: signed/liveWHOOP/remoteMCP. Full remaining scope stated above. |
| 29.6 | Unchecked | Provide honest installation/update/recovery/contributor docs, fictional demo data and a scan for secrets/personal records; do not publish/deploy/store-submit without the corresponding instruction. | W,WL,PROD,IMG,OP,N1,N2,G: honest docs/demo/secrets scan. Full remaining scope stated above. |

## Literal ticket 29 external gates

These are separate from a buildable local release candidate and must remain explicitly unmet unless actual configured evidence is obtained. The wording does not permit checking every criterion solely because unavailable gates are described.

- **29.4:** “Coordinate before physical-device testing; verify real camera/OAuth/push behavior and the selected Apple build path, separately from simulator evidence.” Existing iOS26.5 simulators under Xcode27 prove their exact release artifacts, not physical camera, live OAuth, push, iOS27 runtime launch or signing.
- **29.5:** “Record signed-distribution, real WHOOP and reachable remote MCP checks when authorized/configured; report unavailable credentials/devices as specific unmet gates, not completed support.” Missing actual signed distribution, personal WHOOP consent/read/refresh/revoke, and externally reachable HTTPS/MCP remain specific gates. Header-capable generic loopback SDK success is real but does not establish remote DNS/TLS/connectivity.
- **29.3:** Full native accessibility/text scale/screen reader, reduced motion/touch targets and media failure inspection is still required. Production browser evidence uses bounded contrast/focus/overflow checks and 125% root scale; it explicitly does not establish a full WCAG audit or every 200% fixed-label case.
- **29.1/29.2:** Independent clean checkout plus final integrated native offline/interruption test source identity remains pending; earlier passing artifacts do not prove the final source.
- **29.6:** Operator/MCP/WHOOP/notifications and contributor docs exist, but final source-linked docs/demo/secret-and-personal-record scan receipt has not been located in this audit. No deployment/publication/store submission is implied.

## Native artifact/source mismatch

Compared current SHA-256 values with `native-gym-food/source-snapshot.json` during this audit. These 13 files differ; new offline files are absent from that old snapshot entirely. The artifact should retain its historical identity rather than have hashes rewritten to current code.

- `apps/mobile/package.json`
- `apps/mobile/src/App.tsx`
- `apps/mobile/src/client.ts`
- `apps/mobile/src/features/Food.tsx`
- `apps/mobile/src/features/Productivity.tsx`
- `apps/mobile/src/features/Sessions.tsx`
- `apps/mobile/src/features/Tasks.tsx`
- `apps/mobile/src/media.ts`
- `apps/mobile/src/timers.ts`
- `packages/domain/src/agent-workflows.ts`
- `packages/domain/src/index.ts`
- `packages/domain/src/sessions.ts`
- `packages/domain/src/steps.ts`

## Documentation reconciliation

`docs/release-progress.md` still describes several implemented domains as remaining implementation and only checkpoints migrations 1–8. Saved workspace and image evidence now prove a broader wired surface and migrations through14. Update the progress document after final acceptance review; retain its statement that builds/module tests alone are not native/database acceptance. The ticket tracker intentionally remains conservative until proof is recorded.

Operator proof is currently a raw `.runtime/operator-verify-result.log`, not a durable structured evidence receipt with complete source manifests. Preserve/index it under the release evidence directory in the final packaging step, alongside final app/operator image identities. This audit records the actual success without declaring final freeze complete.
