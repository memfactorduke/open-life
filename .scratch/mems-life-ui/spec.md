# Usability refinement of the initial release

Authorized by the maintainer on 2026-10-13 after the first production run. This work changes presentation and interaction within the approved v1 product. It does not select an agent runtime or add nutrition, public registration, or native Mac scope.

## Daily use

Keep Today, Tasks, Workouts, Food, and Settings as stable destinations. The phone uses a bottom bar, regular-width windows use a sidebar, and large text retains every destination. Layout decisions inside features use their measured available width.

Today shows the date, current workout, items needing action, recent food, and direct capture. Waiting work is disclosed separately. Task detail opens in reading mode, with its next ordinary action and any required step visible; editing and configuration are explicit secondary actions. Workout opens the logger first, with exercise, previous performance, set fields, Log set, rest controls, and Finish workout accessible. Routines remain a secondary view and can start their exact selected routine directly. Food opens a daily timeline; photo/text capture needs no additional metadata step. Cancel preserves a draft.

## Setup and management

A native installation address is requested only when missing or intentionally changed. Verify the address before requesting credentials. Returning users see email and password immediately. There is no compulsory introduction or permission tour.

Settings is an index of focused sections. Native includes Profile, Notifications, Connections, Account, and Sync & recovery. Web includes the four applicable account sections; it does not pretend to provide native offline storage. Keep preferences and revision review across section navigation.

Connections starts with issued agent access and an Add agent action. Permission presets use explicit conservative scopes and retain complete custom scope selection. Expiry uses ordinary local dates and duration choices. The one-time key and endpoint are directly copyable. Access active describes authorization, not an observed running connection. WHOOP is an optional connection, with observations still reachable in its details. Notification permission is requested only from the explicit enable action.

## Technical decisions and alternatives

- Keep the existing five destinations instead of adding a Connections tab or hiding Settings in More. Daily work remains familiar and configuration no longer dominates it.
- Use an index/detail Settings flow instead of one expanded form or a first-run wizard. People make one management decision at a time, and no optional setup blocks capture.
- Keep shared React Native/web implementations instead of changing frameworks. A framework switch would not resolve excessive explanation, competing buttons, or poor flow ordering.
- Reveal secondary controls instead of deleting capabilities. Preserve custom agent permissions, history, archives, task configuration, workout corrections, and recovery.
- Make healthy native sync quiet and show pending/error states with a direct recovery link. Count pending rows in SQLite instead of decoding immutable history on each save. Confirmed synchronization remains different from a local save.

## Required verification

Run native regression tests, actual SQLite tests, all authenticated browser journeys in Chromium/Firefox/WebKit, and responsive visual checks. Build a fresh native Release artifact with captured inputs and verify iPhone/iPad simulator flows, dynamic text, keyboard, persistence, timer controls, and clipboard. A physical iPad is unavailable before 03:00 America/New_York on October 14; coordinate ownership and preserve existing personal data when it becomes available. Source merging does not constitute deployment or Apple distribution acceptance.

Preserve immutable retry payloads, expected revisions, exact artifact versions, retained offline photos, restore review, sign-out choices, and uncertain-effect reconciliation. Test failures must be explained and corrected; selector changes must describe the new visible interaction rather than weakening assertions.

## Guidance read

Apple Human Interface Guidelines: Onboarding, Writing, Layout, Buttons, Tab bars, Sidebars, Accessibility, Managing accounts. Nielsen Norman Group: Progressive Disclosure, Recognition and Recall, Minimize Cognitive Load. W3C WAI: labels, instructions, error identification, and error suggestions. Links and visual evidence are maintained in the HTML usability audit.
