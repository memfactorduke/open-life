# Shared implementation contracts

## Operation ownership

Two independent design explorations selected named domain command unions behind one PostgreSQL application-operation boundary. Prefer relational columns for identity, ownership, lifecycle, revisions and references. Use validated JSON only for bounded content, measurement variants and immutable plan/execution snapshots. A generic documents CRUD API is not the selected design.

Authenticate before exposing data. Acquire the installation's mutation/feed lock, revalidate permission using the transaction's existing connection, then look up the actor-scoped request receipt. Replay a matching receipt before applying new-operation revision or lease checks. Save the result, receipt, audit and a complete feed transaction together. Do not perform network calls or acquire another pool connection while holding this transaction.

## Task slice

Use a stable task UUID, revision, explicit Planned/Next/Active/Completed phase, content with title/description/notes, ordering, event times, archive time and deletion tombstone. Archive is separate from completion. The server owns actor and owner identity.

Use semantic commands for create, content edit, move/reorder, complete, reopen, archive/unarchive, delete/restore. Creation is Planned. Planned to Next deliberately releases work. Next to Active begins work. Ordinary content editing cannot change execution status. Reopening and correction preserve historical events.

Every command includes operation ID and the relevant expected revision. New records expect revision zero. Return every record whose order/revision changed so clients do not keep stale peer state. Use strict discriminated boundary schemas. History is queried separately from the current task.

## Workout slice

Exercise definitions, routines and actual sessions have separate identity/revisions. Routines contain ordered exercise items and planned target sets with stable item/set IDs. Starting a session snapshots exercise names, measurement mode, targets, units and notes. Actual reported results are distinct from targets.

Measurement modes are weighted repetitions, bodyweight repetitions with explicitly added external load, time, and distance/time. Use kilograms, metres and seconds for stored physical quantities. Null means unrecorded. Do not infer missing load or body mass. Strict schemas reject irrelevant values. Display preference changes convert presentation rather than rewriting stored quantities.

Routine content edits may atomically replace the ordered plan while preserving stable IDs. Duplication generates new identity. Session operations record/correct actual sets, notes and lifecycle. Plan edits never manufacture results or rewrite completed history. Weighted volume includes actual completed weighted working sets only.

## Verification order

Prove the private first-run service and UI/native clients before marking its ticket resolved. Then task capture and workout routines advance in parallel. Browser compilation, JavaScript export, simulator build, simulator interactions, physical-device checks and signed distribution are distinct evidence.
