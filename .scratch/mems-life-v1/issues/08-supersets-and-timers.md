# 08: Train with supersets and reliable timers

Status: ready-for-agent
State: resolved
Blocked by: 06
Spec: [Mem's Life first release](../spec.md)
Coverage: US-39, US-45
Phase: authorized implementation in progress; acceptance remains unverified

## What to build

Group exercises into supersets and use rest/exercise timers that remain understandable through backgrounding and restart.

## Acceptance criteria

- [x] Create and execute ordered superset groups while keeping results attached to the correct exercise and round.
- [x] Support start, pause, resume, reset and optional auto-rest after a recorded set, without silently marking an exercise complete.
- [x] Persist timer state/deadlines and derive elapsed/remaining time after backgrounding; handle device-clock changes deliberately.
- [x] Provide optional sound/haptic/local notification with graceful denied-permission behavior and avoid duplicate alerts across devices.
- [x] Verify foreground, background and process-restart behavior; do not rely on continuous JavaScript or guaranteed background execution.
- [x] Cancel or replace obsolete local notifications when timers change, finish or resume; reconcile persisted timer/notification state on app startup.

## Verification

Run a two-exercise superset, background during rest, relaunch and compare the persisted timer and recorded sets.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Reconciled 2026-10-13 against the literal criteria, [historical acceptance audit](../acceptance-audit.md), current executed receipts and the named test assertions. PostgreSQL session test verifies correct superset associations and durable deadline/pause/resume state. Earlier immutable native iPad proof verifies ordered Press→Body rounds and online timer background/force-quit recovery against the same server deadline.

Evidence: The independent clean checkout receipt identifies commit `9a8a584fa708ec23d945f9e49675b48d04d8401a`: 39 domain + 94 mobile component + 23 actual PostgreSQL/server tests (156 total, zero skips), five standalone recovery scripts, types/lint/format and production builds pass. Three production browser engines pass with zero CSP violations; five Chromium auth compatibility cases pass. [Safe clean-checkout receipt](../evidence/release-safe/receipts/clean-checkout--verification.json). These counts establish their exact source/run boundary, not every native acceptance criterion.

Evidence: [Safe immutable gym/food receipt](../evidence/release-safe/receipts/native-gym-food--results.json) records exact successes, failed exploratory/visual gates and source limitations; it predates the current offline/Today source.

Evidence remaining: Current literal unchecked criteria retain only the concrete boundaries stated in the reconciliation below; historical evidence above remains scoped to its original source/artifact.

Evidence: Current acceptance reconciliation (2026-10-13). 08.1–08.3 and 08.5: [session service execution](../evidence/sessions-service/receipt.json), [immutable native mixed-workout/diary execution](../evidence/native-gym-food/results.json), [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json); actual native superset rounds, preserved draft, start/pause/resume/background/terminate/relaunch and unchanged deadline are recorded by the immutable native receipt. Server-derived timer intervals and clock-change handling are covered by session/component assertions. 08.4/08.6 remain unchecked: actual Expo permission/delivery and schedule replacement/cancellation/startup reconciliation still need OS evidence.

Evidence: Native quality/lifecycle reconciliation (2026-10-13). 08.6 now verified from [final native receipt](../evidence/native-gym-food/final-native-receipt.json) and actual OS snapshots [scheduled](../evidence/native-gym-food/recovery-final-release/ipad-scheduled-os-notifications.json), [replaced](../evidence/native-gym-food/recovery-final-release/ipad-replaced-os-notifications.json), [canceled](../evidence/native-gym-food/recovery-final-release/ipad-canceled-os-notifications.json): permission Allow, one owned request, changed request identifier after reset, retained timer through cold launch and empty owned pending list after cancellation. Executed timer/local-reconciliation assertions cover changed/finished/resumed persisted state alongside actual restart execution. This is schedule lifecycle proof;08.4 remains open for the pending actual alert delivery/perception check.

Evidence: Final local alert and bounded quality reconciliation (2026-10-13). 08.4: actual navigation bundle5fde timer delivery is recorded in [OS after-deadline snapshot](../evidence/native-gym-food/navigation-final-release/ipad-120s-after-deadline.json): the exact session4b479dd2/timer71d2f37d request moves from the single pending request to DeliveredNotifications. Actual notification-card tap/unlock passes public XCTest `navigation-final-release/ipad-delivered-coordinate-tap.xcresult`, returning foreground and the exact Native OS Timer Delivery Probe heading. Combine with actual denied phone/Allow Pad behavior and schedule lifecycle proof, executed timer reconciliation tests, and source inspection of initiating-device ownership, optional default-sound selection and best-effort Expo haptics. This establishes optional alert behavior and duplicate ownership; physical audible/haptic perception is not claimed.

Evidence: Dependency reconciliation (2026-10-13). All literal criteria are verified by the scoped receipts above; all listed prerequisites are now resolved. State resolved. External physical/live-provider gates remain in29 and are not inferred from this resolution.
