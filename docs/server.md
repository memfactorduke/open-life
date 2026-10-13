# Private installation service

The service uses Fastify, PostgreSQL, and Better Auth. One host administrator creates one installation owner. Public signup, public password recovery, and HTTP administrator operations are disabled. No email delivery service is required.

## Configuration

Use the repository's pinned Node and npm versions. Build the domain workspace before starting the server. Set `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), `BETTER_AUTH_URL`, and `WEB_ORIGIN` in an operator-owned environment file. Retain the auth secret across restarts. Production requires an HTTPS auth URL. `HOST` defaults to `127.0.0.1`, and `PORT` defaults to `3001`. Containers use `HOST=0.0.0.0`.

For local web development, `BETTER_AUTH_URL=http://localhost:3001` and `WEB_ORIGIN=http://localhost:5173`. `NATIVE_SCHEME=memslife` allows the explicit `memslife://` native origin. Arbitrary origins, wildcard native origins, missing origins on mutations, and cross-site browser requests are rejected. A physical phone needs a reachable endpoint and trusted HTTPS.

## First run

```sh
npm run migrate --workspace @mems-life/server
npm run bootstrap --workspace @mems-life/server
npm run dev --workspace @mems-life/server
```

The bootstrap command asks for an email, display name, and hidden password. The password must contain 12 to 128 characters. A second bootstrap refuses without changing the existing owner. For scripted fictional fixtures, set `OWNER_EMAIL` and `OWNER_NAME` and supply exactly one password line on standard input. Never put the password in command arguments or a committed environment file.

## Recovery and revocation

```sh
npm run recover --workspace @mems-life/server
```

Recovery reads a hidden replacement password. It invokes Better Auth's documented request/reset APIs on a local-only auth instance, captures the one-time token in memory, and revokes all human sessions. The public auth instance has no recovery callback. Recovery does not email or print a token. Agent credential revocation will be added with the separately scoped agent-grant implementation.

Bootstrap and recovery use a dedicated PostgreSQL connection inside one transaction. The supported Kysely dialect routes all Better Auth writes to that connection. The host administrator advisory lock serializes setup and recovery. The installation row lock also serializes recovery with application writes. A failure rolls back credentials, installation records, and administrator audit events together.

## HTTP contract

`GET /api/health` verifies database availability. `GET /api/me` returns the authenticated owner's user and installation ID. `GET /api/preferences` returns `{revision,value}`. `PUT /api/preferences` accepts the shared strict `PreferencesCommandSchema`.

Browser sessions use HttpOnly cookies. Better Auth chooses secure cookies in production. The official Expo server plugin is enabled without origin overrides. For auth requests only, the service translates an exact configured `expo-origin` to the trusted native Origin when Origin is absent. Conflicting or arbitrary origins are rejected. Native clients use its SecureStore integration and forward the auth session cookie together with the configured native origin for application writes. Session cookie caching is disabled so revocation is checked against PostgreSQL.

The public `/api/auth/*` surface exposes only sign-in, sign-out, session inspection/revocation, and authenticated password change. Better Auth responses preserve the library's client protocol. Application errors use `{error:{code,message,details?}}`. Credentials and request bodies are not logged.

Preferences commands authenticate and authorize before receipt lookup. An owner row lock serializes writes. The same actor, operation ID, and JSON-equivalent command returns the original response. Changed content under the same ID is rejected. A fresh stale revision is rejected. Preferences, receipt, audit event, and change-feed entry commit together. The owner feed position advances in that transaction, so concurrent commits cannot make an older change appear after a newer cursor. Installation epochs support the later restore/resnapshot implementation.

The foundation stores normalized ownership, revisions, operation metadata, and event positions. JSON is limited to validated preference values, commands, and immutable response/event snapshots. New domain records require their own schemas and application operations.

## Verification

```sh
npm run build --workspace @mems-life/domain
npm run typecheck --workspace @mems-life/server
TEST_DATABASE_URL=postgresql://mems_life@127.0.0.1:55432/mems_life_test npm run test --workspace @mems-life/server
```

The integration test intentionally rebuilds `public` only in the isolated database named `mems_life_test`. It uses fictional identities and the real PostgreSQL/auth/HTTP path. It covers repeated migrations and bootstrap, browser and native origins, cross-account denial, signup/recovery endpoint denial, missing/cross-site origins, revision and receipt conflicts, competing writes, audit/feed deduplication, server restart persistence, recovery, session revocation, expiration, secure production cookie attributes, and rollback after an injected PostgreSQL audit-write failure. Native cookie acceptance in this server test is not proof of physical-device SecureStore behavior or signed release delivery.

Programmatic auth migrations use Better Auth's supported `getMigrations(auth.options).runMigrations()`. Application schema versions are recorded in `application_migrations`. Subsequent schema changes must introduce a new numbered migration instead of editing the deployed baseline.

Sources checked during implementation include the official [Fastify integration](https://better-auth.com/docs/integrations/fastify), [programmatic migrations](https://better-auth.com/docs/concepts/database), [admin creation API](https://better-auth.com/docs/plugins/admin), [email/password recovery](https://better-auth.com/docs/authentication/email-password), and [Expo integration](https://better-auth.com/docs/integrations/expo). The installed 1.7.7 source was also inspected to verify server-only creation, reset-token delivery, and session revocation.

## Implementation verification receipt

On 2026-10-12, the pinned Node 24.21.0 runtime built the domain and server workspaces. `npm run build --workspace @mems-life/server` passed. The isolated PostgreSQL 16 suite passed both administrator CLI and authentication/transaction tests with zero skips. The real development database migrated and provisioned the fictional owner through the documented CLI. Browser/native client journey and device/signing verification are recorded by their own client checks; this receipt does not assert those gates passed.
