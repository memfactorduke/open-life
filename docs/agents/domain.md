# Domain documentation

## Read before exploring

- Read [GLOSSARY.md](../../GLOSSARY.md) for shared vocabulary.
- Read relevant records under `docs/adr/` when that directory exists.
- Read [the product brief](../product.md) for confirmed requirements and open questions. It is separate from the glossary.

This repository uses a single domain glossary. The project-local skills use the newer `GLOSSARY.md` name. Older installed skills look for `CONTEXT.md`; that file points to the same glossary. Read and update `GLOSSARY.md`, and keep `CONTEXT.md` as a pointer rather than a second glossary.

## Writing rules

Use the glossary's names consistently. Keep the glossary to domain definitions, with product scope and implementation plans in their own documents.

Only add a decision record when a choice is costly to reverse, surprising without context, and the result of a real trade-off. Record the alternatives and reasoning. Create `docs/adr/` with the first such record; its absence is normal at this stage.

If a proposal conflicts with an existing decision record, identify the conflict explicitly. If a new domain concept has not been resolved, keep it as an open question until it is clarified.
