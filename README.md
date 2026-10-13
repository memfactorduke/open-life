# Mem's Life

An opinionated personal life manager for tasks, workouts, food, and work shared between a person and agents.

Mem's Life is designed around Mem's way of working. Other people can run it with their own data, preferences, services, and agents. iPhone is the primary daily interface, iPad is a first-class interface, and the web app supports management on Mac.

The initial product combines configurable tasks with human/agent subtasks, full workout tracking, and a photo-and-text food diary. Full nutrition tracking and meal planning are later additions.

The task board starts with Planned, Next, and Active. External agents or watchers use MCP to pick up eligible work, report results, and hand it back to the person. The initial app coordinates this work rather than hosting the agents itself.

## Status

The initial product is implemented and undergoing release verification. A clean independent checkout passes 156 domain, mobile, and PostgreSQL tests, production browser journeys in three engines, and application builds. The web, native, and MCP clients share private tasks, workouts, food, and human/agent workflows. Actual simulator offline and interruption checks are in progress. Personal WHOOP consent, signed Apple distribution, physical-device camera tests, and remote HTTPS/MCP remain separate gates. See [release progress](docs/release-progress.md) and the 29 dependency-ordered tickets for the precise evidence. This is not yet a verified complete release candidate.

Use the [development setup](docs/development.md) for the local service and clients. The selected architecture uses Expo/React Native mobile clients, a separate React web interface, and a shared PostgreSQL-backed service; see the [client](docs/adr/0001-mobile-and-web-clients.md) and [service](docs/adr/0002-shared-service-for-people-and-agents.md) decisions. Original source is licensed under MIT. The [container verification procedure](docs/container.md) distinguishes tested packaging from a deployed installation.

## Start here

- [Product brief](docs/product.md): confirmed direction and open decisions.
- [Roadmap](docs/roadmap.md): proposed first complete workflow.
- [Glossary](GLOSSARY.md): initial shared vocabulary.
- [Agent instructions](AGENTS.md): development workflow and documentation rules.
- [YouTube workflow](docs/workflows/youtube.md): a concrete example of human/agent handoffs.
- [Wayfinding map](.scratch/mems-life-wayfinding/map.md): resolved research decisions and evidence.
- [First-release specification](.scratch/mems-life-v1/spec.md): agreed behavior, technical boundaries, and verification requirements.
- [Implementation tickets](.scratch/mems-life-v1/tickets.md): dependency-ordered vertical slices with current acceptance and evidence.

## Development workflow

Specs and issues live in local Markdown under `.scratch/`, following [the tracker conventions](docs/agents/issue-tracker.md). Matt Pocock's development skills are included under `.claude/skills/`; the per-repository configuration is in `docs/agents/`.

Keep committed examples fictional and personal data outside the source tree. Configuration must allow each person to supply their own settings and connections.
