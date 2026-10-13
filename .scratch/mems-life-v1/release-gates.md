# First release external verification gates

Live account and distribution gates remain pending. Optional remote push is deferred for the local release candidate and stays disabled by default. Implementation, fixtures, simulator checks, and provider adapter tests do not prove live connections or distribution. Keep credentials and personal records out of the evidence.

| Gate | Status | Required proof |
| --- | --- | --- |
| Real WHOOP OAuth | pending | Authorized consent against the real provider, validated callback/state handling, retrieval under granted scopes, refresh and revoked-consent behavior. Record environment, date, command or journey, and redacted observed results. |
| Signed Apple distribution | pending | Selected Apple distribution path, appropriate signing identity/provisioning, successful signed build, installation and launch through that path. Record artifact identity and toolchain. A simulator build is separate evidence. |
| Physical iPhone and iPad | pending | Coordinate device ownership with other agents before use. Record device/OS, ownership agreement, installation, real camera/media capture and interruption recovery. Include compact/wide iPad behavior. Do not expose device identifiers unnecessarily. |
| Remote HTTPS and MCP | pending | Authorized deployment with valid HTTPS reachable from an independent client, authenticated MCP discovery and an owner-scoped task/workout/food round trip. Record endpoint identity, redacted results and rejection of absent, expired and unrelated credentials. Localhost does not satisfy this gate. |
| Optional push delivery | deferred locally; pending if enabled | If enabled, authorized provider configuration, device permission, real foreground/background delivery, deep link, opt-out and duplicate suppression. Record device/OS and observed delivery. If deferred, record the decision explicitly; local notification or fixture evidence does not establish remote push. |

## Ticket evidence convention

Run `node scripts/release-status.mjs` for a concise dependency report or add `--json` for ticket criteria, comments, and evidence. It validates IDs 01 through 29 and dependency cycles. Open work exits successfully; malformed tracker data fails.

Record evidence inside each ticket's Comments section. A plain `Evidence: <observed result and artifact or command>` line is accepted. For structured evidence, use this optional format with actual results only.

```html
<!-- release-evidence {"command":"the actual command or journey","environment":"the actual environment","result":"the observed result","artifact":"a real path or reference","date":"the actual verification date"} -->
```

The tool reports recorded evidence without executing commands or trusting their results. Its `verifiedComplete` flag requires State resolved, every acceptance checkbox checked, and at least one evidence record. This is a bookkeeping qualification, not independent verification of the attached proof. A status alone or an unchecked criterion never establishes completion. Unqualified resolved dependencies remain blocked. Review the actual evidence before release.
