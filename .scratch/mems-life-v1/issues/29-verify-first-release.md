# 29: Verify and package the first complete release

Status: ready-for-agent
State: claimed
Blocked by: 12, 21, 26, 27, 28
Spec: [Mem's Life first release](../spec.md)
Coverage: US-01–68
Phase: authorized implementation and release verification in progress; acceptance remains unverified

## What to build

A reproducible release candidate demonstrates the complete product, with remaining external validation gates reported accurately.

## Acceptance criteria

- [ ] Run clean lockfile install, static/type checks, relevant operation/component/PostgreSQL tests and production builds from an independent checkout.
- [ ] Run critical web journeys in Chromium, Firefox and WebKit and native iPhone/iPad simulator journeys, including offline and interruption recovery.
- [ ] Inspect light/dark, text scaling, screen readers/focus, reduced motion, keyboard, touch targets, camera/media errors and compact/wide tablet layouts.
- [ ] Coordinate before physical-device testing; verify real camera/OAuth/push behavior and the selected Apple build path, separately from simulator evidence.
- [ ] Record signed-distribution, real WHOOP and reachable remote MCP checks when authorized/configured; report unavailable credentials/devices as specific unmet gates, not completed support.
- [ ] Provide honest installation/update/recovery/contributor docs, fictional demo data and a scan for secrets/personal records; do not publish/deploy/store-submit without the corresponding instruction.

## Verification

Produce an evidence checklist with commands, environment and observed results for the integrated fictional-user path; distinguish built, tested, connected and distributed status.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments
