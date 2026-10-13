# Verify the production container

The image runs the compiled service and administrator CLI, the compiled domain package, and the web distribution. It installs the server's production dependencies from the committed npm lock. It runs as the `node` user, with writable media storage at `/var/lib/mems-life/media`.

## Build and exercise the image

Use the supported Node 24.21.0 and npm 11.19.0 toolchain. A running Docker daemon is required. The check uses Docker directly and does not require Compose.

```sh
node scripts/container-verify.mjs
```

The check builds `mems-life:verify`, validates the runtime files and imports, and starts disposable PostgreSQL and application containers. It runs migration, bootstrap with a fictional identity, and password recovery before starting the service. It checks database-backed health, web HTML and JavaScript, the unauthenticated access boundary, signed-in photo and task-file transfers, and preference/media/database persistence after restarting both containers. It imports the MCP SDK and exercises sharp image encoding and decoding. It prints the actual applied migration versions, lock hash, and image identity. The application binds only to a random loopback port. The check removes its own containers, anonymous database volume, named media fixture volume, and network in a `finally` block. It leaves the image and build cache for inspection.

To verify an existing image without rebuilding it, run the following command. The image must match the current lock file. The lock check verifies dependencies; it does not establish that compiled application code matches the current checkout. Record the image identity and build-source hashes, and rebuild after source changes or the final release freeze.

```sh
CONTAINER_VERIFY_IMAGE=mems-life:verify node scripts/container-verify.mjs --skip-build
```

Set `DOCKER_HOST` or `DOCKER_CONTEXT` to select an existing daemon. The script does not switch the global Docker context. An interrupted process can leave resources whose names start with `mems-life-verify-`; inspect those names before removing them.

## Isolated macOS verification runtime

This recipe creates its own profile without activating it or starting the default profile:

```sh
colima start mems-life-verify --activate=false --cpu 4 --memory 6 --disk 30
mkdir -p .runtime/container-docker-config
printf '%s\n' '{"auths":{}}' > .runtime/container-docker-config/config.json
PATH=/opt/homebrew/opt/node@24/bin:$PATH \
DOCKER_HOST=unix://$HOME/.colima/mems-life-verify/docker.sock \
DOCKER_CONFIG=$PWD/.runtime/container-docker-config \
node scripts/container-verify.mjs
```

The temporary Docker configuration avoids an unavailable Docker Desktop credential helper. It contains no credentials. Keep this isolated profile available while another verification pass needs its image/cache; once no further pass is needed, stop only this profile with `colima stop mems-life-verify`. No public ports, DNS, or account configuration are required.

## Use compiled administrator commands

The image replaces only its copied root package scripts with compiled CLI commands. The repository's manifests and lock file remain unchanged. Existing deployment commands continue to work without a TypeScript runner.

```sh
docker compose --env-file /path/to/protected/installation.env run --rm app npm run db:migrate
docker compose --env-file /path/to/protected/installation.env run --rm app npm run bootstrap
docker compose --env-file /path/to/protected/installation.env run --rm app npm run recover
```

These commands require a working Compose plugin and the private database service. See [development and private installation](development.md) for operator configuration and deployment requirements.

## Packaging choices

The Node base image is pinned by version and manifest digest. The build checks Node and npm versions before installation. `npm ci` preserves the committed dependency versions and integrity checks. Changing the base image requires an intentional digest update and a new verification run.

A separate dependency stage copies only the root, server, and domain manifests with the unchanged lock. It runs `npm ci --workspace @mems-life/server --omit=dev --omit=optional --ignore-scripts`. Omitting optional dependencies excludes BetterAuth's optional React and Expo client peers. The server entry of `@better-auth/expo` uses BetterAuth APIs without importing Expo native packages. The image build and verification command import that entry directly.

Sharp's optional packages are essential runtime binaries, so omission alone is insufficient. The full build-stage `npm ci` installs and integrity-checks the matching Linux binary and libvips package from the same lock. A build step checks their exact locked versions, Linux CPU and glibc metadata, and copies just those two packages into a staging directory. The runtime dependency stage receives that directory. It retains no other optional application peers. The selection uses the build process architecture; the tested target is Linux ARM64, and other targets require their own verification. See [sharp's installation requirements](https://sharp.pixelplumbing.com/install/).

The runtime excludes handwritten application source, native workspaces, test suites, development scripts, TypeScript, test runners, and Expo. Only package manifests, compiled distributions, production dependencies, the license, and dependency notices enter the final image. The notices inventory includes build dependencies as well as runtime dependencies. It retains the existing license review requirement.

Both runtime and operator images also carry `/app/native-licenses`, with the exact libvips licensing matrix, component license texts, source manifests, patches, and upstream build configuration. Run the [native license validator and source collector](native-image-licenses.md) before distributing an image. Source archives are a separate local release artifact; the remaining original-build provenance gate is documented there.

Installing all optional dependencies would include Expo and React Native peers; globally omitting them breaks sharp. A second `npm install` could resolve different versions or change the lock. Reusing only the already verified platform packages avoids both outcomes and preserves native library licenses.

A service bundle could remove unused exports from some dependencies. It would also add a bundler and require separate checks for BetterAuth's migration imports, package exports, and PostgreSQL dependency resolution. The workspace installation uses npm's existing lock graph and package resolution. This choice keeps the runtime inspectable without another dependency transformation.

## Isolated Compose maintenance tools

The default service image remains minimal. The `operator` target instead starts from the official PostgreSQL 16.14 Bookworm image pinned to its registry digest, retaining `pg_dump`, `pg_restore` and their complete shared-library closure. It copies the verified Node 24.21.0 binary from the pinned matching Bookworm Node image and reuses the locked server production dependencies. The three portability scripts are copied with imports rewritten to compiled server modules. No TypeScript runner, handwritten source, Expo, React Native, browser tests or test runner enters the operator image. Build-time imports prove Node's library compatibility; the Compose verification exercises both PostgreSQL tools.

Adding PostgreSQL clients to the application would grow the always-running image and its privileges. Bookworm's default PostgreSQL 15 client cannot dump the PostgreSQL 16 service. Copying only PostgreSQL executables would omit libraries. Using the official PostgreSQL image as a separate maintenance target retains its verified packaging without an external package repository, lock changes or a runtime-specific agent adapter. The operator retains the image's OS/package licensing material and the application dependency notices.

`operator`, `restore-database`, `restore-operator` and `restore-app` are disabled by default through Compose profiles. Operator services replace PostgreSQL's entrypoint with Node and default to `--help`; they start no database or application daemon and expose no port. They intentionally run as the privileged installation operator to read service-owned private media and write protected host archives. Treat access to this profile, Docker, the database environment and archive directories as administrator access. No HTTP or MCP maintenance endpoint is added.

Set absolute `OPERATOR_ARCHIVE_DIRECTORY` and `OPERATOR_CONFIGURATION_DIRECTORY` paths in the protected installation environment. Create those directories yourself with mode 0700 and configuration files with mode 0600. Compose mounts the configuration read-only. The live operator joins the private Compose network and mounts the live media volume; the restore operator instead uses a separate database and separate media volume and reads the archive mount read-only. Follow the exact procedure in [backup and recovery](backup-restore.md#compose-operator-procedure).

```sh
node scripts/container-operator-verify.mjs
```

The check uses the current Compose file under a random project name with protected fictional configuration. It validates Node/PostgreSQL versions and dependency exclusions, migrates and bootstraps a fictional owner, creates a finalized task attachment and pending private bytes, then runs the actual readable export, coherent backup and independent restore CLIs. It checks archive permissions, dump checksum, protected configuration, migration versions, unchanged original identity/epoch, rotated restored epoch, restored closed maintenance, attachment/pending bytes, rejection of a second restore and explicit resume. It removes only its own project containers, network, volumes and temporary fixture files in `finally`. It leaves the operator image/cache. Set `CONTAINER_OPERATOR_VERIFY_IMAGE` and pass `--skip-build` to exercise an existing image; rebuild after source changes.

A working Docker Compose plugin is required in addition to Docker. With Homebrew's standalone `docker-compose`, make it visible only to the isolated verification configuration:

```sh
mkdir -p .runtime/container-docker-config/cli-plugins
ln -sf /opt/homebrew/bin/docker-compose .runtime/container-docker-config/cli-plugins/docker-compose
PATH=/opt/homebrew/opt/node@24/bin:$PATH \
DOCKER_HOST=unix://$HOME/.colima/mems-life-verify/docker.sock \
DOCKER_CONFIG=$PWD/.runtime/container-docker-config \
node scripts/container-operator-verify.mjs
```

## Verification limits

The disposable check covers application packaging on the daemon's architecture. It does not prove Caddy HTTPS, DNS, personal-data restore, mobile connectivity, signing, or behavior on another CPU architecture. Production readiness still requires those installation-specific checks and dependency review. The check uses generated fixture secrets and never reads an operator environment file.
