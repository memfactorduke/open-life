# Export, backup and recovery

The initial service uses PostgreSQL and private local files. `pg_dump` takes a consistent database snapshot but cannot snapshot the media directory. An online dump plus a separately timed file copy can miss completed attachments. Filesystem snapshots would require host-specific storage and database coordination. This implementation instead uses a short maintenance window and a portable logical dump plus a checksum-verified file tree.

## Operator prerequisites

Run these commands locally as the installation operator using Node 24 and `tsx` from this checkout. Use `pg_dump` and `pg_restore` matching the database server's major version (the verified fixture uses PostgreSQL 16). Set `DATABASE_URL` and `MEDIA_DIRECTORY` through protected operator configuration. Never paste secrets into chat, commit them, or place them in client bundles. Commands use process arguments without a shell; PostgreSQL credentials travel in the child environment rather than command arguments. Database authorization is separate from owner HTTP authorization; there is no remote administrator endpoint or agent backup tool.

The backup and destination parents must be trusted operator directories. Output directories must be new and use mode 0700; contained files use 0600. Symlinks, special files, traversal paths and checksum mismatches fail validation. Retain the auth secret, WHOOP encryption key, WHOOP client configuration, database access configuration and deployment/origin settings separately in protected files. Pass those files as optional backup inputs; supplying one file does **not** establish that every required setting is present. Review the checklist before relying on recovery. Backups contain database credentials/session material and personal records and require protected storage; readable owner exports omit application credentials.

## Compose operator boundary

The supplied `compose.yml` keeps PostgreSQL private on its Compose network, and `MEDIA_DIRECTORY` names a container volume. A host command cannot use `DATABASE_URL=...@database:5432/...` or assume `/var/lib/mems-life/media` is a host directory. The verified commands below run against a local PostgreSQL installation with an operator-visible private media tree (the integration fixture uses `127.0.0.1:55432`). For Compose, run the operator CLI in a dedicated tool container attached to the same Compose network and media volume, with a protected host backup directory bound separately. That container needs this checkout with `tsx` and PostgreSQL 16 client binaries; the current production app image does not contain those operator tools. Providing and verifying this operator image is a packaging gate, not evidence established by the local PostgreSQL fixture. Do not publish the database publicly or copy a live volume without the drain guard to work around it.

## Readable owner export

The authenticated owner can download `/api/export`, a version-1 JSON document with domain records, history, corrections, provenance, timestamps and an attachment manifest. An agent credential cannot access this endpoint. Manifest paths describe the export layout, not arbitrary server paths. Existing authenticated attachment routes supply accessible live bytes; local operator export includes retained attachment bytes and deleted-record history:

```sh
node --import tsx scripts/export.mjs /protected/new-owner-export
```

This creates `records.json` and `attachments/files/` and `attachments/task-files/files/`. Finalized attachment checksums and original names are preserved. Password/account/session tables, WHOOP credential/state tables, grant verifiers and attempt token verifiers are omitted; credential keys are also removed recursively from domain receipts and event payloads. Staged uploads are recovery data, included in backups rather than the readable finalized-attachment export. The export format is not a credential-bearing restore image.

## Coherent backup

```sh
node --import tsx scripts/backup.mjs /protected/new-backup /protected/auth-config /protected/whoop-config
```

The command persists `maintenance=true` first. New guarded mutations reject with HTTP 503; clients retain their edits. The command then acquires the exclusive PostgreSQL advisory guard, waiting for existing shared write/transfer guards to finish. The guard covers transactional writes, auth mutations and staged/finalized file transfers in the single-host service. Every independent future writer or cleanup job must participate; the maintenance flag alone is not a drain mechanism. Migrations acquire the shared guard but may bypass the flag only inside migration dispatch. An installed version-13 schema missing its control table fails closed.

With work drained, the command verifies database attachment references, dumps PostgreSQL (including the closed maintenance state), copies **all** private media including pending uploads and unreferenced bytes, and records checksums and migration versions in `manifest.json`. Protected configuration files are copied into a separate `protected-configuration/` directory. Only after success does it clear maintenance and release the guard. Any failure leaves the persistent flag closed. Repair the cause, then resume explicitly:

```sh
node --import tsx scripts/backup.mjs --resume
```

Run only one operator backup/export/restore operation at a time. Do not run unguarded external SQL writes, manipulate files, or start an older server that predates the guard during maintenance.

## Restore into an independent installation

Create an empty database and choose a new, absent media directory. Configure a separate service while keeping it stopped. Point `DATABASE_URL` and `MEDIA_DIRECTORY` at those new resources, then run:

```sh
node --import tsx scripts/restore.mjs /protected/verified-backup
```

The command rejects a nonempty database. It verifies the dump, complete media manifest and supplied protected configuration checksums; restores the dump in one PostgreSQL transaction; validates media references and migration versions; preserves the original installation ID and owner partition; removes obsolete sync snapshots; and rotates the installation epoch before allowing client mutations. Restore discards restored session-bound notification device registrations and deliveries; fresh notification opt-in/registration is required. Durable attention events and preferences remain. Restore leaves maintenance closed. Supply the protected configuration, start the service, check owner access/readable records and authenticated attachment downloads, apply any supported pending migrations while still closed, then explicitly resume with `backup.mjs --resume`. Run migration dispatch normally; never create an empty replacement schema after a failed migration.

Failure before database restore leaves the target database empty. A restore failure leaves the disposable target closed or empty; keep the original backup intact, diagnose the error, and retry into fresh resources. Failure in a later migration requires its transaction rollback and a fresh independent restore if needed. The command does not replace or delete the original installation.

## Compose operator procedure

Use the same project name and protected installation environment as the live deployment. The following examples assume `installation.env` already supplies `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` and `APP_HOST`. Add absolute `OPERATOR_ARCHIVE_DIRECTORY` and `OPERATOR_CONFIGURATION_DIRECTORY` paths. Create both directories with mode 0700 before Compose runs; put each supplied recovery configuration file in the latter with mode 0600. Use URL-safe randomly generated database passwords, as Compose interpolates them into a PostgreSQL URL. Never print `docker compose config` with these secrets present.

Build the separate maintenance image and run one operation at a time. Choose a new destination name on every run:

```sh
docker compose --env-file /protected/installation.env --profile operator build operator
docker compose --env-file /protected/installation.env run --rm operator scripts/export.mjs /archives/new-owner-export
docker compose --env-file /protected/installation.env run --rm operator scripts/backup.mjs /archives/new-backup /configuration/auth.env /configuration/whoop.env
```

Both archive commands drain guarded writers. A failure keeps maintenance closed; after diagnosing the failure, resume the original explicitly:

```sh
docker compose --env-file /protected/installation.env run --rm operator scripts/backup.mjs --resume
```

For recovery, add a separate random `RESTORE_POSTGRES_PASSWORD` to the protected environment. The restore profile has its own `restore_database` and `restore_media` volumes; it never targets the original database/media volumes. Choose a fresh recovery project name for a new attempt if the previous target was used, while keeping the archive directory pointing to the verified backup. Do not start the original app/proxy in that recovery project. An absent restore password causes database startup to fail.

```sh
docker compose --project-name mems-life-recovery --env-file /protected/installation.env --profile restore build restore-operator
docker compose --project-name mems-life-recovery --env-file /protected/installation.env --profile restore up -d --wait restore-database
docker compose --project-name mems-life-recovery --env-file /protected/installation.env run --rm restore-operator scripts/restore.mjs /archives/new-backup
```

Restore validates the archive and migrations, preserves the installation ID, rotates the epoch and leaves maintenance closed. The new `restored` media directory initially belongs to the privileged operator. Grant ownership to the application UID 1000 only after restore verification; this traverses the independent restore tree and rejects symlinks/special files:

```sh
docker compose --project-name mems-life-recovery --env-file /protected/installation.env run --rm restore-operator --input-type=module -e 'import fs from "node:fs/promises"; async function visit(p){const s=await fs.lstat(p);if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error("Unsafe restored tree");if(s.isDirectory())for(const n of await fs.readdir(p))await visit(p+"/"+n);await fs.chown(p,1000,1000);}await visit(process.env.MEDIA_DIRECTORY);'
```

Supply the complete recovered configuration through a protected recovery environment file before starting the independent application. The Compose examples wire authentication and origin settings; any WHOOP configuration used by the installation must also be supplied to that service. Keep the original service intact while validating the recovery target. Apply supported migrations with maintenance closed, then start only the independent app (no proxy or public port is supplied for it):

```sh
docker compose --project-name mems-life-recovery --env-file /protected/recovery.env run --rm restore-operator apps/server/dist/cli.js migrate
docker compose --project-name mems-life-recovery --env-file /protected/recovery.env --profile restore --profile restore-app up -d --build restore-app
```

Check owner access, readable records and authenticated attachment downloads on an operator-controlled private connection to `restore-app:3001` before switching traffic. Verify the maintenance state remains closed:

```sh
docker compose --project-name mems-life-recovery --env-file /protected/recovery.env exec -T restore-database psql -U mems_life -d mems_life -Atc 'SELECT maintenance FROM portability_control'
```

The expected result is `t`. After those installation-specific checks pass, explicitly resume only the independent recovery target:

```sh
docker compose --project-name mems-life-recovery --env-file /protected/recovery.env run --rm restore-operator scripts/backup.mjs --resume
```

The automated Compose fixture verifies archive/restore mechanics; it does not approve routing traffic, validate personal configuration, or prove a device resnapshot. Traffic promotion and retirement of the original resources require the installation's separate release/recovery checks. Preserve the original and archive until that process is complete. Never use `down --volumes` against the original installation to prepare a recovery target.

## Offline reconciliation and honest recovery limits

The changed epoch tells clients to pause automatic replay and resnapshot while retaining local work. Previously attempted commands whose receipts disappeared need manual review, including uncertain external effects; they cannot safely become never-sent commands. Never-sent ordinary edits may be revalidated against the recovered snapshot. External execution-sensitive operations still require online confirmation. Epoch rotation does not guarantee exactly-once external effects or recover changes after `capturedAt` in the manifest. A command committed after that point may lose both its record and receipt.

Keep backups according to an operator retention policy. Deletion revokes live application access and creates tombstones; older backups and owner exports may still contain deleted content until those archives are deliberately retired. The backup includes pending, received, detached and unknown files. Cleanup must check durable references, staging state and retention policy; it cannot infer deletability from the readable export or remove a pending client's original work. This implementation does not sweep unknown files.

## Verified boundary

`apps/server/test/portability.test.ts` uses independent fictional databases `mems_life_portability_test` and `mems_life_restore_test` plus temporary media. It exercises a real CLI dump/restore, owner export secret omission, histories/receipts/tombstones, lost post-backup records, changed epoch, closed restored maintenance, staged byte preservation and tamper rejection. Native resnapshot/replay behavior has its separate sync engine and native release evidence; this service test alone does not prove device recovery or live provider effects.
