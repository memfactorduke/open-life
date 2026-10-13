# 01: Private first run across web and mobile

Status: ready-for-agent
State: resolved
Blocked by: None
Spec: [Mem's Life first release](../spec.md)
Coverage: US-01–04, US-68
Phase: verified implementation; external distribution gates remain in ticket 29

## What to build

A fresh private installation can provision its owner, sign in from web and native clients, and retain an owner-scoped record through restart.

## Acceptance criteria

- [x] Create the supported workspace, service, database and client baseline with a pinned compatible toolchain and repeatable checks; include MIT for original source and preserve third-party notices.
- [x] Provide documented one-time local owner bootstrap and recovery, with public signup disabled and no SMTP requirement. Repeated bootstrap refuses safely.
- [x] Browser and native sign-in access the same private account; unrelated, absent, revoked and expired credentials cannot read or mutate its data.
- [x] Use secure browser sessions, origin/CSRF defenses, supported password handling and OS secure storage; credentials never enter content caches, logs or client bundles.
- [x] Demonstrate a real PostgreSQL-backed authenticated round trip from web, iPhone and iPad layouts, restart persistence, and session revocation.

## Verification

Run a clean disposable installation, bootstrap once, sign in on browser and native test clients, then revoke and reject a session. Record any physical/signing gates separately.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments


Evidence: (2026-10-13). Real PostgreSQL CLI/service regression tests passed with no skips, and 15 browser cases passed across Chromium, Firefox and WebKit. Commands and source hashes are recorded in [foundation results](../evidence/foundation-service/results.json), with [service output](../evidence/foundation-service/tests.log). Actual iPhone and iPad sign-in, preference save, stop/relaunch persistence, sign-out and another relaunch passed on the owned iOS 26.5 simulators. The immutable foundation Release bundle hash and passing native commands/screenshots are recorded in [native results](../evidence/native-foundation/results.json) and [checkpoint](../evidence/native-foundation/checkpoint.md). The foundation snapshot predates later task/routine sources. Physical devices, iOS 27 launch, distribution signing and externally reachable HTTPS remain separate ticket 29 gates.
