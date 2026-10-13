import { useEffect, useRef, useState } from 'react';
import {
  ExerciseCommandSchema,
  RoutineCommandSchema,
  ExerciseListResponseSchema,
  ExerciseCommandResponseSchema,
  RoutineListResponseSchema,
  RoutineCommandResponseSchema,
  weightToKg,
  weightFromKg,
  distanceToMeters,
  distanceFromMeters,
  type Exercise,
  type ExerciseContent,
  type ExerciseCommand,
  type Routine,
  type RoutineContent,
  type RoutineCommand,
  type Preferences,
} from '@mems-life/domain';
import { request, RequestError } from '../api';
import './feature-styles.css';

type Editing =
  | { kind: 'exercise'; record: Exercise | null; content: ExerciseContent }
  | { kind: 'routine'; record: Routine | null; content: RoutineContent };
type Pending =
  { kind: 'exercise'; command: ExerciseCommand } | { kind: 'routine'; command: RoutineCommand };
const modes = ['weighted', 'bodyweight', 'timed', 'distance'] as const;
const modeNames = {
  weighted: 'Weight & repetitions',
  bodyweight: 'Bodyweight repetitions',
  timed: 'Duration',
  distance: 'Distance & duration',
};
const exerciseContent = (record: Exercise): ExerciseContent => ({
  name: record.name,
  mode: record.mode,
  supportsLoad: record.supportsLoad,
  notes: record.notes,
});
const routineContent = (record: Routine): RoutineContent => ({
  name: record.name,
  notes: record.notes,
  items: structuredClone(record.items),
});
const numberValue = (value: number | null) => (value === null ? '' : Number(value.toFixed(5)));

export function Workouts({ preferences }: { preferences: Preferences }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [tab, setTab] = useState<'routines' | 'exercises'>('routines');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [latest, setLatest] = useState<Exercise | Routine | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const pending = useRef<Pending | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const loadSequence = useRef(0);
  const load = async () => {
    const sequence = ++loadSequence.current;
    try {
      const [openExercises, archivedExercises, openRoutines, archivedRoutines] = await Promise.all([
        request('/api/exercises', ExerciseListResponseSchema),
        request('/api/exercises?view=archived', ExerciseListResponseSchema),
        request('/api/routines', RoutineListResponseSchema),
        request('/api/routines?view=archived', RoutineListResponseSchema),
      ]);
      const records = {
        exercises: [...openExercises.exercises, ...archivedExercises.exercises],
        routines: [...openRoutines.routines, ...archivedRoutines.routines],
      };
      if (sequence === loadSequence.current) {
        setExercises(records.exercises);
        setRoutines(records.routines);
        setFailed(false);
        setLoading(false);
      }
      return records;
    } catch (error) {
      if (sequence === loadSequence.current) {
        setNotice(
          error instanceof Error ? error.message : 'The workout library could not be loaded.',
        );
        setFailed(true);
        setLoading(false);
      }
      throw error;
    }
  };
  useEffect(() => {
    void load().catch(() => {});
    return () => {
      loadSequence.current += 1;
    };
  }, []);
  useEffect(() => {
    if (editing && !dialog.current?.open) {
      setNotice('');
      dialog.current?.showModal();
    }
  }, [editing]);
  const close = () => {
    dialog.current?.close();
    setEditing(null);
    setLatest(null);
  };
  const run = async (operation: Pending, retry = false) => {
    if (busy || (pending.current && !retry)) return;
    pending.current = operation;
    setBusy(true);
    setNotice('');
    try {
      if (operation.kind === 'exercise')
        await request('/api/exercises/commands', ExerciseCommandResponseSchema, {
          method: 'POST',
          body: JSON.stringify(operation.command),
        });
      else
        await request('/api/routines/commands', RoutineCommandResponseSchema, {
          method: 'POST',
          body: JSON.stringify(operation.command),
        });
      pending.current = null;
      close();
      await load();
      setNotice('Saved. Your routines are plans. They do not record a workout as performed.');
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        pending.current = null;
        try {
          const records = await load();
          const command = operation.command;
          const current =
            operation.kind === 'exercise'
              ? records.exercises.find(
                  (value) => value.id === (command as ExerciseCommand).exerciseId,
                )
              : records.routines.find(
                  (value) => value.id === (command as RoutineCommand).routineId,
                );
          if (current && editing) setLatest(current);
          setNotice(
            'This record changed elsewhere. Review its latest saved version before saving your edits.',
          );
        } catch {
          setNotice('This record changed elsewhere. Reload the library before changing it.');
        }
      } else {
        if (error instanceof RequestError && error.status >= 400 && error.status < 500)
          pending.current = null;
        setNotice(error instanceof Error ? error.message : 'The change could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };
  const editText = (key: 'name' | 'notes', value: string) => {
    if (editing?.kind === 'exercise')
      setEditing({ ...editing, content: { ...editing.content, [key]: value } });
    else if (editing?.kind === 'routine')
      setEditing({ ...editing, content: { ...editing.content, [key]: value } });
  };
  const save = () => {
    if (!editing) return;
    if (editing.kind === 'exercise')
      void run({
        kind: 'exercise',
        command: ExerciseCommandSchema.parse({
          type: editing.record ? 'exercise.edit' : 'exercise.create',
          operationId: crypto.randomUUID(),
          exerciseId: editing.record?.id ?? crypto.randomUUID(),
          expectedRevision: editing.record?.revision ?? 0,
          content: editing.content,
        }),
      });
    else
      void run({
        kind: 'routine',
        command: RoutineCommandSchema.parse({
          type: editing.record ? 'routine.edit' : 'routine.create',
          operationId: crypto.randomUUID(),
          routineId: editing.record?.id ?? crypto.randomUUID(),
          expectedRevision: editing.record?.revision ?? 0,
          content: editing.content,
        }),
      });
  };
  const exerciseAction = (exercise: Exercise) =>
    void run({
      kind: 'exercise',
      command: {
        type: exercise.archivedAt ? 'exercise.unarchive' : 'exercise.archive',
        operationId: crypto.randomUUID(),
        exerciseId: exercise.id,
        expectedRevision: exercise.revision,
      },
    });
  const routineAction = (routine: Routine, duplicate = false) =>
    void run({
      kind: 'routine',
      command: duplicate
        ? {
            type: 'routine.duplicate',
            operationId: crypto.randomUUID(),
            routineId: routine.id,
            expectedRevision: routine.revision,
            newId: crypto.randomUUID(),
          }
        : {
            type: routine.archivedAt ? 'routine.unarchive' : 'routine.archive',
            operationId: crypto.randomUUID(),
            routineId: routine.id,
            expectedRevision: routine.revision,
          },
    });
  const setRoutine = (content: RoutineContent) => {
    if (editing?.kind === 'routine') setEditing({ ...editing, content });
  };
  const updateItem = (index: number, change: Partial<RoutineContent['items'][number]>) => {
    if (editing?.kind === 'routine')
      setRoutine({
        ...editing.content,
        items: editing.content.items.map((item, position) =>
          position === index ? { ...item, ...change } : item,
        ),
      });
  };
  const addExercise = (id: string) => {
    if (editing?.kind !== 'routine' || !id) return;
    const exercise = exercises.find((value) => value.id === id)!;
    setRoutine({
      ...editing.content,
      items: [
        ...editing.content.items,
        {
          id: crypto.randomUUID(),
          exerciseId: id,
          snapshot: {
            name: exercise.name,
            mode: exercise.mode,
            supportsLoad: exercise.supportsLoad,
          },
          targets: [],
          notes: '',
        },
      ],
    });
  };
  const addTarget = (index: number) => {
    if (editing?.kind !== 'routine') return;
    const item = editing.content.items[index]!;
    const mode = item.snapshot.mode;
    const measurements =
      mode === 'weighted'
        ? { mode, reps: null, loadKg: null }
        : mode === 'bodyweight'
          ? { mode, reps: null, addedLoadKg: null }
          : mode === 'timed'
            ? { mode, durationSeconds: null, loadKg: null }
            : { mode, distanceMeters: null, durationSeconds: null, loadKg: null };
    updateItem(index, {
      targets: [
        ...item.targets,
        { id: crypto.randomUUID(), kind: 'working', measurements, notes: '' },
      ],
    });
  };
  const moveItem = (index: number, offset: number) => {
    if (editing?.kind !== 'routine') return;
    const items = [...editing.content.items];
    const other = index + offset;
    if (other < 0 || other >= items.length) return;
    [items[index], items[other]] = [items[other]!, items[index]!];
    setRoutine({ ...editing.content, items });
  };
  const noticeView = notice && (
    <div className="notice feature-notice" role="status">
      <p>{notice}</p>
      {pending.current && (
        <button disabled={busy} onClick={() => pending.current && void run(pending.current, true)}>
          Retry the same change
        </button>
      )}
    </div>
  );
  return (
    <section className="feature-area">
      <div className="intro">
        <h2>Build a plan you can return to.</h2>
        <p>Keep your exercises and reusable routines together. Open Train to record a workout.</p>
      </div>
      <div className="feature-toolbar">
        <div className="segmented">
          {(['routines', 'exercises'] as const).map((value) => (
            <button
              className={tab === value ? '' : 'secondary'}
              aria-pressed={tab === value}
              key={value}
              onClick={() => setTab(value)}
            >
              {value === 'routines' ? 'Routines' : 'Exercise library'}
            </button>
          ))}
        </div>
        <button
          disabled={busy || !!pending.current}
          onClick={() => {
            setLatest(null);
            setEditing(
              tab === 'exercises'
                ? {
                    kind: 'exercise',
                    record: null,
                    content: { name: '', mode: 'weighted', supportsLoad: true, notes: '' },
                  }
                : { kind: 'routine', record: null, content: { name: '', notes: '', items: [] } },
            );
          }}
        >
          {tab === 'routines' ? 'New routine' : 'New exercise'}
        </button>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />
        Show archived {tab}
      </label>
      {noticeView}
      {loading ? (
        <p role="status">Opening your workout library…</p>
      ) : failed ? (
        <button onClick={() => void load().catch(() => {})}>Reload library</button>
      ) : (
        <div className="library-grid">
          {tab === 'routines'
            ? routines
                .filter((item) => (archived ? !!item.archivedAt : !item.archivedAt))
                .map((routine) => (
                  <article className="library-card" key={routine.id}>
                    <p className="eyebrow">
                      {routine.items.length} exercises{routine.archivedAt ? ' · Archived' : ''}
                    </p>
                    <h3>{routine.name}</h3>
                    <p>{routine.notes || 'A reusable training plan.'}</p>
                    <ol className="routine-preview">
                      {routine.items.map((item) => (
                        <li key={item.id}>
                          {item.snapshot.name}
                          <span>{item.targets.length} targets</span>
                        </li>
                      ))}
                    </ol>
                    <div className="card-actions">
                      <button
                        className="secondary"
                        disabled={busy || !!pending.current}
                        onClick={() => {
                          setEditing({
                            kind: 'routine',
                            record: routine,
                            content: routineContent(routine),
                          });
                          setLatest(null);
                        }}
                      >
                        Edit routine
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || !!pending.current}
                        onClick={() => routineAction(routine, true)}
                      >
                        Duplicate
                      </button>
                      <button
                        className="text-button"
                        disabled={busy || !!pending.current}
                        onClick={() => routineAction(routine)}
                      >
                        {routine.archivedAt ? 'Unarchive' : 'Archive'}
                      </button>
                    </div>
                  </article>
                ))
            : exercises
                .filter((item) => (archived ? !!item.archivedAt : !item.archivedAt))
                .map((exercise) => (
                  <article className="library-card" key={exercise.id}>
                    <p className="eyebrow">
                      {exercise.origin === 'builtin' ? 'Catalog' : 'Custom'}
                      {exercise.archivedAt ? ' · Archived' : ''}
                    </p>
                    <h3>{exercise.name}</h3>
                    <p>
                      {modeNames[exercise.mode]}
                      {exercise.supportsLoad && exercise.mode !== 'weighted'
                        ? ' · optional load'
                        : ''}
                    </p>
                    {exercise.notes && <p>{exercise.notes}</p>}
                    <div className="card-actions">
                      <button
                        className="secondary"
                        disabled={busy || !!pending.current}
                        onClick={() => {
                          setEditing({
                            kind: 'exercise',
                            record: exercise,
                            content: exerciseContent(exercise),
                          });
                          setLatest(null);
                        }}
                      >
                        Edit exercise
                      </button>
                      <button
                        className="text-button"
                        disabled={busy || !!pending.current}
                        onClick={() => exerciseAction(exercise)}
                      >
                        {exercise.archivedAt ? 'Unarchive' : 'Archive'}
                      </button>
                    </div>
                  </article>
                ))}
          {!(tab === 'routines' ? routines : exercises).some((item) =>
            archived ? !!item.archivedAt : !item.archivedAt,
          ) && (
            <div className="library-empty">
              <h3>
                {archived
                  ? 'No archived records.'
                  : tab === 'routines'
                    ? 'Your first routine starts here.'
                    : 'No exercises yet.'}
              </h3>
              <p>
                {archived
                  ? 'Archived records remain available here.'
                  : 'Use the button above to add one.'}
              </p>
            </div>
          )}
        </div>
      )}
      <dialog
        className="feature-dialog routine-dialog"
        ref={dialog}
        aria-labelledby="workout-editor-title"
        onCancel={close}
        onClose={close}
      >
        {editing && (
          <>
            <div className="detail-heading">
              <h2 id="workout-editor-title">
                {editing.record ? 'Edit' : 'New'} {editing.kind}
              </h2>
              <button className="secondary" onClick={close}>
                Close
              </button>
            </div>
            {noticeView}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <fieldset disabled={busy || !!pending.current}>
                <label>
                  Name
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={editing.content.name}
                    onChange={(event) => editText('name', event.target.value)}
                  />
                </label>
                {editing.kind === 'exercise' ? (
                  <>
                    <label>
                      Measurement
                      <select
                        aria-label="Measurement"
                        value={editing.content.mode}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            content: {
                              ...editing.content,
                              mode: event.target.value as ExerciseContent['mode'],
                              supportsLoad: event.target.value === 'weighted',
                            },
                          })
                        }
                      >
                        {modes.map((mode) => (
                          <option key={mode} value={mode}>
                            {modeNames[mode]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {editing.content.mode !== 'weighted' && (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={editing.content.supportsLoad}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              content: { ...editing.content, supportsLoad: event.target.checked },
                            })
                          }
                        />
                        Allow an optional load
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <label>
                      Add an exercise
                      <select
                        aria-label="Add an exercise"
                        disabled={editing.content.items.length >= 100}
                        value=""
                        onChange={(event) => addExercise(event.target.value)}
                      >
                        <option value="">Choose from your library…</option>
                        {exercises
                          .filter((exercise) => !exercise.archivedAt)
                          .map((exercise) => (
                            <option value={exercise.id} key={exercise.id}>
                              {exercise.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="routine-items">
                      {editing.content.items.map((item, index) => (
                        <section className="routine-item" key={item.id}>
                          <div className="item-heading">
                            <h3>
                              <span>{index + 1}.</span> {item.snapshot.name}
                            </h3>
                            <div className="item-order">
                              <button
                                type="button"
                                className="secondary"
                                aria-label={`Move ${item.snapshot.name} up`}
                                disabled={index === 0}
                                onClick={() => moveItem(index, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                aria-label={`Move ${item.snapshot.name} down`}
                                disabled={index === editing.content.items.length - 1}
                                onClick={() => moveItem(index, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                aria-label={`Remove ${item.snapshot.name}`}
                                onClick={() =>
                                  setRoutine({
                                    ...editing.content,
                                    items: editing.content.items.filter(
                                      (_, position) => position !== index,
                                    ),
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <p className="muted">{modeNames[item.snapshot.mode]}</p>
                          {item.targets.map((target, targetIndex) => {
                            const fields =
                              target.measurements.mode === 'weighted'
                                ? ['reps', 'loadKg']
                                : target.measurements.mode === 'bodyweight'
                                  ? ['reps', ...(item.snapshot.supportsLoad ? ['addedLoadKg'] : [])]
                                  : target.measurements.mode === 'timed'
                                    ? [
                                        'durationSeconds',
                                        ...(item.snapshot.supportsLoad ? ['loadKg'] : []),
                                      ]
                                    : [
                                        'distanceMeters',
                                        'durationSeconds',
                                        ...(item.snapshot.supportsLoad ? ['loadKg'] : []),
                                      ];
                            const updateTarget = (change: Partial<typeof target>) =>
                              updateItem(index, {
                                targets: item.targets.map((value, position) =>
                                  position === targetIndex ? { ...value, ...change } : value,
                                ),
                              });
                            return (
                              <fieldset className="target-row" key={target.id}>
                                <legend>Target {targetIndex + 1}</legend>
                                <div className="target-measures">
                                  <label>
                                    Set type
                                    <select
                                      value={target.kind}
                                      onChange={(event) =>
                                        updateTarget({
                                          kind: event.target.value as 'warmup' | 'working',
                                        })
                                      }
                                    >
                                      <option value="working">Working</option>
                                      <option value="warmup">Warm-up</option>
                                    </select>
                                  </label>
                                  {fields.map((field) => {
                                    const value =
                                      (
                                        target.measurements as unknown as Record<
                                          string,
                                          number | null
                                        >
                                      )[field] ?? null;
                                    const isWeight = field === 'loadKg' || field === 'addedLoadKg';
                                    const display =
                                      value === null
                                        ? null
                                        : isWeight
                                          ? weightFromKg(value, preferences.weightUnit)
                                          : field === 'distanceMeters'
                                            ? distanceFromMeters(value, preferences.distanceUnit)
                                            : value;
                                    const label =
                                      field === 'reps'
                                        ? 'Repetitions'
                                        : field === 'durationSeconds'
                                          ? 'Seconds'
                                          : field === 'distanceMeters'
                                            ? `Distance (${preferences.distanceUnit})`
                                            : `${field === 'addedLoadKg' ? 'Added load' : 'Load'} (${preferences.weightUnit})`;
                                    return (
                                      <label key={field}>
                                        {label}
                                        <input
                                          aria-label={label}
                                          type="number"
                                          min={0}
                                          step={
                                            field === 'reps' || field === 'durationSeconds'
                                              ? 1
                                              : 'any'
                                          }
                                          value={numberValue(display)}
                                          onChange={(event) => {
                                            const raw =
                                              event.target.value === ''
                                                ? null
                                                : Number(event.target.value);
                                            const canonical =
                                              raw === null
                                                ? null
                                                : isWeight
                                                  ? weightToKg(raw, preferences.weightUnit)
                                                  : field === 'distanceMeters'
                                                    ? distanceToMeters(
                                                        raw,
                                                        preferences.distanceUnit,
                                                      )
                                                    : raw;
                                            updateTarget({
                                              measurements: {
                                                ...target.measurements,
                                                [field]: canonical,
                                              },
                                            });
                                          }}
                                        />
                                      </label>
                                    );
                                  })}
                                </div>
                                <label>
                                  Target notes
                                  <input
                                    value={target.notes}
                                    onChange={(event) =>
                                      updateTarget({ notes: event.target.value })
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() =>
                                    updateItem(index, {
                                      targets: item.targets.filter(
                                        (_, position) => position !== targetIndex,
                                      ),
                                    })
                                  }
                                >
                                  Remove target {targetIndex + 1}
                                </button>
                              </fieldset>
                            );
                          })}
                          <button
                            type="button"
                            className="secondary"
                            disabled={item.targets.length >= 100}
                            onClick={() => addTarget(index)}
                          >
                            Add target
                          </button>
                          <label className="item-notes">
                            Exercise notes
                            <textarea
                              maxLength={20000}
                              rows={2}
                              value={item.notes}
                              onChange={(event) => updateItem(index, { notes: event.target.value })}
                            />
                          </label>
                        </section>
                      ))}
                    </div>
                    <p className="feature-footnote">
                      Targets can be left blank. Enter the measurements you intend to use. Library
                      changes do not rewrite exercises already saved in a routine.
                    </p>
                  </>
                )}
                <label>
                  Notes
                  <textarea
                    maxLength={20000}
                    rows={3}
                    value={editing.content.notes}
                    onChange={(event) => editText('notes', event.target.value)}
                  />
                </label>
                <button
                  disabled={
                    !!latest || !!editing.record?.archivedAt || !editing.content.name.trim()
                  }
                >
                  Save {editing.kind}
                </button>
              </fieldset>
            </form>
            {latest && (
              <section className="revision-review">
                <h3>Review the saved version</h3>
                <p>
                  Your edits remain in the form. The saved record is revision {latest.revision}.
                </p>
                <dl>
                  <dt>Name</dt>
                  <dd>{latest.name}</dd>
                  <dt>Notes</dt>
                  <dd>{latest.notes || 'None'}</dd>
                </dl>
                {'items' in latest ? (
                  latest.items.map((item) => (
                    <section key={item.id} className="saved-routine-item">
                      <h3>{item.snapshot.name}</h3>
                      <p>
                        {modeNames[item.snapshot.mode]} ·{' '}
                        {item.snapshot.supportsLoad ? 'Load supported' : 'No external load'}
                      </p>
                      <p>{item.notes || 'No exercise notes.'}</p>
                      <ol>
                        {item.targets.map((target) => (
                          <li key={target.id}>
                            {target.kind === 'warmup' ? 'Warm-up' : 'Working'}
                            {Object.entries(target.measurements)
                              .filter(([key]) => key !== 'mode')
                              .map(([key, value]) => (
                                <span key={key}>
                                  {' '}
                                  ·{' '}
                                  {key === 'reps'
                                    ? 'Repetitions'
                                    : key === 'durationSeconds'
                                      ? 'Seconds'
                                      : key === 'distanceMeters'
                                        ? `Distance (${preferences.distanceUnit})`
                                        : `Load (${preferences.weightUnit})`}
                                  :{' '}
                                  {value === null
                                    ? 'Not set'
                                    : typeof value === 'number'
                                      ? numberValue(
                                          key === 'loadKg' || key === 'addedLoadKg'
                                            ? weightFromKg(value, preferences.weightUnit)
                                            : key === 'distanceMeters'
                                              ? distanceFromMeters(value, preferences.distanceUnit)
                                              : value,
                                        )
                                      : value}
                                </span>
                              ))}
                            <p>{target.notes || 'No target notes.'}</p>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))
                ) : (
                  <p>
                    {modeNames[latest.mode]} ·{' '}
                    {latest.supportsLoad ? 'Load supported' : 'No external load'}
                  </p>
                )}
                <div className="review-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing({
                        ...editing,
                        record: latest,
                        content:
                          editing.kind === 'exercise'
                            ? exerciseContent(latest as Exercise)
                            : routineContent(latest as Routine),
                      } as Editing);
                      setLatest(null);
                    }}
                  >
                    Use saved version
                  </button>
                  <button
                    onClick={() => {
                      setEditing({ ...editing, record: latest } as Editing);
                      setLatest(null);
                    }}
                  >
                    Keep my reviewed edits
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </dialog>
    </section>
  );
}
