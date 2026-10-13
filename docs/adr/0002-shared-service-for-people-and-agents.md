---
status: accepted
date: 2026-10-12
---

# One application service for clients and agents

Use PostgreSQL as the authoritative shared datastore, with one application service enforcing the product's operations. The web/mobile API and the Mem's Life MCP server call those same operations. A tool used by an agent must enforce the same ownership, validation, and history rules as an action in the app.

Multiple personal devices and external agents need shared committed state. A server makes that boundary explicit without tying the product to one commercial hosting provider. Keep schema migrations, configuration, and deployment instructions usable for an independent installation. Mobile local storage supports selected offline workflows; it is not a second uncoordinated source of truth.

## Alternatives considered

- **SQLite behind an application server:** viable for a small installation and simpler to operate. SQLite does not by itself replicate data between personal devices. PostgreSQL is chosen for the shared service's transactional and operational model, not because SQLite cannot serve multiple clients.
- **A replication service from the outset:** may reduce later synchronization work, but adds another runtime dependency before the precise offline requirements are settled. Start with explicit operations, cached reads, and a bounded durable upload queue where needed. Revisit replication against measured requirements.
- **Separate writes for MCP and the user interface:** initially convenient, but risks different rules and histories. Keep adapters thin and domain operations shared.

## Operation boundary

Use stable operation identifiers for safe retries and entity revisions for edits. Reject stale edits with an explicit conflict rather than silently replacing newer state. Record actor identity and the resulting change. Undo, when supported, is a validated new operation, not unrestricted rollback over later changes.

Expose product operations through MCP rather than arbitrary SQL or infrastructure-administration tools. Remote MCP uses authenticated HTTP with permissions granted per client. Follow the current protocol's authorization and discovery requirements, and test actual target clients before claiming compatibility. Choose detailed grants and synchronization behavior within the product brief's working defaults; do not require selection of a particular agent runtime before building.

The completed planning research selects manually configured, scoped agent credentials for the first HTTP transport, tested with a header-capable generic MCP client. This is an explicit compatibility mode, not standardized OAuth interoperability. Do not advertise automatic OAuth discovery or consent until that adapter is implemented and verified for a chosen client. See the [access decision](../../.scratch/mems-life-wayfinding/issues/01-portable-access-and-deployment.md).

Do not equate live change notifications with durable synchronization. A reconnecting client must be able to retrieve missed committed changes. Display pending local changes honestly; a remote agent cannot see data that has not left an offline device.

## Sources checked

- [SQLite deployment guidance and concurrency](https://www.sqlite.org/whentouse.html)
- [MCP authorization specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP transport specification, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Expo local persistence](https://docs.expo.dev/versions/latest/sdk/sqlite/)
