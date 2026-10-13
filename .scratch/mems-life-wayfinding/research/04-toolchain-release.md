# Supported toolchain and release evidence

Checked 2026-10-12. Planning evidence only; no dependencies installed, app built, device controlled, account connected, or license file changed.

## Decision

Use stable Expo SDK 57 with its supported React Native and React versions, Node 24 LTS, and npm workspaces with a committed lockfile. Keep separate native and web presentation packages and shared TypeScript operations. Pin the exact Node patch and npm version when scaffolding; use clean lockfile installs in CI. Re-check stable releases at scaffolding rather than treating this dated note as evergreen.

| Compatibility item | Verified baseline |
| --- | --- |
| Expo | Stable SDK 57; use a current stable 57 patch, at least 57.0.23 for the installed Xcode 27 path |
| React Native | SDK 57 targets 0.86; 57.0.17 updated it to 0.86.3 |
| React | 19.2.3 |
| React Native Web | 0.21.0 if needed; the separate React web UI need not use it |
| Node floor | 22.13.x; choose maintained 24 LTS rather than the minimum |
| Apple target | iOS 16.4+; Expo minimum Xcode 26.4+ |

The [Expo compatibility table](https://docs.expo.dev/versions/latest/) owns these framework pairings. The [SDK 57 release notes](https://expo.dev/changelog/sdk-57) document fixes in 57.0.17 and the Xcode 27 requirement: enable scene lifecycle support using `expo-build-properties` `ios.enableSceneSupport` with Expo 57.0.23 or later. Make launch on iOS 27 a release check; successful iOS 26.5 simulator execution alone cannot cover it.

Choose 57 over 56 because it is stable and contains the newer supported RN line and fixes. Do not adopt SDK 58 beta, canary packages, independent latest RN, or an untested React override. Verify the [official changelog](https://expo.dev/changelog) again before scaffolding. Native Swift would add a second implementation of presentation and language tooling without removing the shared service or web requirement; no evidence found that warrants reopening the approved Expo architecture.

[Node's release table](https://nodejs.org/en/about/previous-releases) labels 24 and 22 LTS and 26 Current, and recommends LTS for production. Choose 24 over 22 for the newer maintained baseline; installed 26 is inventory, not the selected runtime. npm avoids introducing another required package-manager installation; pnpm remains credible for larger workspaces, but is not needed for this initial small workspace. This is a reproducibility choice, not a performance claim.

## Local evidence and its limits

Read-only shell checks returned Node 26.3.0, npm 11.16.0, pnpm 11.5.3, Bun 1.3.14; Yarn was not on PATH. `xcode-select -p` returned `/Applications/Xcode.app/Contents/Developer`; Xcode is 27.0 (27A266a), Swift 6.4, with iOS 27.0 build SDK. `simctl list runtimes` returned iOS 26.5 (23F77). `devicectl list devices` reported a paired, available physical iPad Air (5th generation), and all listed simulators shut down. No private device identifiers retained here.

This proves tools are installed and a device is discoverable. It does not prove Node 24 availability, a clean dependency install, CocoaPods resolution, simulator boot/build/launch, Apple signing identity, developer membership, provisioning, provider access, or a signed distributable. Coordinate ownership before any later physical iPad use; another agent may be using it.

## Small verification stack

| Layer | Choice and valuable cases |
| --- | --- |
| Shared operations and components | Jest for pure TypeScript rules/service contracts; `jest-expo` and React Native Testing Library for focused component interactions. Cover legal/illegal state transitions, released-step continuation, duplicate operation IDs, date boundaries, validation and errors. |
| PostgreSQL | Run service integration tests through the same Jest runner against a disposable real PostgreSQL database on the chosen production major. Apply migrations from empty, assert constraints, transaction rollback, concurrent changes, ownership isolation, and retry/idempotency behavior. Never substitute an in-memory database for these checks. |
| Web | Playwright against the running web UI/service with seeded fictional fixtures; Chromium, Firefox, and WebKit critical flows, keyboard operation, narrow and tablet widths. |
| Native journeys | Maestro against built iPhone and iPad simulator apps: create/advance work, record/edit workout sets and notes, photo/text diary, offline/error recovery, rotation and keyboard layouts. Supplement with physical iPhone/iPad checks for real camera/photo permissions, deep links/OAuth, accessibility and lifecycle behavior. |

[Expo recommends Jest/jest-expo and React Native Testing Library](https://docs.expo.dev/develop/unit-testing/); its mocks do not exercise real native integration. Avoid deprecated `react-test-renderer` and broad snapshot suites. [Expo documents Maestro simulator E2E](https://docs.expo.dev/eas/workflows/examples/e2e-tests/). [Playwright](https://playwright.dev/docs/intro) provides the browser test runner. The real-database test choice is an engineering decision to exercise PostgreSQL semantics through production operations, not a claim that PostgreSQL's own regression suite tests this application. [Supabase's testing guide](https://supabase.com/docs/guides/local-development/testing/overview) is a useful real-database testing reference if that host is selected.

Prefer this to adding Vitest beside Jest, Detox beside Maestro, and a separate SQL assertion framework immediately. Those alternatives can be useful, but do not yet cover an unmet requirement that justifies extra runners. Every test must assert user-visible behavior or a durable service invariant.

## Release evidence gates

1. A fresh checkout installs from the committed lockfile under pinned Node/npm; type-check, static checks, operation/component tests and migration/database tests pass.
2. Web production build and browser journeys pass with the real service and fictional test account. Verify deployed auth/callback/CORS behavior separately from local mocks.
3. Build and launch native simulator artifacts; run iPhone and iPad journeys and inspect screenshots. This proves the simulator configuration only.
4. Build with the chosen Apple toolchain and test on actual iPhone and iPad, with explicit device ownership. Exercise real permissions, resume/restart, OAuth return, network loss and iPad layout. Include iOS 27 launch when building with the iOS 27 SDK.
5. Produce a distribution-signed archive/build using authorized Apple credentials and profiles; verify bundle identity, entitlements and install through the intended distribution channel. [Expo's iOS build process](https://docs.expo.dev/build-reference/ios-builds/) documents credential/provisioning/build steps. A simulator `.app`, an unsigned archive, and a TestFlight-ready signed build are different evidence.
6. Complete provider checks with authorized accounts: OAuth refresh/revocation and real WHOOP read path, deployed storage/photo handling, and authenticated remote MCP. Mock responses alone cannot certify them. Recheck current store requirements before submission; this planning decision authorizes neither submission nor account access.

## License decision

Recommend MIT for original project source, preserving dependency licenses and required notices. Its [license text](https://spdx.org/licenses/MIT.html) permits use, modification, distribution and sublicensing subject to retaining copyright/license notices, with a warranty disclaimer. This best matches personal-first software that others can reuse with little administration.

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) is also permissive and adds an explicit contributor patent grant and patent-litigation termination, plus modified-file and notice requirements. Prefer it if explicit patent terms become a project priority; the brief does not establish that priority. [AGPL-3.0](https://spdx.org/licenses/AGPL-3.0-only.html) requires corresponding-source availability for covered modified network use and copyleft conditions on distribution. It is appropriate if reciprocal openness of hosted derivatives is the goal, but that restriction is not implied by open-source reuse. Choosing MIT does not require publishing personal configuration, credentials or user records; those remain outside committed source. This selects a license for planning; applying it must use the actual copyright holder and verify rights to any imported code/assets.
