# Native image library notices and source provision

The application includes sharp's dynamically loaded, unmodified prebuilt library
package `@img/sharp-libvips-linux-arm64@1.3.4` on the verified Linux ARM64 target.
Other targets must be verified separately. Original Mem's Life application code
is MIT; this does not change the native libraries' own terms. The package's
README licensing matrix is retained in `/app/THIRD-PARTY-NOTICES.txt`.

`components/` preserves license, copying, copyright and notice files extracted
from the exact source archive URLs used by the upstream v1.3.4 build scripts.
`rust/` preserves notices and package manifests for the complete original
librsvg 2.63.2 Cargo.lock, a conservative superset including disabled features,
test and other-platform dependencies. It is not a claim that every listed crate
is linked in the Linux library. The LGPLv3 supplemental terms and GPLv3 text
are included together. The aom patent terms and FreeType FTL are included with
their component notices. The upstream licensing matrix has 29 entries; the
source release records 28 components because libnsgif is bundled inside the
libvips source archive; its nested COPYING is preserved. proxy-libintl is
platform conditional.

`build-provenance/` is the unmodified upstream packaging repository at signed
tag v1.3.4, commit ebb95f8add54eee8bed840e3fb587e4cbec857d7. It includes the
Linux ARM64 build image recipe, flags, configuration, and source modifications.
`patches/` preserves each fetched patch. `sources.json` records the upstream
source URL and locally verified SHA-256 of every archive/patch; `rust-crates.json`
uses each original Cargo.lock registry checksum. `bundle.json` binds the
installed versions.json to all bundled notice/provenance file hashes.

To collect and verify the separate source artifact from a project checkout:

    node scripts/native-license-sources.mjs

The default directory is `.runtime/native-license-sources`. Keep the resulting
source archives together with this notice/provenance directory and the source
fetching script when distributing an image. If a download disappears or changes,
the collector fails; retain the already verified copies. The local validation
record `SOURCE-PROVISION.json` identifies the manifests; it is not an offer to
supply sources in the future or a public source host. No public distribution or
source hosting has been performed. Before external distribution, make those
source copies available with the binary delivery and review that delivery's
license requirements. A pointer to upstream alone is not the project’s chosen
source delivery method.

Limits: upstream runs `cargo update --workspace` after removing GIF/WebP and
Cairo PDF/PostScript features. Cargo documents that other packages remain locked
unless absent from the original lock; the preserved lock and all its registry
archives cover that original dependency set. The actual post-edit build lock
has not been published/verified, and the upstream Linux recipe uses mutable
base image, nightly Rust, cargo-c, Meson and Ninja versions. Original binary
reproducibility and absence of extra post-edit registry dependencies are not
certified. Obtain upstream build provenance/actual lock or verify an equivalent
source rebuild before declaring corresponding-source coverage complete for
external redistribution. These files provide evidence, not legal certification.

Users may replace the shared libvips library in the installed @img package or
build sharp against an appropriate system libvips following sharp's installation
documentation. Mem's Life adds no restriction on modifying these LGPL libraries
or reverse engineering to debug those modifications. No modified libvips binary
is distributed by this project.

Primary references:
- https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4
- https://github.com/lovell/sharp-libvips/tree/ebb95f8add54eee8bed840e3fb587e4cbec857d7
- https://doc.rust-lang.org/cargo/commands/cargo-update.html
- https://sharp.pixelplumbing.com/install/
- https://www.gnu.org/licenses/lgpl-3.0.html
