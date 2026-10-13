# External MCP access

Mem's Life exposes one exact endpoint, `/mcp`, through the shared application service. The first supported connection mode is a manually configured bearer credential in an HTTP header. This is not automatic OAuth discovery or consent, and does not establish compatibility with any named agent runtime.

The transport uses the official TypeScript SDK's Streamable HTTP implementation, currently pinned to `@modelcontextprotocol/sdk` 1.32.1. This maintenance line supports protocol versions through 2025-11-25. The endpoint is stateless and uses JSON responses; POST is supported, persistent SSE subscriptions and GET/DELETE sessions are not. Each request authenticates its credential. Tools recheck authorization on invocation, and mutations recheck it inside the same locked installation transaction used by UI operations. Revoke returns only after earlier authorized mutations have committed; subsequent calls cannot use that grant.

## Owner grant management

The signed-in owner can list grants with `GET /api/agent-grants`, issue one using `POST /api/agent-grants`, and revoke using `POST /api/agent-grants/revoke`. These endpoints retain the trusted-origin and owner-session checks. A grant cannot access them, account bootstrap/recovery, or connection secrets.

Issue payload: `{ operationId, label, scopes, expiresAt }`. Use UUID operation identifiers, a descriptive label of at most 100 characters, and an ISO expiry within the next year. A new response includes `grant` and `secret`. Copy the secret immediately to the client's private credential configuration. Only a SHA-256 verifier of the random 256-bit secret is stored. Grant identity, label, scopes and expiry may appear in audit records; secrets never do.

Issuance deliberately does not put the secret in a durable operation receipt. Retrying the same issuance operation returns `GRANT_SECRET_ALREADY_ISSUED`, never the secret. If the first response is lost, list and revoke that grant, then issue a replacement with a new operation ID. This is an explicit one-time-delivery limitation; the service does not claim recoverable secret issuance. Revocation payload is `{ operationId, grantId }` and repeated revocation remains safe.

## Client example

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({ name: 'your-watcher', version: '1.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL('https://your-private-host/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.MEMS_LIFE_AGENT_SECRET}` } },
  }),
);
const tools = await client.listTools();
```

Use operator-managed HTTPS outside loopback. A client must support configured headers. Do not put the key in the URL, log it, or add an untrusted browser Origin. Cookie sessions are not accepted as MCP credentials. Ordinary trusted-origin UI requests keep their existing protections; only the exact authenticated MCP endpoint permits a missing Origin header.

## Scopes and records

| Scope             | Allowed operations                                         |
| ----------------- | ---------------------------------------------------------- |
| `tasks:read`      | Task and history reads, associated organization/step reads |
| `tasks:write`     | Validated task and organization/step commands              |
| `workouts:read`   | Exercise, routine, session and history reads               |
| `workouts:plan`   | Exercise and routine planning commands                     |
| `workouts:record` | Explicitly reported/imported actual session commands       |
| `food:read`       | Food diary/history and authorized photo reads              |
| `food:write`      | Explicitly reported/imported food commands                 |
| `food:attach`     | Bounded photo allocation, byte upload and finalization     |
| `whoop:read`      | Non-secret connected observations, when enabled            |

Tool discovery includes only tools within the credential's scopes. Strict named schemas reject unknown fields, owner identifiers, arbitrary paths and unbounded parameters. Commands reuse stable operation IDs and expected entity revisions; unchanged retries return the saved result and stale edits return `REVISION_CONFLICT`. Record ownership always comes from the authenticated grant, never tool parameters. Actual workout and food command envelopes contain `{ command, source: { kind: 'reported' | 'imported', reference, reportedAt } }`; source attribution is persisted transactionally and changing it on retry is rejected. Planning commands cannot turn a plan into an invented performance result.

Photos use the same private media service as UI uploads: allocate for an owned entry with declared checksum and byte size, upload bounded base64 bytes, then finalize against the current entry revision. No storage paths, external source URLs, or credentials are exposed. MIME signatures, checksum, decoding and image limits still apply. Full-size base64 uploads are capped at the existing 8 MiB photo limit; this is a deliberate bounded MCP workflow rather than arbitrary filesystem access.

## Verification boundaries

`apps/server/test/mcp.test.ts` uses the real SDK client against a listening local server and isolated PostgreSQL database `mems_life_mcp_test`, with fictional records. It exercises initialization, tools/list, tool calls, grant scope separation, shared persisted records, revision/retry behavior, attribution, foreign-owner denial and expiry/revocation. Local protocol and database proof does not establish an externally reachable HTTPS deployment or physical phone display; release verification records those gates separately.

Official references: [SDK repository](https://github.com/modelcontextprotocol/typescript-sdk), [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [SDK package](https://www.npmjs.com/package/@modelcontextprotocol/sdk).
