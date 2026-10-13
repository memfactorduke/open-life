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

- [x] Run clean lockfile install, static/type checks, relevant operation/component/PostgreSQL tests and production builds from an independent checkout.
- [x] Run critical web journeys in Chromium, Firefox and WebKit and native iPhone/iPad simulator journeys, including offline and interruption recovery.
- [ ] Inspect light/dark, text scaling, screen readers/focus, reduced motion, keyboard, touch targets, camera/media errors and compact/wide tablet layouts.
- [ ] Coordinate before physical-device testing; verify real camera/OAuth/push behavior and the selected Apple build path, separately from simulator evidence.
- [x] Record signed-distribution, real WHOOP and reachable remote MCP checks when authorized/configured; report unavailable credentials/devices as specific unmet gates, not completed support.
- [x] Provide honest installation/update/recovery/contributor docs, fictional demo data and a scan for secrets/personal records; do not publish/deploy/store-submit without the corresponding instruction.

## Verification

Produce an evidence checklist with commands, environment and observed results for the integrated fictional-user path; distinguish built, tested, connected and distributed status.

Apply the specification's shared authorization, history, revision and error rules. Use fictional fixtures and test observable behavior. Before setting State to resolved, record actual implementation evidence. Pure mocks cannot establish native/database correctness; provider fixtures may establish adapter behavior, with unavailable live consent/signing/delivery checks explicitly tracked in final release verification. Never describe an unverified connection or distributable as complete.

## Comments

Evidence: Current acceptance reconciliation (2026-10-13). 29.1/29.2: [independent clean-checkout execution](../evidence/clean-checkout/verification.json), [final independent container/restore execution](../evidence/final-container/verification.json), historical actual phone/iPad native receipts plus `native-gym-food/sqlite-fixed-release` and `cold-start-release` interruption/durability proofs. [later mobile execution at b5cdf94](../evidence/mobile-final-photo-checks.json) records narrow later mobile delta checks; its 119 tests overlap earlier 94 and are not added together. 29.5 is qualified reporting: signed distribution, real WHOOP, public HTTPS/MCP and physical/push gates are explicitly unavailable/pending in `release-gates.md`, not falsely completed. 29.6: installation/update/recovery/contributor docs and fictional fixtures exist; `dependency-privacy-audit.json` records a real scan and exclusion of raw credential-bearing traces; reviewed allowlisted receipts preserve local provenance. 29.3/29.4 remain unchecked for full quality and physical/signing/live checks.

Evidence: Current source refresh (2026-10-13). [Current canonical workspace receipt](../evidence/final-history-workspace-checks.json) records cdf1f84:39 domain,119 mobile and23 actual PG/server tests (181 total), zero failures/skips, all workspace types/lint/format. [Fresh final-history app/operator image receipt](../evidence/final-history-container/verification.json) records stable source manifestd9efa2c3, app6f4e94b8 and operator376afc90, real compiled task-file finalize/restart/detach history200, private transfers, independent protected restore and zero matching advisory packages in each212-package npm inventory. This bounded npm check excludes native/OS vulnerability review; source-license/external distribution gates remain. Later mobile131 tests overlap119; do not sum them. These receipts supersede older container/source limitations for packaging but do not complete29.3/29.4 quality/physical gates.

Evidence: Current delta/gate boundary (2026-10-13). [Navigation delta receipt](../evidence/final-mobile-navigation-checks.json) identifies a5c8d4c and current App/source/test hashes: 134 mobile tests in25 suites, zero failure/skip, mobile types/lint/format pass. This repairs the actual compact-iPad largest-font fragmented tab labels with a full-width area picker, preserving unrestricted text scaling. Counts overlap prior mobile runs; shared domain/server/container source is unchanged. Rebuilt native pixel and accessibility inspection remains pending; no checkbox is promoted from these component checks. Optional remote Expo push is explicitly deferred for the local release candidate and disabled by default, as recorded in [release gates](../release-gates.md). Current adapter/protocol fixtures and local notification implementation remain in scope; actual configured remote delivery becomes an external gate if enabled. Native local permission/scheduling/deep-link/logout proof is still required for26.2–26.4. Apple development signing/provisioning is being investigated against an authorized physical iPad; no completed physical or signed-build result is asserted.
