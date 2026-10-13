# Issue tracker: Local Markdown

Development issues and specs live as Markdown files in `.scratch/`. This is the repository's development tracker, separate from the Kanban data the application will manage.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are separate files at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- Triage state is a `Status:` line near the top of each ordinary issue. Use the role strings in [triage-labels.md](triage-labels.md).
- Execution state is a separate `State:` line: `open`, `claimed`, or `resolved`. Save `State: claimed` before implementation. After verifying the acceptance criteria, record the result and set `State: resolved`; a triage role alone never means the work is complete.
- Ordinary issue dependencies use `Blocked by: NN, NN` within the same feature. A blocker is complete only when its `State:` is `resolved`.
- Append discussion under a `## Comments` heading.
- Keep personal life data and credentials out of development tickets. Local files can still be committed; review their contents before sharing them.

## Skill operations

When a skill says to publish to the issue tracker, create the appropriate local spec or issue file. When it says to fetch a ticket, read that file. Resolve an ambiguous bare number to its feature directory before editing.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`, with the question in the body and a `Type:` of `research`, `prototype`, `grilling`, or `task`.
- For these wayfinding tickets, `Status:` records execution state: `open`, `claimed`, or `resolved`. Maps and wayfinding tickets do not carry triage labels.
- Blocking: a `Blocked by: NN, NN` line. A ticket is unblocked when every listed ticket is resolved.
- Frontier: choose the first numbered open, unblocked, unclaimed ticket.
- Claim: save `Status: claimed` before starting work.
- Resolve: append the answer under `## Answer`, set `Status: resolved`, and add a short summary and file link to Decisions-so-far in the map.
