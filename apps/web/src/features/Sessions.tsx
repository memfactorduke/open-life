import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  SessionCommandSchema,
  SessionCommandResponseSchema,
  SessionListSchema,
  SessionResponseSchema,
  SessionHistorySchema,
  ExercisePerformanceResponseSchema,
  measuredWorkingVolume,
  timerRemaining,
  ExerciseListResponseSchema,
  RoutineListResponseSchema,
  RoutineResponseSchema,
  weightToKg,
  weightFromKg,
  distanceToMeters,
  distanceFromMeters,
  type WorkoutSession,
  type SessionExercise,
  type SessionCommand,
  type Measurements,
  type Preferences,
  type Exercise,
  type Routine,
  type ExercisePerformanceResponse,
} from '@mems-life/domain';
import { request, RequestError } from '../api';
import './sessions.css';

type Performance = ExercisePerformanceResponse['performances'][number];
type Draft = {
  weightUnit?: Preferences['weightUnit'];
  distanceUnit?: Preferences['distanceUnit'];
  kind: 'working' | 'warmup';
  values: Record<string, string>;
  notes: string;
  round: string;
  setId: string | null;
  reason: string;
};
const fresh = (): Draft => ({
  kind: 'working',
  values: {},
  notes: '',
  round: '',
  setId: null,
  reason: '',
});
const empty = (mode: Measurements['mode']): Measurements =>
  mode === 'weighted'
    ? { mode, reps: null, loadKg: null }
    : mode === 'bodyweight'
      ? { mode, reps: null, addedLoadKg: null }
      : mode === 'timed'
        ? { mode, durationSeconds: null, loadKg: null }
        : { mode, distanceMeters: null, durationSeconds: null, loadKg: null };
const fmt = (value: number) => Number(value.toFixed(3)).toLocaleString();
function fields(item: SessionExercise) {
  return Object.keys(empty(item.snapshot.mode)).filter(
    (key) =>
      key !== 'mode' && (item.snapshot.supportsLoad || !['loadKg', 'addedLoadKg'].includes(key)),
  );
}
function label(key: string, p: Preferences) {
  return key === 'reps'
    ? 'Repetitions'
    : key === 'durationSeconds'
      ? 'Seconds'
      : key === 'distanceMeters'
        ? `Distance (${p.distanceUnit})`
        : `${key === 'addedLoadKg' ? 'Added load' : 'Load'} (${p.weightUnit})`;
}
function display(key: string, value: number, p: Preferences) {
  return ['loadKg', 'addedLoadKg'].includes(key)
    ? weightFromKg(value, p.weightUnit)
    : key === 'distanceMeters'
      ? distanceFromMeters(value, p.distanceUnit)
      : value;
}
const errorText = (error: unknown, fallback: string) =>
  error instanceof z.ZodError
    ? error.issues.map((issue) => issue.message).join(' ')
    : error instanceof Error
      ? error.message
      : fallback;
function resultText(m: Measurements, p: Preferences) {
  return Object.entries(m)
    .filter(([key]) => key !== 'mode')
    .map(
      ([key, value]) =>
        `${label(key, p)}: ${value === null ? 'not recorded' : fmt(display(key, value as number, p))}`,
    )
    .join(' · ');
}
function activityLabel(item: SessionExercise, session: WorkoutSession) {
  if (item.status === 'in-progress' && session.status !== 'active') return 'Recorded activity';
  if (item.status === 'planned' && session.status !== 'active') return 'Planned only';
  return item.status;
}
export function Sessions({
  preferences,
  focusTarget,
  active = true,
}: {
  active?: boolean;
  preferences: Preferences;
  focusTarget?: { id?: string; routineId?: string; action?: 'create' | 'capture' };
}) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]),
    [routines, setRoutines] = useState<Routine[]>([]),
    [exercises, setExercises] = useState<Exercise[]>([]);
  const [session, setSession] = useState<WorkoutSession | null>(null),
    [selected, setSelected] = useState(''),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [clockError, setClockError] = useState('');
  const mounted = useRef(true);
  const loadSequence = useRef(0);
  const clockSequence = useRef(0);
  const [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [view, setView] = useState<'train' | 'history'>('train');
  const [routineId, setRoutineId] = useState(''),
    [name, setName] = useState('Workout'),
    [exerciseId, setExerciseId] = useState(''),
    [conflict, setConflict] = useState<WorkoutSession | null>(null);
  const [rest, setRest] = useState('90'),
    [autoRest, setAutoRest] = useState(false),
    [now, setNow] = useState(0),
    [clockRevision, setClockRevision] = useState(0),
    [groups, setGroups] = useState<string[]>([]),
    [future, setFuture] = useState<string[]>([]),
    [notes, setNotes] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all'),
    [cursor, setCursor] = useState<string | null>(null),
    [audit, setAudit] = useState<Awaited<ReturnType<typeof readAudit>> | null>(null);
  const [performances, setPerformances] = useState<Performance[]>([]),
    [performanceCursor, setPerformanceCursor] = useState<string | null>(null);
  const pending = useRef<SessionCommand | null>(null),
    clock = useRef<{ server: number; local: number } | null>(null),
    lock = useRef(false);
  const device = useRef('web');
  const handledFocus = useRef<typeof focusTarget>(undefined);
  const hasDraft = () =>
    Object.entries(drafts).some(([key, value]) =>
      key.startsWith('notes:')
        ? value.notes !== (session?.items.find((item) => `notes:${item.id}` === key)?.notes ?? '')
        : !!value.setId ||
          !!value.notes ||
          !!value.round ||
          Object.values(value.values).some((v) => v !== ''),
    ) ||
    (!!session && notes !== session.notes);
  const startAllowed = useRef(false);
  startAllowed.current = active && !busy && !pending.current && !hasDraft();
  useEffect(() => {
    if (!focusTarget || !loaded || busy || handledFocus.current === focusTarget) return;
    handledFocus.current = focusTarget;
    if (pending.current || hasDraft()) {
      setNotice('Save or clear the current workout draft before opening another workout.');
      return;
    }
    setView('train');
    if (focusTarget.action === 'create' && focusTarget.routineId) {
      if (sessions.some((value) => value.status === 'active')) {
        setNotice('Finish the current workout before starting another.');
        return;
      }
      let active = true;
      const intent = focusTarget;
      void request(`/api/routines/${intent.routineId}`, RoutineResponseSchema)
        .then(({ routine }) => {
          if (!active || !startAllowed.current) return;
          if (routine.archivedAt) {
            setNotice('This routine is archived. Choose another routine.');
            return;
          }
          return run(
            SessionCommandSchema.parse({
              type: 'session.start',
              operationId: crypto.randomUUID(),
              sessionId: crypto.randomUUID(),
              expectedRevision: 0,
              name: routine.name,
              routineId: routine.id,
              expectedRoutineRevision: routine.revision,
            }),
          );
        })
        .catch((error) => {
          if (active) setNotice(errorText(error, 'Unable to read this routine. Try Start again.'));
        });
      return () => {
        active = false;
      };
    }
    if (!focusTarget.id || session?.id === focusTarget.id) return;
    let active = true;
    void request(`/api/sessions/${focusTarget.id}`, SessionResponseSchema)
      .then((result) => {
        if (!active) return;
        setSession(result.session);
        setSelected(result.session.items[0]?.id ?? '');
        setNotes(result.session.notes);
        setAudit(null);
      })
      .catch((error) => {
        if (active) setNotice(errorText(error, 'Unable to open this workout.'));
      });
    return () => {
      active = false;
    };
  }, [focusTarget, loaded, busy]);
  async function readAudit(id: string, cursor?: string) {
    return request(
      `/api/sessions/${id}/history${cursor ? `?cursor=${cursor}` : ''}`,
      SessionHistorySchema,
    );
  }
  async function load(more = false) {
    const sequence = ++loadSequence.current;
    try {
      const response = await fetch(`/api/sessions${more && cursor ? `?cursor=${cursor}` : ''}`, {
        credentials: 'include',
      });
      if (!response.ok)
        throw new RequestError(response.status, 'Workout history could not be loaded.');
      if (!mounted.current || sequence !== loadSequence.current) return;
      void syncClock().catch(() => {});
      const data = SessionListSchema.parse(await response.json());
      const [rs, es, activeData] = await Promise.all([
        request('/api/routines', RoutineListResponseSchema),
        request('/api/exercises', ExerciseListResponseSchema),
        request('/api/sessions?status=active', SessionListSchema),
      ]);
      if (!mounted.current || sequence !== loadSequence.current) return;
      setSessions((previous) =>
        more
          ? [
              ...previous,
              ...data.sessions.filter((value) => !previous.some((old) => old.id === value.id)),
            ]
          : data.sessions,
      );
      setCursor(data.nextCursor);
      setRoutines(rs.routines);
      setExercises(es.exercises);
      setLoaded(true);
      if (!more) {
        const active = activeData.sessions[0];
        if (active && !data.sessions.some((value) => value.id === active.id))
          setSessions((values) => [active, ...values]);
        if (active) {
          setSession(active);
          setSelected(
            (previous) =>
              previous || active.items.find((item) => item.status !== 'removed')?.id || '',
          );
          setNotes(active.notes);
        }
      }
    } catch (error) {
      if (!mounted.current || sequence !== loadSequence.current) return;
      setNotice(error instanceof Error ? error.message : 'Unable to open workouts.');
    }
  }
  async function refreshLibrary() {
    try {
      const [rs, es] = await Promise.all([
        request('/api/routines', RoutineListResponseSchema),
        request('/api/exercises', ExerciseListResponseSchema),
      ]);
      setRoutines(rs.routines);
      setExercises(es.exercises);
    } catch (error) {
      setNotice(errorText(error, 'Unable to refresh the workout library.'));
    }
  }
  async function syncClock() {
    const sequence = ++clockSequence.current;
    const started = performance.now();
    try {
      const data = await request('/api/sessions/clock', z.object({ now: z.iso.datetime() }));
      if (!mounted.current || sequence !== clockSequence.current) return;
      clock.current = { server: Date.parse(data.now), local: (started + performance.now()) / 2 };
      setNow(performance.now());
      setClockRevision((value) => value + 1);
      setClockError('');
    } catch (error) {
      if (mounted.current && sequence === clockSequence.current)
        setClockError('Timer time could not be refreshed. Check your connection and retry.');
      throw error;
    }
  }
  useEffect(() => {
    mounted.current = true;
    device.current = crypto.randomUUID();
    try {
      device.current = localStorage.getItem('workout-device') || device.current;
      localStorage.setItem('workout-device', device.current);
    } catch {
      /* Recording remains available when browser storage is blocked. */
    }
    void load();
    const wake = () => void syncClock().catch(() => {});
    window.addEventListener('focus', wake);
    return () => {
      mounted.current = false;
      loadSequence.current += 1;
      clockSequence.current += 1;
      window.removeEventListener('focus', wake);
    };
  }, []);
  useEffect(() => {
    const timer = session?.timer;
    if (!active || timer?.state !== 'running' || !clock.current) return;
    const tick = () => {
      const current = performance.now();
      setNow(current);
      const basis = clock.current!;
      return timerRemaining(timer, new Date(basis.server + current - basis.local).toISOString());
    };
    if (tick() === 0) return;
    const id = window.setInterval(() => {
      if (tick() === 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [active, session?.timer, clockRevision]);
  const command = (change: Record<string, unknown>) =>
    SessionCommandSchema.parse({
      operationId: crypto.randomUUID(),
      sessionId: session?.id,
      expectedRevision: session?.revision,
      ...change,
    });
  async function run(cmd: SessionCommand, retry = false): Promise<WorkoutSession | null> {
    if (lock.current || (pending.current && !retry) || conflict) return null;
    lock.current = true;
    setBusy(true);
    pending.current = cmd;
    setNotice('');
    try {
      const response = await request('/api/sessions/commands', SessionCommandResponseSchema, {
        method: 'POST',
        body: JSON.stringify(cmd),
      });
      pending.current = null;
      if (
        cmd.type === 'session.record-set' ||
        cmd.type === 'session.correct-set' ||
        cmd.type === 'session.remove-set'
      )
        setDrafts((values) => ({ ...values, [cmd.itemId]: fresh() }));
      if (cmd.type === 'session.set-notes' && cmd.itemId !== null)
        setDrafts((values) => {
          const next = { ...values };
          delete next[`notes:${cmd.itemId}`];
          return next;
        });
      setSession(response.session);
      if (cmd.type === 'session.start' || (cmd.type === 'session.set-notes' && cmd.itemId === null))
        setNotes(response.session.notes);
      setSessions((values) => [
        response.session,
        ...values.filter((value) => value.id !== response.session.id),
      ]);
      if (cmd.type === 'session.start' || !selected)
        setSelected(response.session.items[0]?.id || '');
      if (cmd.type === 'session.add-exercise' || cmd.type === 'session.substitute-exercise')
        setSelected(cmd.itemId);
      return response.session;
    } catch (error) {
      if (error instanceof RequestError && error.status >= 400 && error.status < 500) {
        pending.current = null;
        if (error.status === 409) {
          try {
            if (cmd.type === 'session.update-routine') {
              const currentRoutines = await request('/api/routines', RoutineListResponseSchema);
              setRoutines(currentRoutines.routines);
            }
            if (cmd.type === 'session.start') {
              const current = await request('/api/sessions?status=active', SessionListSchema);
              if (current.sessions[0]) setConflict(current.sessions[0]);
              await refreshLibrary();
            } else {
              const current = await request(
                `/api/sessions/${cmd.sessionId}`,
                SessionResponseSchema,
              );
              setConflict(current.session);
            }
          } catch {}
          setNotice(
            'This workout changed elsewhere. Review the saved results and your draft before trying again.',
          );
        } else setNotice(error.message);
      } else
        setNotice(
          error instanceof Error ? error.message : 'Change not confirmed. Retry the same change.',
        );
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const safeRun = (change: Record<string, unknown>) => {
    try {
      void run(command(change));
    } catch (error) {
      setNotice(errorText(error, 'Check the entered values.'));
    }
  };
  const item = session?.items.find((value) => value.id === selected),
    draft = item ? drafts[item.id] || fresh() : fresh();
  const update = (change: Partial<Draft>) =>
    item &&
    setDrafts((values) => ({
      ...values,
      [item.id]: {
        weightUnit: preferences.weightUnit,
        distanceUnit: preferences.distanceUnit,
        ...(values[item.id] || fresh()),
        ...change,
      },
    }));
  const inputPreferences = {
    ...preferences,
    weightUnit: draft.weightUnit || preferences.weightUnit,
    distanceUnit: draft.distanceUnit || preferences.distanceUnit,
  };
  const editable = session?.status === 'active',
    disabled = busy || !!pending.current || !!conflict;
  const visible = session?.items.filter((value) => value.status !== 'removed') || [];
  async function record() {
    if (!item) return;
    try {
      const measurements = { ...empty(item.snapshot.mode) } as unknown as Record<string, unknown>;
      for (const key of fields(item)) {
        const raw = draft.values[key];
        const value = raw === undefined || raw === '' ? null : Number(raw);
        measurements[key] =
          value === null
            ? null
            : ['loadKg', 'addedLoadKg'].includes(key)
              ? weightToKg(value, inputPreferences.weightUnit)
              : key === 'distanceMeters'
                ? distanceToMeters(value, inputPreferences.distanceUnit)
                : value;
      }
      if (['weighted', 'bodyweight'].includes(item.snapshot.mode) && measurements.reps === null)
        throw new Error('Record the repetitions you performed.');
      if (item.snapshot.mode === 'timed' && measurements.durationSeconds === null)
        throw new Error('Record the time you performed.');
      if (
        item.snapshot.mode === 'distance' &&
        measurements.distanceMeters === null &&
        measurements.durationSeconds === null
      )
        throw new Error('Record actual distance or time.');
      const cmd = command({
        type: draft.setId ? 'session.correct-set' : 'session.record-set',
        itemId: item.id,
        setId: draft.setId || crypto.randomUUID(),
        kind: draft.kind,
        measurements,
        notes: draft.notes,
        round: draft.round ? Number(draft.round) : null,
        ...(draft.setId ? { reason: draft.reason } : {}),
      });
      const saved = await run(cmd);
      if (saved) {
        setDrafts((values) => ({ ...values, [item.id]: fresh() }));
        if (autoRest && saved.status === 'active') {
          await run(
            SessionCommandSchema.parse({
              operationId: crypto.randomUUID(),
              sessionId: saved.id,
              expectedRevision: saved.revision,
              type: 'session.timer',
              action: 'start',
              timerId: crypto.randomUUID(),
              kind: 'rest',
              durationSeconds: Number(rest),
              deviceId: device.current,
              itemId: item.id,
            }),
          );
        }
      }
    } catch (error) {
      setNotice(errorText(error, 'Check your measurements.'));
    }
  }
  function timer(
    action: 'start' | 'pause' | 'resume' | 'reset' | 'cancel',
    kind: 'rest' | 'exercise' = 'rest',
  ) {
    safeRun({
      type: 'session.timer',
      action,
      timerId: action === 'start' ? crypto.randomUUID() : session?.timer?.id,
      kind: action === 'start' ? kind : session?.timer?.kind || kind,
      durationSeconds:
        action === 'start' ? Number(rest) : session?.timer?.durationSeconds || Number(rest),
      deviceId: device.current,
      itemId: item?.id || null,
    });
  }
  const remaining = session?.timer
    ? clock.current
      ? timerRemaining(
          session.timer,
          new Date(
            clock.current.server + (now || performance.now()) - clock.current.local,
          ).toISOString(),
        )
      : session.timer.remainingSeconds
    : null;
  const timerFinished =
    !!session?.timer &&
    (session.timer.state === 'finished' ||
      ((!!clock.current || session.timer.state === 'paused') && remaining === 0));
  const currentReadSelection = useRef('');
  currentReadSelection.current = `${session?.id}:${session?.revision}:${item?.exerciseId}`;
  const performanceLoading = useRef(false);
  const auditGeneration = useRef(0);
  async function loadPerformance(more = false) {
    if (!item || performanceLoading.current) return;
    performanceLoading.current = true;
    const selection = currentReadSelection.current;
    try {
      const data = await request(
        `/api/exercises/${item.exerciseId}/performance${more && performanceCursor ? `?cursor=${performanceCursor}` : ''}`,
        ExercisePerformanceResponseSchema,
      );
      if (selection !== currentReadSelection.current) return;
      setPerformances((values) => (more ? [...values, ...data.performances] : data.performances));
      setPerformanceCursor(data.nextCursor);
    } catch (error) {
      if (selection === currentReadSelection.current)
        setNotice(
          error instanceof Error ? error.message : 'Previous performance could not be loaded.',
        );
    } finally {
      performanceLoading.current = false;
    }
  }
  async function showAudit(more = false) {
    if (!session) return;
    const selection = currentReadSelection.current;
    const generation = ++auditGeneration.current;
    try {
      const data = await readAudit(session.id, more ? (audit?.nextCursor ?? undefined) : undefined);
      if (selection !== currentReadSelection.current || generation !== auditGeneration.current)
        return;
      setAudit({
        ...data,
        events: more && audit ? [...audit.events, ...data.events] : data.events,
      });
    } catch (error) {
      if (selection === currentReadSelection.current && generation === auditGeneration.current)
        setNotice(errorText(error, 'Workout history could not load.'));
    }
  }
  useEffect(() => {
    setAudit(null);
    auditGeneration.current++;
  }, [session?.id, session?.revision]);
  const performanceVersion = item?.results
    .map((set) => `${set.id}:${set.correctedAt}:${set.removedAt}`)
    .join('|');
  useEffect(() => {
    let cancelled = false;
    setPerformances([]);
    setPerformanceCursor(null);
    if (item)
      void request(
        `/api/exercises/${item.exerciseId}/performance`,
        ExercisePerformanceResponseSchema,
      )
        .then((data) => {
          if (!cancelled) {
            setPerformances(data.performances);
            setPerformanceCursor(data.nextCursor);
          }
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item?.exerciseId, session?.status, performanceVersion]);
  const previous = item
    ? performances
        .filter((value) => value.status === 'completed' && value.sessionId !== session?.id)
        .flatMap((value) =>
          value.items
            .filter(
              (old) =>
                old.exerciseId === item.exerciseId &&
                old.snapshot.mode === item.snapshot.mode &&
                old.snapshot.supportsLoad === item.snapshot.supportsLoad,
            )
            .map((old) => ({
              session: { id: value.sessionId, startedAt: value.startedAt },
              item: old,
            })),
        )
        .filter((value) => value.item.results.some((set) => !set.removedAt))
    : [];

  return (
    <section className="session-area">
      <div className="segmented">
        {view === 'history' && (
          <button className="secondary" onClick={() => setView('train')}>
            Current workout
          </button>
        )}
        <button
          aria-pressed={view === 'history'}
          className="secondary"
          onClick={() => setView('history')}
        >
          Workout history
        </button>
      </div>
      {notice && (
        <div role="status" className="notice">
          <p>{notice}</p>
          {pending.current && (
            <button
              disabled={busy}
              onClick={() => pending.current && void run(pending.current, true)}
            >
              Retry the same change
            </button>
          )}
        </div>
      )}
      {hasDraft() && (
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => {
            setDrafts({});
            setNotes(session?.notes ?? '');
          }}
        >
          Discard workout draft
        </button>
      )}
      {!loaded && <button onClick={() => void load()}>Load workouts</button>}
      {conflict && (
        <section className="session-card conflict">
          <h3>Review current results against your draft</h3>
          <p>Saved revision {conflict.revision}; your draft is retained below.</p>
          {conflict.items.map((value) => (
            <div key={value.id}>
              <h4>
                {value.snapshot.name} · {value.status}
              </h4>
              {value.results
                .filter((set) => !set.removedAt)
                .map((set) => (
                  <p key={set.id}>
                    {set.kind} · {resultText(set.measurements, preferences)} ·{' '}
                    {set.notes || 'No notes'}
                  </p>
                ))}
            </div>
          ))}
          <button
            onClick={() => {
              setSession(conflict);
              if (!conflict.items.some((value) => value.id === selected))
                setSelected(conflict.items[0]?.id || '');
              setConflict(null);
              setNotice(
                'Saved results loaded. Review your retained draft, then submit a new change.',
              );
            }}
          >
            Use current results; keep my draft for review
          </button>
        </section>
      )}
      {view === 'train' && !session && (
        <form
          className="session-card start-workout"
          onSubmit={(event) => {
            event.preventDefault();
            const routine = routines.find((value) => value.id === routineId);
            void run(
              SessionCommandSchema.parse({
                type: 'session.start',
                operationId: crypto.randomUUID(),
                sessionId: crypto.randomUUID(),
                expectedRevision: 0,
                name: routine?.name || name.trim() || 'Workout',
                routineId: routine?.id || null,
                expectedRoutineRevision: routine?.revision || null,
              }),
            );
          }}
        >
          <h3>Start a workout</h3>

          <label>
            <span>Routine</span>
            <select
              aria-label="Routine"
              value={routineId}
              onFocus={() => void refreshLibrary()}
              onChange={(event) => setRoutineId(event.target.value)}
            >
              <option value="">Empty workout</option>
              {routines.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
          {!routineId && (
            <details>
              <summary>Name workout</summary>
              <label>
                Workout name
                <input
                  maxLength={500}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            </details>
          )}
          <button disabled={disabled || !loaded}>Start workout</button>
        </form>
      )}
      {view === 'history' && (
        <section className="session-card">
          <h3>Workout history</h3>
          <label>
            Show
            <select
              value={historyFilter}
              onChange={(event) => setHistoryFilter(event.target.value)}
            >
              <option value="all">All sessions</option>
              <option value="completed">Completed</option>
              <option value="abandoned">Partial / abandoned</option>
              <option value="active">In progress</option>
            </select>
          </label>
          <div className="session-history-list">
            {sessions
              .filter((value) => historyFilter === 'all' || value.status === historyFilter)
              .map((value) => (
                <button
                  className="secondary"
                  key={value.id}
                  disabled={disabled}
                  onClick={() => {
                    if (hasDraft()) {
                      setNotice(
                        'Save or discard your workout draft before opening another session.',
                      );
                      return;
                    }
                    setDrafts({});
                    setSession(value);
                    setSelected(value.items[0]?.id || '');
                    setNotes(value.notes);
                    setView('train');
                    setAudit(null);
                  }}
                >
                  <strong>{value.name}</strong>
                  <span>
                    {new Date(value.startedAt).toLocaleString(undefined, {
                      timeZone: preferences.timeZone,
                    })}{' '}
                    · {value.status === 'abandoned' ? 'Partial / abandoned' : value.status}
                  </span>
                </button>
              ))}
          </div>
          {cursor && <button onClick={() => void load(true)}>Load older sessions</button>}
        </section>
      )}
      {view === 'train' && session && (
        <>
          {!editable && (
            <button
              className="secondary"
              onClick={() => {
                if (hasDraft()) {
                  setNotice('Save or discard the current draft first.');
                  return;
                }
                setSession(null);
                setDrafts({});
                setNotes('');
              }}
            >
              Start another workout
            </button>
          )}
          <div className="session-heading">
            <div>
              <h3>{session.name}</h3>
              <p>
                {session.status === 'abandoned' ? 'Partial / abandoned' : session.status} ·{' '}
                {new Date(session.startedAt).toLocaleDateString(undefined, {
                  timeZone: preferences.timeZone,
                })}
              </p>
            </div>
            {editable && (
              <div className="session-finish">
                {hasDraft() && <small>Save or discard the draft to finish.</small>}
                <button
                  className="secondary"
                  disabled={disabled || hasDraft()}
                  onClick={() => safeRun({ type: 'session.finish' })}
                >
                  Finish workout
                </button>
              </div>
            )}
          </div>
          <div className="session-layout">
            <nav className="session-exercises" aria-label="Workout exercises">
              {visible.map((value) => (
                <button
                  key={value.id}
                  className={selected === value.id ? '' : 'secondary'}
                  aria-pressed={selected === value.id}
                  onClick={() => setSelected(value.id)}
                >
                  <strong>{value.snapshot.name}</strong>
                  <span>
                    {activityLabel(value, session)} ·{' '}
                    {value.results.filter((set) => !set.removedAt).length} actual sets
                    {session.supersets.some((group) => group.itemIds.includes(value.id))
                      ? ' · Superset'
                      : ''}
                  </span>
                </button>
              ))}
            </nav>
            {item && (
              <article className="session-card">
                <h3>{item.snapshot.name}</h3>
                {item.replacedItemId && <p>Substituted exercise</p>}
                {session.supersets
                  .filter((group) => group.itemIds.includes(item.id))
                  .map((group) => (
                    <p key={group.id}>
                      Superset order:{' '}
                      {group.itemIds
                        .map((id) => session.items.find((value) => value.id === id)?.snapshot.name)
                        .join(' → ')}
                    </p>
                  ))}
                <section className="actual-results">
                  <h4 className={editable ? 'sr-only' : undefined}>Actual sets</h4>
                  {!item.results.filter((set) => !set.removedAt).length && (
                    <p>No performed sets recorded.</p>
                  )}
                  {item.results
                    .filter((set) => !set.removedAt)
                    .map((set, index) => (
                      <div className="actual-set" key={set.id}>
                        <p>
                          <strong>
                            {index + 1}. {set.kind === 'warmup' ? 'Warm-up' : 'Working'}
                            {set.round ? ` · round ${set.round}` : ''}
                          </strong>
                          <br />
                          {resultText(set.measurements, preferences)}
                          {set.correctedAt ? ' · Corrected' : ''}
                        </p>
                        {set.notes && <p>{set.notes}</p>}
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() => {
                            setDrafts((values) => ({
                              ...values,
                              [item.id]: {
                                kind: set.kind,
                                weightUnit: preferences.weightUnit,
                                distanceUnit: preferences.distanceUnit,
                                values: Object.fromEntries(
                                  Object.entries(set.measurements)
                                    .filter(([key]) => key !== 'mode')
                                    .map(([key, value]) => [
                                      key,
                                      value === null
                                        ? ''
                                        : String(display(key, value as number, preferences)),
                                    ]),
                                ),
                                notes: set.notes,
                                round: set.round ? String(set.round) : '',
                                setId: set.id,
                                reason: '',
                              },
                            }));
                          }}
                        >
                          Correct set {index + 1}
                        </button>
                        {draft.setId === set.id && (
                          <button
                            className="secondary"
                            disabled={disabled || !draft.reason.trim()}
                            onClick={() =>
                              safeRun({
                                type: 'session.remove-set',
                                itemId: item.id,
                                setId: set.id,
                                reason: draft.reason,
                              })
                            }
                          >
                            Remove result with reason
                          </button>
                        )}
                      </div>
                    ))}
                </section>
                {((editable && item.status !== 'removed' && item.status !== 'skipped') ||
                  draft.setId) && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void record();
                    }}
                  >
                    <fieldset disabled={disabled}>
                      <legend className={draft.setId ? undefined : 'sr-only'}>
                        {draft.setId ? 'Correct set' : 'Log set'}
                      </legend>
                      {previous[0] && (
                        <p className="previous-set-summary">
                          Previous set ·{' '}
                          {resultText(
                            previous[0].item.results.filter((set) => !set.removedAt).at(-1)!
                              .measurements,
                            preferences,
                          )}
                        </p>
                      )}
                      <div className="session-measurements">
                        {fields(item).map((key) => (
                          <label key={key}>
                            {label(key, inputPreferences)}
                            <input
                              type="number"
                              min={0}
                              step={key === 'reps' ? 1 : 'any'}
                              value={draft.values[key] || ''}
                              onChange={(event) =>
                                update({ values: { ...draft.values, [key]: event.target.value } })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <details open={!!draft.setId}>
                        <summary>Set options</summary>
                        <div className="session-inline">
                          <label>
                            Set kind
                            <select
                              value={draft.kind}
                              onChange={(event) =>
                                update({ kind: event.target.value as Draft['kind'] })
                              }
                            >
                              <option value="working">Working</option>
                              <option value="warmup">Warm-up</option>
                            </select>
                          </label>
                          {session.supersets.some((group) => group.itemIds.includes(item.id)) && (
                            <label>
                              Superset round
                              <input
                                type="number"
                                min={1}
                                max={1000}
                                step={1}
                                required
                                value={draft.round}
                                onChange={(event) => update({ round: event.target.value })}
                              />
                            </label>
                          )}
                        </div>
                        <details open={!!draft.setId}>
                          <summary>Set notes{draft.setId ? ' and correction' : ''}</summary>
                          <label>
                            Set notes
                            <textarea
                              value={draft.notes}
                              onChange={(event) => update({ notes: event.target.value })}
                            />
                          </label>
                          {draft.setId && (
                            <label>
                              Correction reason
                              <input
                                required
                                value={draft.reason}
                                onChange={(event) => update({ reason: event.target.value })}
                              />
                            </label>
                          )}
                        </details>
                      </details>
                      <button>{draft.setId ? 'Save correction' : 'Log set'}</button>
                      {draft.setId && (
                        <button type="button" className="secondary" onClick={() => update(fresh())}>
                          Cancel correction
                        </button>
                      )}
                    </fieldset>
                  </form>
                )}
                {session.timer && (
                  <section className="session-timer" aria-label="Workout timer">
                    <strong>
                      {session.timer.kind === 'rest' ? 'Rest' : 'Exercise'}
                      {timerFinished
                        ? ' finished'
                        : session.timer.state === 'running' && !clock.current
                          ? ' · Connect to refresh timer'
                          : ` · ${Math.ceil(remaining || 0)} seconds`}
                    </strong>
                    {!timerFinished && !(session.timer.state === 'running' && !clock.current) && (
                      <span>{session.timer.state}</span>
                    )}
                    {clockError && (
                      <div role="status">
                        <p>{clockError}</p>
                        <button
                          className="secondary"
                          onClick={() => void syncClock().catch(() => {})}
                        >
                          Refresh timer time
                        </button>
                      </div>
                    )}
                    {editable && (
                      <div className="session-actions">
                        {!timerFinished &&
                          (session.timer.state === 'running' ? (
                            <button disabled={disabled} onClick={() => timer('pause')}>
                              Pause timer
                            </button>
                          ) : (
                            <button disabled={disabled} onClick={() => timer('resume')}>
                              Resume timer
                            </button>
                          ))}
                        <button disabled={disabled} onClick={() => timer('reset')}>
                          Reset timer
                        </button>
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() => timer('cancel')}
                        >
                          Cancel timer
                        </button>
                      </div>
                    )}
                  </section>
                )}
                {editable && (
                  <section className="rest-controls" aria-label="Rest timer controls">
                    <button
                      className="secondary"
                      disabled={disabled || Number(rest) <= 0}
                      onClick={() => timer('start', 'rest')}
                    >
                      Start rest timer
                    </button>
                    <details>
                      <summary>Timer options</summary>
                      <label>
                        Timer duration (seconds)
                        <input
                          type="number"
                          min={1}
                          max={86400}
                          value={rest}
                          onChange={(event) => setRest(event.target.value)}
                        />
                      </label>
                      <div className="session-actions">
                        <button
                          disabled={disabled || Number(rest) <= 0}
                          onClick={() => timer('start', 'exercise')}
                        >
                          Start exercise timer
                        </button>
                      </div>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={autoRest}
                          onChange={(event) => setAutoRest(event.target.checked)}
                        />
                        Start rest timer after saving a set
                      </label>
                    </details>
                  </section>
                )}
                <details>
                  <summary>Snapshot plan · {item.targets.length} targets</summary>
                  {item.targets.length ? (
                    item.targets.map((target) => (
                      <p key={target.id}>
                        {target.kind} · {resultText(target.measurements, preferences)}
                      </p>
                    ))
                  ) : (
                    <p>No targets were planned.</p>
                  )}
                  <p>{item.notes || 'No exercise notes.'}</p>
                </details>
                <details className="previous-performance">
                  <summary>Previous sets</summary>
                  {performanceCursor && (
                    <button className="secondary" onClick={() => void loadPerformance(true)}>
                      Load older exercise performance
                    </button>
                  )}
                  {previous.length ? (
                    <>
                      <p>
                        Same exercise identity and measurement mode. Completed sessions from loaded
                        history only.
                      </p>
                      <div className="session-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Workout</th>
                              <th scope="col">Actual performance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previous.map((value) => (
                              <tr key={`${value.session.id}-${value.item.id}`}>
                                <th scope="row">
                                  {new Date(value.session.startedAt).toLocaleDateString(undefined, {
                                    timeZone: preferences.timeZone,
                                  })}
                                </th>
                                <td>
                                  {value.item.results
                                    .filter((set) => !set.removedAt)
                                    .map((set) => (
                                      <p key={set.id}>
                                        {set.kind} · {resultText(set.measurements, preferences)}
                                      </p>
                                    ))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p>No previous completed results for this exercise.</p>
                  )}
                </details>
                <details>
                  <summary>Exercise actions</summary>
                  <div className="session-actions">
                    {editable && (
                      <>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            safeRun({ type: 'session.skip-exercise', itemId: item.id })
                          }
                        >
                          Skip planned exercise
                        </button>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            safeRun({ type: 'session.remove-exercise', itemId: item.id })
                          }
                        >
                          Remove exercise from session
                        </button>
                        {[-1, 1].map((offset) => (
                          <button
                            key={offset}
                            disabled={
                              disabled ||
                              visible.indexOf(item) + offset < 0 ||
                              visible.indexOf(item) + offset >= visible.length
                            }
                            onClick={() => {
                              const ids = session.items.map((value) => value.id),
                                index = ids.indexOf(item.id),
                                other = ids.indexOf(visible[visible.indexOf(item) + offset]!.id);
                              [ids[index], ids[other]] = [ids[other]!, ids[index]!];
                              safeRun({ type: 'session.reorder-exercises', itemIds: ids });
                            }}
                          >
                            Move {offset < 0 ? 'earlier' : 'later'}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  {editable && (
                    <>
                      <label>
                        Replace with
                        <select
                          value={exerciseId}
                          onChange={(event) => setExerciseId(event.target.value)}
                        >
                          <option value="">Choose an exercise</option>
                          {exercises.map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        disabled={disabled || !exerciseId}
                        onClick={() => {
                          const replacement = exercises.find((value) => value.id === exerciseId)!;
                          safeRun({
                            type: 'session.substitute-exercise',
                            itemId: crypto.randomUUID(),
                            exerciseId,
                            expectedExerciseRevision: replacement.revision,
                            replacedItemId: item.id,
                          });
                        }}
                      >
                        Substitute in this session
                      </button>
                      <label>
                        Exercise notes
                        <textarea
                          disabled={disabled}
                          value={drafts[`notes:${item.id}`]?.notes ?? item.notes}
                          onChange={(event) =>
                            setDrafts((values) => ({
                              ...values,
                              [`notes:${item.id}`]: { ...fresh(), notes: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <button
                        disabled={disabled}
                        onClick={() =>
                          safeRun({
                            type: 'session.set-notes',
                            itemId: item.id,
                            notes: drafts[`notes:${item.id}`]?.notes ?? item.notes,
                          })
                        }
                      >
                        Save exercise notes
                      </button>
                    </>
                  )}
                </details>
              </article>
            )}
          </div>
          {editable && (
            <details className="session-card">
              <summary>Workout options</summary>{' '}
              <button
                className="secondary"
                disabled={disabled || hasDraft()}
                onClick={() => safeRun({ type: 'session.abandon' })}
              >
                Abandon partial workout
              </button>
              <label>
                Add exercise
                <select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}>
                  <option value="">Choose an exercise</option>
                  {exercises.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={disabled || !exerciseId}
                onClick={() => {
                  const exercise = exercises.find((value) => value.id === exerciseId)!;
                  safeRun({
                    type: 'session.add-exercise',
                    itemId: crypto.randomUUID(),
                    exerciseId,
                    expectedExerciseRevision: exercise.revision,
                  });
                }}
              >
                Add to workout
              </button>
              <h4>Ordered superset</h4>
              <p>Select exercises in the order you want to perform them.</p>
              {visible
                .filter((value) => value.status !== 'skipped')
                .map((value) => (
                  <label className="check-label" key={value.id}>
                    <input
                      type="checkbox"
                      checked={groups.includes(value.id)}
                      onChange={(event) =>
                        setGroups((ids) =>
                          event.target.checked
                            ? [...ids, value.id]
                            : ids.filter((id) => id !== value.id),
                        )
                      }
                    />
                    {value.snapshot.name}
                    {groups.includes(value.id) ? ` · ${groups.indexOf(value.id) + 1}` : ''}
                  </label>
                ))}
              <button
                disabled={disabled || groups.length < 2}
                onClick={() =>
                  safeRun({
                    type: 'session.set-supersets',
                    supersets: [
                      ...session.supersets.filter(
                        (group) => !group.itemIds.some((id) => groups.includes(id)),
                      ),
                      { id: crypto.randomUUID(), itemIds: groups },
                    ],
                  })
                }
              >
                Save ordered superset
              </button>
              {session.supersets.length > 0 && (
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => safeRun({ type: 'session.set-supersets', supersets: [] })}
                >
                  Ungroup supersets
                </button>
              )}
            </details>
          )}
          {session.items.some((value) => value.status === 'removed') && (
            <details className="session-card">
              <summary>Removed exercises · retained actual results</summary>
              <p>
                Removing an exercise takes it out of the live order. Its recorded sets remain in
                this workout and its correction history.
              </p>
              {session.items
                .filter((value) => value.status === 'removed')
                .map((value) => (
                  <div key={value.id}>
                    <h4>{value.snapshot.name}</h4>
                    {value.results
                      .filter((set) => !set.removedAt)
                      .map((set) => (
                        <p key={set.id}>
                          {set.kind} · {resultText(set.measurements, preferences)} · {set.notes}
                        </p>
                      ))}
                  </div>
                ))}
            </details>
          )}
          <details className="session-card">
            <summary>Notes and history</summary>
            <label>
              Workout notes
              <textarea
                disabled={disabled}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <button
              disabled={disabled}
              onClick={() => safeRun({ type: 'session.set-notes', itemId: null, notes })}
            >
              Save workout notes
            </button>
            <p>
              Weighted working-set volume: {fmt(measuredWorkingVolume(session))} kg × repetitions.
              Includes saved weighted working sets with both measurements; excludes warm-ups,
              removed results and planned targets. Missing measurements are not treated as performed
              volume.
            </p>
            <button className="secondary" onClick={() => void showAudit()}>
              Show correction history
            </button>
            {audit?.events.map((event) => (
              <details key={event.id}>
                <summary>
                  {new Date(event.createdAt).toLocaleString(undefined, {
                    timeZone: preferences.timeZone,
                  })}{' '}
                  · {event.eventType} · revision {event.revision} · {event.actorId}
                </summary>
                {event.reason && <p>Reason: {event.reason}</p>}
                {event.session.items.map((value) => (
                  <div key={value.id}>
                    <strong>{value.snapshot.name}</strong>
                    {value.results.map((set) => (
                      <p key={set.id}>
                        {set.kind} · {resultText(set.measurements, preferences)}
                        {set.removedAt ? ' · Removed result' : ''} · {set.notes}
                      </p>
                    ))}
                  </div>
                ))}
              </details>
            ))}
            {audit?.nextCursor && (
              <button onClick={() => void showAudit(true)}>Load older changes</button>
            )}
          </details>
          {session.sourceRoutineId && (
            <details className="session-card">
              <summary>Update routine</summary>
              <p>
                Choose the exercises to use in the future plan. This changes the reusable routine,
                while saved workout results remain intact. The selected exercises replace the
                routine's exercise list, in session order; unchecked exercises are left out of the
                future plan. Planned targets are copied; actual results never become targets
                automatically.
              </p>
              {visible.map((value) => (
                <label className="check-label" key={value.id}>
                  <input
                    type="checkbox"
                    checked={future.includes(value.id)}
                    onChange={(event) =>
                      setFuture((ids) =>
                        event.target.checked
                          ? [...ids, value.id]
                          : ids.filter((id) => id !== value.id),
                      )
                    }
                  />
                  {value.snapshot.name}
                </label>
              ))}
              <button
                disabled={disabled || future.length === 0}
                onClick={() => {
                  const routine = routines.find((value) => value.id === session.sourceRoutineId);
                  if (!routine) {
                    setNotice('Reload the routine library before updating this plan.');
                    return;
                  }
                  safeRun({
                    type: 'session.update-routine',
                    routineId: routine.id,
                    expectedRoutineRevision: routine.revision,
                    content: {
                      name: routine.name,
                      notes: routine.notes,
                      items: session.items
                        .filter((value) => future.includes(value.id))
                        .map((value) => ({
                          id: value.id,
                          exerciseId: value.exerciseId,
                          snapshot: value.snapshot,
                          targets: value.targets,
                          notes: value.notes,
                        })),
                    },
                  });
                }}
              >
                Apply selected exercises to future routine
              </button>
            </details>
          )}
        </>
      )}
    </section>
  );
}
