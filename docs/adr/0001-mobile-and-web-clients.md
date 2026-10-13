---
status: accepted
date: 2026-10-12
---

# Expo mobile and a separate React web interface

Use Expo/React Native for iPhone and iPad, and a separate React interface for web management. Keep them in one repository with shared TypeScript domain rules, validation, and API contracts. Build the two presentation layers in sequence around working product slices rather than treating them as unrelated products.

The phone is the primary daily interface; the iPad needs deliberately adaptive layouts; web needs room for planning and management. This arrangement shares behavior while allowing different navigation, information density, and input methods. Its cost is maintaining two presentation layers and checking that both behave consistently.

## Alternatives considered

- **One universal Expo interface:** a credible way to share more UI. Expo supports both React Native Web and web-only DOM components. We choose separate presentation layers because the phone's execution workflows and the desktop's management workflows have different needs, not because Expo lacks web support.
- **SwiftUI plus a separate web app:** offers direct access to Apple's navigation and platform APIs, but adds a second client language and duplicates more client logic. Revisit if essential Apple-specific capabilities or measured interaction quality justify that cost.

## Constraints and validation

Treat iPad resizing, keyboard access, and touch interaction as acceptance criteria from the first mobile slice. Use stable responsive-layout primitives; Expo Router's SplitView is currently alpha and is not the foundation for production tablet navigation. Keep native modules available as an escape hatch when a specific feature needs them.

Share persistence interfaces rather than assuming identical database implementations. Expo SQLite supports persistent mobile data; its web implementation is currently alpha. Exact cache and offline behavior will follow the product specification.

Before expanding implementation, prove a representative slice in a browser, an iPhone simulator, and an iPad simulator, including compact/wide layouts and restart persistence. Test the physical iPad only after coordinating its use. This ADR is a design choice, not evidence that those checks have passed.

## Sources checked

- [Expo web support](https://docs.expo.dev/workflow/web/)
- [React Native adaptive dimensions](https://reactnative.dev/docs/dimensions)
- [Expo Router SplitView status](https://docs.expo.dev/versions/latest/sdk/router/split-view/)
- [Expo SQLite persistence and web status](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Apple NavigationSplitView](https://developer.apple.com/documentation/swiftui/navigationsplitview)
