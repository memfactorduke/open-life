# Release candidate hardening

Status: ready-for-agent
State: claimed

## Authorized outcome

The maintainer requested a deep audit of the entire application after its first production run, correction of material defects, verified performance, and coherent reviewed pull requests merged on GitHub. The existing first-release product specification remains authoritative. Routine engineering choices and PR merges are authorized. Physical iPad use is prohibited before 03:00 America/New_York; device ownership must still be coordinated afterwards.

## Acceptance

- Audit all original application source in shared domain, server, mobile/offline, web, and release/operations tooling. Document boundaries rather than claiming a third-party source audit.
- Reproduce material defects and verify fixes at real service, SQLite, component, and browser seams. Preserve operation identity, history, ownership, pending edits, external-effect reconciliation, and private data.
- Measure substantive performance problems before changing them; compare the relevant before/after workload and retain raw evidence.
- Verify supported clean installation, typecheck, lint, formatting, domain/mobile/server tests, all three web browser engines, builds, migrations, restart, generic MCP, and export/restore.
- Review coherent PRs independently for repository standards and the existing product specification; fix material findings and merge only after relevant checks pass.
- Deliver a rendered and visually inspected HTML audit with explicit source/artifact identities and external gates.
- Fresh native and container artifacts require verification after changed source. A passing source suite does not establish physical camera, WHOOP consent, Apple distribution, permanent HTTPS deployment, or optional push delivery.
- Long running build jobs run independently with an infrequent monitor, meaningful-change notifications, verified output, and monitor cancellation when complete.

## Verification boundaries

Fictional isolated PostgreSQL databases and private local fixture credentials are used. Existing user data and unrelated services/devices remain outside fixture work. WHOOP provider fixtures do not count as live consent. The previous physical-device automation failure must be investigated after permitted availability, without claiming a setting state that was not observed.
