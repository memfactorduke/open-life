# Release evidence retention

Release evidence uses an explicit reviewed list in `scripts/release-evidence.mjs`.
Run it with Node 24 to build `.scratch/mems-life-v1/evidence/release-safe/index.html`
and its manifest, then run `node scripts/release-evidence.mjs --validate` before
staging. Neither command stages, deletes or publishes anything. The validator
examines Git's tracked and unignored candidate files independently of the builder,
checks targeted secret formats, bounds individual files to 15 MiB, text scans to
2 MiB and the whole candidate to 100 MiB, and verifies copied evidence hashes.
It prints paths, rule names and counts, never matched credential values.

Raw evidence stays local and ignored. This includes simulator/Maestro logs,
Playwright traces/networks, request results, hierarchy captures and archives.
These may contain active local fixture session cookies, even though the records
are fictional. No deletion is required. The original food web HTML index and
other raw pages remain local-only: their relative links depend on this private
output tree. The release index links only to reviewed copies, so its public links
do not depend on excluded raw files.

The manifest records each original path, byte count and SHA-256 without copying
raw credentials. Original paths are provenance strings, not public download links.
Reviewed receipts preserve their source-hash and historical scope limitations;
references inside their JSON to logs, command output or runtime files are local-only.
An old receipt is not proof that a later source revision or rebuilt image passed.
Final verification receipts should be added to the exact list after content review,
and screenshots after inspecting pixels for personal records or credentials.
The initial retained screenshots contain fictional fixture records; example.test
addresses and fixture actor identifiers are not production identities.

The scanner does not certify every unusual secret format or screenshot pixel.
Source variable interpolation in credential URLs is allowed; substituted literal
credentials in generated output are rejected. One exact negative URL-normalization
test with a fictional password is allowed only in its named test file. New findings
require review; do not disable a rule or allow a whole output directory to silence it.

Keep reproducibility source in normal source/script directories. The existing
production-web fixture, compatibility script and Playwright config are explicit
exceptions under `/evidence`; their generated results remain excluded. Avoid
`git add -f` for raw evidence. After staging, check `git diff --cached --stat` and
run a staged-content secret scan as an additional gate. Ignore rules cannot remove
raw files already in the index; the candidate validator includes tracked files to
catch this case.

After reviewing a new JSON receipt, add its exact repository-relative path with
`node scripts/release-evidence.mjs --receipt PATH.json`. Repeat `--receipt` for
each reviewed file; pass the same explicit additions when rebuilding this pack.
This accepts individual JSON files only and does not copy folders or screenshots.
The privacy and size checks still apply. The manifest preserves raw hashes,
runtime versions and reported limitations; only this workstation root prefix is
removed from the copied JSON. Generated `.scratch/timezone-proof/` and
`apps/*/evidence/` trees stay local; `apps/web/e2e/` remains application test source.

The production-web verification receipt predates the later timezone change and
source formatting. It proves its recorded historical hashes and tests, not the
current frozen tree. The old native gym/food receipt describes its immutable
Release, includes the failed safe-area gate and open device checks, and does not
prove later offline or other native code. Final Docker and native verification
remain separate receipts and must be reviewed explicitly before copying.
