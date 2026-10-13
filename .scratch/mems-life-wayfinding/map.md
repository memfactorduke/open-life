# Mem's Life: find the route to the first complete release

## Destination

A buildable first-release specification and a dependency-ordered set of implementation tickets for equally first-class productivity and workout tracking, an initial food diary, generic MCP coordination, and WHOOP integration across iPhone, iPad, and web. Stop before application implementation.

## Notes

- Local Markdown is the canonical tracker. Decision tickets use `Type` and execution `Status`; implementation tickets will live separately under `mems-life-v1` and use triage `Status` plus execution `State`.
- Follow the repository's Wayfinder, To Spec, To Tickets, domain-modeling, research, and writing-for-agents skills. Research evidence stays in the local tracker beside the decisions, consistent with the selected local publishing workflow.
- The prior product interview is the source for personal requirements: [product brief](../../docs/product.md), [glossary](../../GLOSSARY.md), [YouTube workflow](../../docs/workflows/youtube.md), and [architecture decisions](../../docs/adr/).
- Personal requirements already confirmed: Planned/Next/Active; mixed human/agent steps with automatic continuation of released work; full workout logging with notes; photo-and-text food diary; WHOOP; no legacy import; iPhone primary, iPad first-class, web management; personal-first and open source.
- Technical and routine implementation choices are delegated. User preferences are not research questions to reopen. Agent runtime selection is deliberately independent of this plan.
- Existing stack decisions stand: Expo/React Native mobile, separate React web presentation, shared TypeScript rules, PostgreSQL, a shared service for UI and MCP. Research narrows remaining choices and must flag evidence that contradicts those decisions.
- Research tickets are independent and may run in parallel. No app installation, infrastructure purchase, account connection, device use, or product code belongs to this phase.

## Decisions so far

- [Portable access and deployment](issues/01-portable-access-and-deployment.md): one private owner, Fastify/Better Auth/PostgreSQL, portable Compose deployment, and separately scoped manually configured MCP credentials.
- [Durable offline records and private media](issues/02-durable-offline-and-media.md): native SQLite with a durable command outbox and explicit conflicts; online-first web; private filesystem media on the single host.
- [WHOOP data and connection boundary](issues/03-whoop-integration.md): read-only v2 observations with bounded polling, local workout records preserved, and explicit account-consent verification later.
- [Supported toolchain and release checks](issues/04-supported-toolchain-and-release-checks.md): supported stable Expo package family, Node 24 LTS, real-service tests, separate native release gates, and MIT for original source.

## Not yet specified

None blocking specification. All four decision tickets are resolved. Exact dependency patches, hostnames, provider credentials, signing identities, and physical-device availability are implementation-time inputs or verification gates; they are not unresolved product choices.

## Handoff

The map is clear for To Spec, then To Tickets. The maintainer explicitly approved completing those planning phases and reserved setting the implementation goal for afterward. No application implementation is authorized by completion of this map.

Completed handoff: [first-release specification](../mems-life-v1/spec.md) and [29 implementation tickets](../mems-life-v1/tickets.md). Research decisions, specification coverage, and dependency edges were reviewed before this handoff.

## Out of scope

- Application implementation, deployment, App Store submission, physical-device control, and connecting the maintainer's WHOOP account during planning.
- Selecting or integrating a particular external agent runtime.
- Full nutrition/macronutrient logging, meal planning, recipes, groceries, native Mac, multi-person collaboration, and historical imports.
