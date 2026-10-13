# Triage labels

The five canonical roles map directly to the same strings in this repository's local tracker.

| Role | Local value | Meaning |
| --- | --- | --- |
| needs-triage | needs-triage | A maintainer needs to evaluate the issue. |
| needs-info | needs-info | More information is needed. |
| ready-for-agent | ready-for-agent | The issue is fully specified for an agent to implement. |
| ready-for-human | ready-for-human | The issue requires human implementation. |
| wontfix | wontfix | The issue will not be actioned. |

Use these values in the `Status:` line of ordinary issues. Their separate `State:` field tracks execution. Maps and wayfinding tickets do not carry triage labels; their `Status:` records execution state, as described in [issue-tracker.md](issue-tracker.md).
