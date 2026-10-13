# Release progress

This document records verified checkpoints and remaining work on October 13, 2026. The first-release tickets remain the acceptance record. Builds do not establish device behavior, provider connections, or distribution.

## Tasks and reusable workout routines

The shared PostgreSQL service supports private owner access, configurable task boards, mixed human and agent steps, recurring work, exercise catalogs, reusable routines, live workout sessions, workout history, private food entries, and versioned task files. Human and MCP commands use the same authorization, revision, operation identity, and history rules.

External agents use scoped MCP credentials, immutable skill bindings, claim leases, progress reports, deliverable review, and explicit recovery of uncertain attempts. The fictional YouTube workflow is a dormant example. The application does not launch an embedded agent runtime.

The web and native clients have Today, tasks, routines, sessions, food, and settings. The native client has a durable SQLite projection, command queue, drafts, retained photo bytes, and explicit recovery choices. Native offline behavior still requires a rebuilt application journey against the latest source.

WHOOP uses the official read-only adapter, encrypted server credentials, bounded polling, and account-specific provenance. Provider tests use fixtures. No personal WHOOP account is connected.

## Verified integration checks

The latest receipts establish these checks.

- Independent checkout `9a8a584` passed clean `npm ci`, workspace typechecks, lint, formatting, and all builds. Its canonical tests passed 39 domain, 94 mobile, and 23 PostgreSQL cases with no skips. Five SQLite/service recovery scripts passed. The production web journey passed in three engines with zero CSP violations, and five Chromium authentication checks passed. See `.scratch/mems-life-v1/evidence/clean-checkout/verification.json`.
- The production web artifact passed its critical journey in Chromium, Firefox, and WebKit with Zod 4.6.7 and zero CSP violations. Secure cookies, private photos after reload, protected file downloads, dark preferences, keyboard focus, and phone/tablet layouts were checked. See `evidence/production-web/verification.json`.
- Today passed against the running PostgreSQL service at five browser sizes. Navigation opened the exact task, active session, and food entry. The verifier cleaned only its own records. See `.scratch/mems-life-v1/evidence/daily-focus-live/adaptive-final-run.log`.
- Immutable iPhone and iPad Release artifacts passed private sign-in, task lifecycle, and routine management. The later gym/food artifact passed a full iPad workout, interruption/restart, plan adaptation, explicit finish, corrections, and private photo display on both devices. That artifact predates the offline implementation. Its remaining phone journey is being finalized.
- Real file-backed Node 24 SQLite checks passed durable queue recovery, cursor rebootstrap, restored-epoch review, photo draft retention, and explicit orphan-photo recovery. These checks exercise the persistence protocol. They do not replace Expo SQLite force-quit and airplane-mode verification.
- Final Linux ARM64 images passed against unchanged captured production source. The minimal application image passed owner bootstrap, authentication, private media, and restart persistence. The operator image passed actual Compose export, coherent PostgreSQL 16 backup, independent database/media restore, rotated epoch, closed maintenance, unchanged original data, and explicit resume. Each exact 212-package npm runtime inventory returned no registry advisories. OS and native-library vulnerability coverage is separate. See `.scratch/mems-life-v1/evidence/final-container/verification.json`.

## Remaining acceptance

The next native Release artifact must include the current offline recovery, Today, agent workflow, date picker, and sharing code. Its phone and iPad journeys must verify retained edits and photos after interruption, synchronization conflicts, and restored-backup review. The web diary timezone fix passed live PostgreSQL tests. Final native recovery review is in progress.

The release review still needs final native artifact checks and acceptance reconciliation. The clean-checkout and final-image checks are complete. Reviewed evidence is retained separately from private raw traces. Light/dark and keyboard checks are bounded proof, not a complete accessibility audit. Native-library source provenance remains a distribution gate documented in `docs/native-image-licenses.md`.

Real WHOOP consent, signed Apple distribution, coordinated physical-device camera testing, reachable remote HTTPS/MCP, and configured remote push delivery remain external gates. The precise proof is recorded in `.scratch/mems-life-v1/release-gates.md`. No public deployment, store submission, or personal account change has occurred.
