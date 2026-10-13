# Development and private installation

This repository uses one npm workspace with separate domain, service, web and Expo native packages. The service owns PostgreSQL records. Client bundles contain no database or authentication secrets.

## Supported toolchain

Use Node **24.21.0** and npm **11.19.0**, pinned in `.node-version` and `package.json`. On this development Mac both are available under `/opt/homebrew/opt/node@24/bin`. Set the runtime for this shell without changing global configuration.

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
npm run verify:toolchain
npm ci
```

Use a Node version manager with `.node-version` on other hosts. TypeScript 5.9.3 stays within current test/lint peer ranges. Node 26 is a current release rather than the selected LTS. npm workspaces avoids adding another required package manager. Expo 57.0.28 pairs with React 19.2.3 and React Native 0.86.3. Root React/React DOM overrides and direct test-tool pins keep the entire workspace on 19.2.3. The new RNTL test renderer is pinned to 1.2.0 with reconciler 0.33, whose published peer requirement supports React 19.2. Independently upgrading React Native would break the supported Expo pairing.

Verified sources are the [Node release index](https://nodejs.org/dist/index.json), [Expo package registry](https://registry.npmjs.org/expo/latest), the published Expo 57.0.28 `bundledNativeModules.json`, and [Expo's compatibility reference](https://docs.expo.dev/versions/latest/). Search-engine snapshots can lag the authoritative package and documentation endpoints.

## Isolated development database

Install PostgreSQL 16 binaries (`initdb`, `postgres`, `pg_ctl`, `psql`, `createdb`) or use the container definition. The native development helper keeps its own cluster under ignored `.runtime/postgres`; it does not stop or modify another PostgreSQL service. Its default port is **55432** and it listens only on loopback.

```sh
npm run db:start
npm run db:status
export DATABASE_URL=postgresql://mems_life@127.0.0.1:55432/mems_life
export TEST_DATABASE_URL=postgresql://mems_life@127.0.0.1:55432/mems_life_test
```

The helper creates both databases once and safely adopts its existing process on repeated starts. `npm run db:stop` stops only this cluster. `bash scripts/db.sh foreground` starts the same cluster with a directly owned process for test supervision. Set `MEMS_LIFE_PG_PORT` before first initialization to choose another port.

This fixture cluster uses trust authentication for local development. Any local process can access it. Never put personal records in it or expose its port. The deployment database requires a separate password.

## Service setup and checks

Local verification creates `.runtime/development.env` with mode 0600 and a generated persistent secret. Root development and administrator commands load this ignored file through Node's environment-file support. Existing process environment values take precedence. Keep an authentication secret in an operator-owned protected environment file for other installations. Generate a random value of at least 32 characters. Keep the same value through restarts. Never commit it or put it into a mobile/web environment variable. `BETTER_AUTH_URL` defaults to `http://localhost:3001`; `WEB_ORIGIN` defaults to `http://localhost:5173`; `NATIVE_SCHEME` defaults to `memslife`.

```sh
npm run build --workspace @mems-life/domain
npm run db:migrate
npm run bootstrap
npm run dev
```

Bootstrap and recovery are local administrator commands. Bootstrap refuses once the installation has an owner. Recovery uses supported authentication APIs and revokes sessions. Follow the CLI prompts with an owner-chosen identity and password. Public signup is disabled. SMTP is not required.

```sh
npm run recover
npm run typecheck
npm test
npm run build
npm run lint
npm run test:e2e --workspace @mems-life/web
```

`npm run dev` supervises both service and web development processes. Ctrl-C terminates both. Domain compilation precedes production service compilation. Service integration tests must use the isolated test database. Browser automation requires installed Playwright browser binaries. Install those with `npx playwright install chromium firefox webkit` when running the full browser suite.

For Expo, run `npm run start --workspace @mems-life/mobile`. A physical phone cannot use the Mac's loopback URL. It requires an explicitly reachable development endpoint. Coordinate physical-device ownership before testing. Bundle export proves JavaScript compilation; it does not prove native simulator launch, camera permission, signing, or distribution.

## Single-host deployment candidate

`compose.yml` packages PostgreSQL 16, the application, private media storage and Caddy HTTPS. Only Caddy publishes ports. The database and attachment volume remain private. Set `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, and `APP_HOST` in a protected operator-owned environment file before using Compose. The PostgreSQL password embedded in `DATABASE_URL` must be URL-safe or URL-encoded.

```sh
docker compose --env-file /path/to/protected/installation.env build
docker compose --env-file /path/to/protected/installation.env run --rm app npm run db:migrate
docker compose --env-file /path/to/protected/installation.env run --rm app npm run bootstrap
docker compose --env-file /path/to/protected/installation.env up -d
```

An isolated Colima run built the server-only image and passed migration, bootstrap, recovery, web, authentication-boundary, and restart smoke checks. A separate operator image passed actual Compose backup and independent database/media restore. The disposable verification containers were removed. See [the container verification procedure](container.md) to reproduce these checks without changing the global Docker context. Rebuild after the final source freeze. Caddy HTTPS and external connectivity remain separate release checks. No public deployment or DNS setup has occurred. Caddy requires reachable DNS and ports. Its local CA is not automatically trusted by other devices.

## Data safety and recovery

The database volume and private media volume contain installation data. The [backup and restore procedure](backup-restore.md) drains mutations and uploads, backs up PostgreSQL and media together, and protects configuration separately. Restore into an independent installation and verify records and attachment checksums. The restore command rotates its synchronization epoch and keeps maintenance closed until explicit resume. Retained native edits require review before replay. Keep the existing volumes during routine upgrades.

## Third-party notices

Original source is MIT under `LICENSE`. Dependencies retain their own licenses and notices. Run `npm run notices` after a clean install to collect installed package license/notice files into `.runtime/THIRD-PARTY-NOTICES.txt`. Include reviewed notices with distributed artifacts. Inspect every package flagged without a notice or clear license, and review imported assets separately. The generator is an inventory aid, not a legal compliance certification. Do not redistribute operator credentials, user records or fixture database files.

## Dependency audit evidence

The October 13 full workspace audit reported 61 advisories, including 15 moderate and 46 high findings. Each exact final Linux ARM64 application and operator image inventory contained 212 npm packages and returned no matching npm registry advisories. The refreshed images use stable captured production source, with actual private task-file history, restart, backup and restore checks recorded in `.scratch/mems-life-v1/evidence/final-history-container/verification.json`. These scopes differ: the image inventory excludes development/native app packages, and the npm check excludes operating-system and bundled native-library vulnerabilities. License validation counted 1,143 hashed files and 390 source references; it is an inventory check, not proof of complete source provenance or legal compliance. Native-library source provenance remains a distribution gate. Several automatic fixes replace the supported Expo/Jest/React Native pairing. Do not run `npm audit fix --force`. Repeat the inventory audit when distributed artifacts change and review third-party notices before distribution.
