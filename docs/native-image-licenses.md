# Native image licenses and source delivery

The verified Linux ARM64 image uses `sharp` with
`@img/sharp-libvips-linux-arm64@1.3.4` (libvips 8.18.7). The project's MIT
license applies to its original source. The native package declares
LGPL-3.0-or-later and its README lists 29 libraries under several licenses.
Removing sharp would discard the existing native image validation/encoding
path; retaining it with explicit notices and source evidence preserves that
behavior. This work does not change the package manifest or lock.

The previous generator scanned only top-level LICENSE/COPYING/NOTICE filenames
and omitted this package's README. The current generator includes its entire
published README, checks every component version against the pinned upstream
v1.3.4 build provenance, and copies a reviewed bundle into both runtime and
operator images at `/app/native-licenses`. This directory contains LGPLv3 and
GPLv3 terms, all recursively discovered upstream component notice texts,
FreeType FTL, AOM patent terms, libnsgif's nested COPYING, original librsvg
Cargo.lock and registry-crate notices, source URLs/checksums, the five build
patches, and upstream build scripts/configuration.

## Verify the actual image

After building the image, run:

```sh
docker run --rm mems-life:verify node native-licenses/verify.mjs /app
docker run --rm --entrypoint node mems-life:operator-verify native-licenses/verify.mjs /app
```

The validator checks exact installed package/license/component versions, all
1,143 bundle file hashes, preservation of the 29-entry published README in the
image's main notice file, key nested/supplemental license files, and the 390
archive references. It validates notice integrity; it does not declare legal
compliance or complete original-binary reproduction.

For a local development install, generate and validate notices with:

```sh
npm run notices
node scripts/native-license-verify.mjs .runtime .
```

## Separate source artifact

Collect or verify corresponding source evidence without downloading binaries:

```sh
node scripts/native-license-sources.mjs
```

The collector verifies SHA-256 for all 28 upstream component archives, five
upstream patches, and 357 crates from the original librsvg release lock. A
missing or changed upstream download fails the check. The verified directory
is `.runtime/native-license-sources`, which is ignored and excluded from the
Docker build context. It also contains copies of the notice/build-provenance
bundle and collector. Create an inspectable delivery archive with:

```sh
tar -cf .runtime/sharp-libvips-1.3.4-source-provision.tar -C .runtime/native-license-sources .
shasum -a 256 .runtime/sharp-libvips-1.3.4-source-provision.tar
```

`SOURCE-PROVISION.json` records manifest identities. Source archives are kept
separately to avoid adding roughly 200 MB to every application image. Deliver
those verified sources alongside the image when distributing; retaining them
locally or linking to upstream is not proof that recipients have access. No
public release or source hosting occurred during these checks.

## Remaining release gate

The published build recipe removes some librsvg features and runs
`cargo update --workspace`. [Cargo's documented behavior](https://doc.rust-lang.org/cargo/commands/cargo-update.html)
retains other locked packages unless absent from the lock. All original locked
registry sources are retained as a conservative superset. The actual resulting
upstream build lock has not been retrieved, so absence of added dependencies is
not verified. The recipe also uses a mutable Rocky Linux base and nightly Rust,
cargo-c, Meson and Ninja versions. Obtain the actual upstream build lock and
build provenance, or verify an equivalent rebuild, before declaring exact
corresponding-source coverage complete for external redistribution. This is a
source-provenance barrier; successful application/runtime tests do not close it.

Primary evidence: [v1.3.4 release and component versions](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4),
[pinned packaging source](https://github.com/lovell/sharp-libvips/tree/ebb95f8add54eee8bed840e3fb587e4cbec857d7),
[sharp installation and system-libvips options](https://sharp.pixelplumbing.com/install/),
and [GNU LGPLv3 terms](https://www.gnu.org/licenses/lgpl-3.0.html). The collector
and notice validator provide engineering evidence rather than legal certification.
