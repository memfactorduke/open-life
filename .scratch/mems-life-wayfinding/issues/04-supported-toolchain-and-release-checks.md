# Supported toolchain and release checks

Type: research
Status: resolved
Blocked by: None

## Question

Which stable framework/toolchain baseline, verification stack, and open-source license make the already selected architecture reproducible? Compare credible current alternatives, account for the installed Apple tooling, and identify what can be proven locally versus what requires device/signing/provider access.

## Resolution criteria

- Verify current Expo/React Native/React/Node compatibility through official sources; specify version policy rather than invented future versions.
- Choose a small test stack covering shared operations, PostgreSQL behavior, web flows, and iPhone/iPad journeys.
- Recommend a license based on the personal-first/open-source reuse goal and compare meaningful alternatives.
- Distinguish a passing simulator/build check, a real physical-device check, and a signed distributable. No app code, package installation, or physical-device use during research.

## Comments


## Answer

Use stable Expo SDK 57 and its paired RN 0.86/React 19.2.3 set, Node 24 LTS and pinned npm/lockfile. On installed Xcode 27, require Expo 57.0.23 or later plus documented scene lifecycle support; verify launch on iOS 27. Recheck exact stable patches at scaffolding. SDK 58 beta and local Node 26 Current are not the baseline.

Choose Jest/jest-expo with React Native Testing Library, real PostgreSQL service integration tests, Playwright browser journeys, and Maestro iPhone/iPad simulator journeys plus physical-device release checks. Recommend MIT for straightforward reuse after comparing Apache-2.0's patent terms and AGPL's reciprocal source requirements.

[Research and release gates](../research/04-toolchain-release.md) record sources, installed tool evidence, alternatives and limits. Installed Xcode and a discoverable paired iPad do not prove native builds, signing, device behavior, provider integration or a distributable. No application code, dependencies, licenses, account connections or devices were changed.
