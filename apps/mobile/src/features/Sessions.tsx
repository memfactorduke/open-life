import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  SessionCommandSchema,
  SessionListSchema,
  SessionResponseSchema,
  SessionHistorySchema,
  ExercisePerformanceResponseSchema,
  type ExercisePerformanceResponse,
  ExerciseListSchema,
  RoutineListSchema,
  RoutineResponseSchema,
  MeasurementsSchema,
  measuredWorkingVolume,
  weightToKg,
  weightFromKg,
  distanceToMeters,
  distanceFromMeters,
  type WorkoutSession,
  type SessionExercise,
  type Measurements,
  type SetResult,
  type Exercise,
  type Routine,
  type Preferences,
} from '@mems-life/domain';
import { parseSessionAcknowledgement, useOfflineRevision } from '../offline-client';
import { NetworkUnavailableError, type InstallationClient } from '../client';
import { Action, Body, Card, Choice, Disclosure, Field, Heading, ListRow, usePalette } from '../ui';
import { messageOf, numericInput, useCommand } from './helpers';
import {
  deviceIdentity,
  deviceTimerRemaining,
  reconcileTimerAlert,
  requestTimerAlertPermission,
  readTimerPreferences,
  saveTimerPreferences,
  timerHaptic,
} from '../timers';

type Draft = {
  values: Record<string, string>;
  kind: 'warmup' | 'working';
  notes: string;
  round: string;
  setId?: string;
  reason: string;
  units?: Pick<Preferences, 'weightUnit' | 'distanceUnit'>;
};
type DeviceTimer = {
  sessionId: string;
  id: string;
  kind: 'rest' | 'exercise';
  duration: number;
  remaining: number;
  deadline: number | null;
  status: 'running' | 'paused';
};
const emptyDraft = (): Draft => ({ values: {}, kind: 'working', notes: '', round: '', reason: '' });
function clearSetDraft(previous?: Draft): Draft {
  const next = emptyDraft();
  if (previous?.values.exerciseNotes !== undefined)
    next.values.exerciseNotes = previous.values.exerciseNotes;
  return next;
}
export function describeMeasurements(m: Measurements, p: Preferences): string {
  const parts: string[] = [];
  if ('reps' in m && m.reps !== null) parts.push(`${m.reps} reps`);
  const kg = m.mode === 'bodyweight' ? m.addedLoadKg : m.loadKg;
  if (kg !== null)
    parts.push(
      `${Number(weightFromKg(kg, p.weightUnit).toFixed(2))} ${p.weightUnit}${m.mode === 'bodyweight' ? ' added' : ''}`,
    );
  if ('durationSeconds' in m && m.durationSeconds !== null) parts.push(`${m.durationSeconds} sec`);
  if ('distanceMeters' in m && m.distanceMeters !== null)
    parts.push(
      `${Number(distanceFromMeters(m.distanceMeters, p.distanceUnit).toFixed(3))} ${p.distanceUnit}`,
    );
  return parts.join(' · ') || 'No measurements recorded';
}
function toDraft(set: SetResult, p: Preferences): Draft {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(set.measurements))
    if (key !== 'mode' && value !== null) {
      const n = Number(value);
      values[key] = String(
        key === 'loadKg' || key === 'addedLoadKg'
          ? Number(weightFromKg(n, p.weightUnit).toFixed(4))
          : key === 'distanceMeters'
            ? Number(distanceFromMeters(n, p.distanceUnit).toFixed(4))
            : n,
      );
    }
  return {
    values,
    kind: set.kind,
    notes: set.notes,
    round: set.round === null ? '' : String(set.round),
    setId: set.id,
    reason: '',
    units: { weightUnit: p.weightUnit, distanceUnit: p.distanceUnit },
  };
}
export function measurementsFromDraft(
  item: SessionExercise,
  values: Record<string, string>,
  p: Preferences,
): Measurements {
  const mode = item.snapshot.mode;
  const reps = () => numericInput(values.reps ?? '', 'Repetitions', true);
  const weight = (key: string) => {
    const n = numericInput(values[key] ?? '', 'Load');
    return n === null ? null : weightToKg(n, p.weightUnit);
  };
  const duration = () => numericInput(values.durationSeconds ?? '', 'Duration');
  return MeasurementsSchema.parse(
    mode === 'weighted'
      ? { mode, reps: reps(), loadKg: weight('loadKg') }
      : mode === 'bodyweight'
        ? {
            mode,
            reps: reps(),
            addedLoadKg: item.snapshot.supportsLoad ? weight('addedLoadKg') : null,
          }
        : mode === 'timed'
          ? {
              mode,
              durationSeconds: duration(),
              loadKg: item.snapshot.supportsLoad ? weight('loadKg') : null,
            }
          : {
              mode,
              durationSeconds: duration(),
              distanceMeters: (() => {
                const n = numericInput(values.distanceMeters ?? '', 'Distance');
                return n === null ? null : distanceToMeters(n, p.distanceUnit);
              })(),
              loadKg: item.snapshot.supportsLoad ? weight('loadKg') : null,
            },
  );
}

export function Sessions({
  client,
  preferences,
  focusTarget,
}: {
  focusTarget?: { id?: string; routineId?: string; action?: 'create' | 'capture' };
  client: InstallationClient;
  preferences: Preferences;
}) {
  const offlineRevision = useOfflineRevision(client);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]),
    [session, setSession] = useState<WorkoutSession | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]),
    [exercises, setExercises] = useState<Exercise[]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [name, setName] = useState('Workout');
  const [selected, setSelected] = useState<string | null>(null),
    [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [picker, setPicker] = useState<'add' | 'substitute' | null>(null),
    [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<'finish' | 'abandon' | null>(null),
    [notes, setNotes] = useState<string | null>(null);
  const [group, setGroup] = useState<string[]>([]),
    [showGroups, setShowGroups] = useState(false);
  const [routineChoices, setRoutineChoices] = useState<string[]>([]),
    [showRoutineUpdate, setShowRoutineUpdate] = useState(false);
  const [history, setHistory] = useState<ReturnType<typeof SessionHistorySchema.parse>['events']>(
    [],
  );
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const historySequence = useRef(0);
  const [performancePage, setPerformancePage] = useState<ExercisePerformanceResponse>({
    performances: [],
    nextCursor: null,
  });
  const [performanceLoadedKey, setPerformanceLoadedKey] = useState('');
  const [performanceError, setPerformanceError] = useState('');
  const [performanceBusy, setPerformanceBusy] = useState(false);
  const performanceSequence = useRef(0);
  const [filter, setFilter] = useState(''),
    [area, setArea] = useState<'session' | 'history'>('session');
  const [deviceId, setDeviceId] = useState(''),
    [alerts, setAlerts] = useState(false),
    [sound, setSound] = useState(false),
    [haptics, setHaptics] = useState(false);
  const [alertsReady, setAlertsReady] = useState(false);
  const alerted = useRef(new Set<string>());
  const [alertMessage, setAlertMessage] = useState(''),
    [rest, setRest] = useState('90'),
    [autoRest, setAutoRest] = useState(false);
  const [seconds, setSeconds] = useState(0),
    [clockReady, setClockReady] = useState(false);
  const clock = useRef<{ server: number; monotonic: number } | null>(null);
  const pendingAction = useRef<{ type: string; extra: Record<string, unknown> } | null>(null);
  const sessionIdentity = useRef<string | null>(null);
  sessionIdentity.current = session?.id ?? null;
  const loadSequence = useRef(0);
  const command = useCommand(client);

  const { fontScale } = useWindowDimensions();
  const [paneWidth, setPaneWidth] = useState(0);
  const wide = paneWidth >= 800 && fontScale < 1.5;
  const [routineId, setRoutineId] = useState('');
  const [showRoutinePicker, setShowRoutinePicker] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const handledStart = useRef<typeof focusTarget>(undefined);
  const [deviceTimer, setDeviceTimer] = useState<DeviceTimer | null>(null);
  const [deviceSeconds, setDeviceSeconds] = useState(0);
  const [draftReady, setDraftReady] = useState(!client.offline);
  const locked = command.busy || command.pending || !draftReady;
  useEffect(() => {
    let active = true;
    if (!client.offline) {
      setDraftReady(true);
      return;
    }
    void client.offline.store
      .getDraft<{
        drafts: Record<string, Draft>;
        selected: string | null;
        notes: string | null;
        name: string;
        rest: string;
        autoRest: boolean;
        deviceTimer?: DeviceTimer | null;
      }>('workout-editor')
      .then((saved) => {
        if (!active) return;
        if (saved) {
          setDrafts(saved.drafts);
          setSelected(saved.selected);
          setNotes(saved.notes);
          setName(saved.name);
          setRest(saved.rest);
          setAutoRest(saved.autoRest);
          setDeviceTimer(saved.deviceTimer ?? null);
        }
        setDraftReady(true);
      })
      .catch((e) => setError(messageOf(e)));
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    if (!draftReady || !client.offline) return;
    void client.offline.store
      .setDraft('workout-editor', { drafts, selected, notes, name, rest, autoRest, deviceTimer })
      .catch((e) => setError(`Draft could not be saved on this device: ${messageOf(e)}`));
  }, [client, draftReady, drafts, selected, notes, name, rest, autoRest, deviceTimer]);
  useEffect(() => {
    const tick = () =>
      setDeviceSeconds(deviceTimer ? deviceTimerRemaining(deviceTimer, Date.now()) : 0);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deviceTimer]);
  async function deviceTimerAction(
    action: 'start' | 'pause' | 'resume' | 'reset' | 'cancel',
    kind: 'rest' | 'exercise' = 'rest',
    current = session,
  ) {
    if (!client.offline || !current) return;
    try {
      const duration =
        action === 'start' ? numericInput(rest, 'Timer seconds') : (deviceTimer?.duration ?? 90);
      if (action === 'start' && (!duration || duration > 86400))
        throw new Error('Timer seconds must be between 1 and 86400.');
      let next: DeviceTimer | null =
        action === 'cancel'
          ? null
          : action === 'start'
            ? {
                sessionId: current.id,
                id: Crypto.randomUUID(),
                kind,
                duration: duration!,
                remaining: duration!,
                deadline: Date.now() + duration! * 1000,
                status: 'running',
              }
            : deviceTimer;
      if (next && action === 'pause')
        next = {
          ...next,
          remaining: deviceTimerRemaining(next, Date.now()),
          deadline: null,
          status: 'paused',
        };
      if (next && action === 'resume')
        next = { ...next, deadline: Date.now() + next.remaining * 1000, status: 'running' };
      if (next && action === 'reset')
        next = {
          ...next,
          remaining: next.duration,
          deadline: Date.now() + next.duration * 1000,
          status: 'running',
        };
      await client.offline.store.setDraft('workout-editor', {
        drafts,
        selected,
        notes,
        name,
        rest,
        autoRest,
        deviceTimer: next,
      });
      setDeviceTimer(next);
      command.setError('');
    } catch (e) {
      command.setError(`Device timer could not be saved: ${messageOf(e)}`);
    }
  }
  useEffect(() => {
    if (!focusTarget?.id || !draftReady) return;
    let active = true;
    void client
      .request(`/api/sessions/${focusTarget.id}`)
      .then((raw) => {
        if (!active) return;
        const target = SessionResponseSchema.parse(raw).session;
        if (notes !== null && notes !== session?.notes && target.id !== session?.id) {
          setError(
            'Your current workout notes are retained. Save or close them before opening another workout.',
          );
          return;
        }
        accept(target);
      })
      .catch((e) => {
        if (active) setError(messageOf(e));
      });
    return () => {
      active = false;
    };
  }, [client, focusTarget, draftReady]);
  async function syncClock() {
    try {
      const raw = (await client.request('/api/sessions/clock')) as { now?: unknown };
      if (typeof raw.now !== 'string' || !Number.isFinite(Date.parse(raw.now)))
        throw new Error('Server clock unavailable.');
      clock.current = { server: Date.parse(raw.now), monotonic: performance.now() };
      setClockReady(true);
    } catch {
      setClockReady(false);
    }
  }
  async function load(more = false) {
    const sequence = ++loadSequence.current;
    const openedSession = sessionIdentity.current;
    try {
      const list = SessionListSchema.parse(
        await client.request(`/api/sessions${more && cursor ? `?cursor=${cursor}` : ''}`),
      );
      if (sequence !== loadSequence.current) return;
      setSessions((old) =>
        more
          ? [...old, ...list.sessions.filter((s) => !old.some((o) => o.id === s.id))]
          : list.sessions,
      );
      setCursor(list.nextCursor);
      if (!more) {
        const [e, r] = await Promise.all([
          client.request('/api/exercises'),
          client.request('/api/routines'),
        ]);
        if (sequence !== loadSequence.current) return;
        setExercises(ExerciseListSchema.parse(e).exercises);
        setRoutines(RoutineListSchema.parse(r).routines);
        setLibraryLoaded(true);
        const active = list.sessions.find((s) => s.status === 'active');
        if (active && sessionIdentity.current === openedSession)
          setSession((previous) =>
            !previous ||
            (previous.id === active.id &&
              previous.status === 'active' &&
              active.revision >= previous.revision)
              ? active
              : previous,
          );
      }
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }
  useEffect(() => {
    void load();
    void syncClock();
    void deviceIdentity(client.baseURL)
      .then(setDeviceId)
      .catch((e) => setAlertMessage(messageOf(e)));
    void readTimerPreferences(client.baseURL).then((p) => {
      setAlerts(p.alerts);
      setSound(p.sound);
      setHaptics(p.haptics);
      setAlertsReady(true);
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncClock();
        void load();
      }
    });
    return () => subscription.remove();
  }, [client]);
  useEffect(() => {
    if (client.offline) void load();
  }, [offlineRevision]);
  useEffect(() => {
    const tick = () => {
      const timer = session?.timer,
        basis = clock.current;
      if (!timer || !basis) {
        setSeconds(0);
        return;
      }
      const now = basis.server + performance.now() - basis.monotonic;
      setSeconds(
        timer.state === 'running' && timer.deadline
          ? Math.max(0, Math.ceil((Date.parse(timer.deadline) - now) / 1000))
          : Math.ceil(timer.remainingSeconds),
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session?.timer, clockReady]);
  useEffect(() => {
    if (!alertsReady || !deviceId || !clock.current) return;
    void reconcileTimerAlert({
      installation: client.baseURL,
      session,
      timer: session?.timer ?? null,
      deviceId,
      enabled: alerts,
      sound,
      haptics,
      serverNow: clock.current.server + performance.now() - clock.current.monotonic,
    })
      .then(setAlertMessage)
      .catch((e) => setAlertMessage(messageOf(e)));
  }, [session?.timer, session?.status, deviceId, alerts, sound, haptics, clockReady, alertsReady]);
  useEffect(() => {
    if (alertsReady)
      void saveTimerPreferences(client.baseURL, { alerts, sound, haptics }).catch((e) =>
        setAlertMessage(`Timer choices could not be saved: ${messageOf(e)}`),
      );
  }, [alertsReady, alerts, sound, haptics, client]);
  useEffect(() => {
    const timer = session?.timer;
    if (
      haptics &&
      AppState.currentState === 'active' &&
      session?.status === 'active' &&
      clockReady &&
      seconds === 0 &&
      timer?.state === 'running' &&
      timer.initiatingDeviceId === deviceId &&
      timer.deadline !== null &&
      clock.current !== null &&
      Date.parse(timer.deadline) <=
        clock.current.server + performance.now() - clock.current.monotonic &&
      !alerted.current.has(`${timer.id}:${timer.deadline}`)
    ) {
      alerted.current.add(`${timer.id}:${timer.deadline}`);
      void timerHaptic().catch(() =>
        setAlertMessage('Haptic is unavailable; the timer still works.'),
      );
    }
  }, [seconds, haptics, session?.timer, clockReady, deviceId]);
  function accept(next: WorkoutSession) {
    setSession(next);
    if (next.status !== 'active') setDeviceTimer(null);
    if (next.id !== session?.id) {
      setNotes(null);
      setHistory([]);
      setHistoryCursor(null);
      historySequence.current++;
    }
    setSessions((old) => [next, ...old.filter((s) => s.id !== next.id)]);
  }
  async function send(type: string, extra: Record<string, unknown> = {}, current = session) {
    if (!command.pending) pendingAction.current = { type, extra };
    const result = await command.send(
      '/api/sessions/commands',
      {
        type,
        sessionId: current?.id ?? Crypto.randomUUID(),
        expectedRevision: current?.revision ?? 0,
        ...extra,
      },
      parseSessionAcknowledgement,
      SessionCommandSchema.parse,
    );
    if (result) {
      accept(result.session);
      const action = pendingAction.current;
      if (
        action &&
        ['session.record-set', 'session.correct-set', 'session.remove-set'].includes(action.type) &&
        typeof action.extra.itemId === 'string'
      )
        setDrafts((old) => ({
          ...old,
          [String(action.extra.itemId)]: clearSetDraft(old[String(action.extra.itemId)]),
        }));
      if (action?.type === 'session.set-notes' && action.extra.itemId === null) setNotes(null);
      if (action && ['session.finish', 'session.abandon'].includes(action.type)) setConfirm(null);
      if (action && ['session.add-exercise', 'session.substitute-exercise'].includes(action.type))
        setPicker(null);
      if (action?.type === 'session.update-routine') setShowRoutineUpdate(false);
      if (action?.type === 'session.set-supersets') setShowGroups(false);
      pendingAction.current = null;
      return result.session;
    }
    return null;
  }
  async function startWorkout(routine?: Routine) {
    if (locked || command.pending) return;
    if (sessions.some((value) => value.status === 'active')) {
      setError('Finish the current workout before starting another.');
      return;
    }
    setArea('session');
    await send(
      'session.start',
      {
        name: routine?.name ?? (name.trim() || 'Workout'),
        routineId: routine?.id ?? null,
        expectedRoutineRevision: routine?.revision ?? null,
        ...(routine
          ? {
              itemIdentities: routine.items.map((i) => ({
                routineItemId: i.id,
                itemId: Crypto.randomUUID(),
                targets: i.targets.map((t) => ({
                  routineTargetId: t.id,
                  targetId: Crypto.randomUUID(),
                })),
              })),
            }
          : {}),
      },
      null,
    );
  }
  useEffect(() => {
    if (
      !focusTarget ||
      focusTarget.action !== 'create' ||
      !focusTarget.routineId ||
      !libraryLoaded ||
      !draftReady ||
      locked ||
      handledStart.current === focusTarget
    )
      return;
    handledStart.current = focusTarget;
    let active = true;
    const intent = focusTarget;
    void client
      .request(`/api/routines/${intent.routineId}`)
      .catch(async (error) => {
        if (!(error instanceof NetworkUnavailableError) || !client.offline) throw error;
        // Only a transport outage can use the current durable device snapshot.
        // Its revision is still checked when this offline command synchronizes.
        const current = RoutineListSchema.parse(await client.request('/api/routines'));
        const routine = current.routines.find((value) => value.id === intent.routineId);
        if (!routine) throw error;
        return { routine };
      })
      .then((raw) => {
        if (!active) return;
        const { routine } = RoutineResponseSchema.parse(raw);
        if (routine.archivedAt) {
          setError('This routine is archived. Choose another routine.');
          return;
        }
        return startWorkout(routine);
      })
      .catch((error) => {
        if (active) setError(messageOf(error));
      });
    return () => {
      active = false;
    };
  }, [focusTarget, libraryLoaded, draftReady, locked]);
  async function review() {
    if (!session) return;
    try {
      const next = SessionResponseSchema.parse(
        await client.request(`/api/sessions/${session.id}`),
      ).session;
      accept(next);
      setError(
        `Latest saved revision ${next.revision} loaded. Your unsubmitted set inputs are retained. Review the saved results before submitting again.`,
      );
    } catch (e) {
      setError(messageOf(e));
    }
  }
  const item =
    session?.items.find((i) => i.id === selected) ??
    session?.items.find((i) => i.status !== 'removed' && i.status !== 'skipped');
  const draft = item ? (drafts[item.id] ?? emptyDraft()) : emptyDraft();
  function updateDraft(change: Partial<Draft>) {
    if (item)
      setDrafts((old) => ({
        ...old,
        [item.id]: {
          ...(old[item.id] ?? emptyDraft()),
          units: old[item.id]?.units ?? {
            weightUnit: preferences.weightUnit,
            distanceUnit: preferences.distanceUnit,
          },
          ...change,
        },
      }));
  }
  const draftPreferences = { ...preferences, ...draft.units };
  async function record() {
    if (!item || !session) return;
    try {
      const measurements = measurementsFromDraft(item, draft.values, draftPreferences);
      const meaningful =
        measurements.mode === 'weighted' || measurements.mode === 'bodyweight'
          ? measurements.reps !== null
          : measurements.mode === 'timed'
            ? measurements.durationSeconds !== null
            : measurements.distanceMeters !== null || measurements.durationSeconds !== null;
      if (!meaningful)
        throw new Error('Record repetitions, duration or distance before saving an actual set.');
      const round =
        numericInput(draft.round, 'Superset round', true) ??
        (session.supersets.some((g) => g.itemIds.includes(item.id)) ? 1 : null);
      const next = await send(draft.setId ? 'session.correct-set' : 'session.record-set', {
        itemId: item.id,
        setId: draft.setId ?? Crypto.randomUUID(),
        kind: draft.kind,
        measurements,
        notes: draft.notes,
        round,
        ...(draft.setId ? { reason: draft.reason } : {}),
      });
      if (next) {
        const superset = next.supersets.find((g) => g.itemIds.includes(item.id));
        if (superset && !draft.setId) {
          const i = superset.itemIds.indexOf(item.id);
          const nextId = superset.itemIds[(i + 1) % superset.itemIds.length]!;
          setSelected(nextId);
          setDrafts((old) => ({
            ...old,
            [nextId]: {
              ...(old[nextId] ?? emptyDraft()),
              round: String((round ?? 1) + (i === superset.itemIds.length - 1 ? 1 : 0)),
            },
          }));
        }
        if (autoRest && !draft.setId) {
          if (client.offline && !clockReady) await deviceTimerAction('start', 'rest', next);
          else await timerAction('start', next);
        }
      }
    } catch (e) {
      command.setError(messageOf(e));
    }
  }
  async function timerAction(
    action: 'start' | 'pause' | 'resume' | 'reset' | 'cancel',
    current = session,
    kind: 'rest' | 'exercise' = 'rest',
  ) {
    if (!current || !deviceId) return;
    try {
      const duration =
        action === 'start'
          ? numericInput(rest, 'Timer seconds')
          : (current.timer?.durationSeconds ?? 90);
      if (action === 'start' && (!duration || duration > 86400))
        throw new Error('Timer seconds must be between 1 and 86400.');
      await send(
        'session.timer',
        {
          action,
          timerId:
            action === 'start' ? Crypto.randomUUID() : (current.timer?.id ?? Crypto.randomUUID()),
          kind: action === 'start' ? kind : (current.timer?.kind ?? kind),
          durationSeconds:
            action === 'start' ? duration : (current.timer?.durationSeconds ?? duration),
          deviceId,
          itemId: item?.id ?? null,
        },
        current,
      );
    } catch (e) {
      command.setError(messageOf(e));
    }
  }
  const performanceKey =
    item && session
      ? `${session.id}:${item.exerciseId}:${item.snapshot.mode}:${item.snapshot.supportsLoad}`
      : '';
  const currentPerformanceKey = useRef(performanceKey);
  currentPerformanceKey.current = performanceKey;
  async function loadPerformance(more = false) {
    if (!item || !session) return;
    const key = performanceKey,
      sequence = ++performanceSequence.current;
    setPerformanceBusy(true);
    setPerformanceError('');
    try {
      let nextCursor = more ? performancePage.nextCursor : null;
      const performances: ExercisePerformanceResponse['performances'] = [];
      // Skip pages with only plans/incompatible snapshots, bounded to ten requests per action.
      for (let page = 0; page < 10; page++) {
        const query = `mode=${item.snapshot.mode}&excludeSessionId=${session.id}&limit=50${nextCursor ? `&cursor=${nextCursor}` : ''}`;
        const response = ExercisePerformanceResponseSchema.parse(
          await client.request(`/api/exercises/${item.exerciseId}/performance?${query}`),
        );
        if (sequence !== performanceSequence.current || key !== currentPerformanceKey.current)
          return;
        performances.push(...response.performances);
        nextCursor = response.nextCursor;
        if (
          !nextCursor ||
          response.performances.some(
            (p) =>
              p.status !== 'active' &&
              p.items.some(
                (i) =>
                  i.snapshot.supportsLoad === item.snapshot.supportsLoad &&
                  i.results.some((r) => !r.removedAt),
              ),
          )
        )
          break;
      }
      setPerformanceLoadedKey(key);
      setPerformancePage((old) => ({
        performances: more
          ? [
              ...old.performances,
              ...performances.filter(
                (p) => !old.performances.some((o) => o.sessionId === p.sessionId),
              ),
            ]
          : performances,
        nextCursor,
      }));
    } catch (e) {
      if (sequence === performanceSequence.current && key === currentPerformanceKey.current)
        setPerformanceError(messageOf(e));
    } finally {
      if (sequence === performanceSequence.current && key === currentPerformanceKey.current)
        setPerformanceBusy(false);
    }
  }
  useEffect(() => {
    setPerformancePage({ performances: [], nextCursor: null });
    void loadPerformance();
    return () => {
      performanceSequence.current++;
    };
  }, [client, performanceKey, session?.revision]);
  async function loadHistory(more = false) {
    if (!session) return;
    const id = session.id,
      sequence = ++historySequence.current;
    try {
      const response = SessionHistorySchema.parse(
        await client.request(
          `/api/sessions/${id}/history${more && historyCursor ? `?cursor=${historyCursor}` : ''}`,
        ),
      );
      if (sequence !== historySequence.current || sessionIdentity.current !== id) return;
      setHistory((old) =>
        more
          ? [...old, ...response.events.filter((e) => !old.some((o) => o.id === e.id))]
          : response.events,
      );
      setHistoryCursor(response.nextCursor);
    } catch (e) {
      if (sequence === historySequence.current && sessionIdentity.current === id)
        setError(messageOf(e));
    }
  }
  const comparablePerformances =
    performanceLoadedKey === performanceKey
      ? performancePage.performances
          .filter((p) => p.status !== 'active')
          .map((p) => ({
            ...p,
            items: p.items.filter(
              (i) =>
                i.exerciseId === item?.exerciseId &&
                i.snapshot.mode === item?.snapshot.mode &&
                i.snapshot.supportsLoad === item?.snapshot.supportsLoad,
            ),
          }))
          .filter((p) => p.items.some((i) => i.results.some((r) => !r.removedAt)))
      : [];
  const previous = comparablePerformances
    .filter((p) => p.status !== 'active')
    .flatMap((p) =>
      p.items
        .filter(
          (i) =>
            i.snapshot.mode === item?.snapshot.mode &&
            i.snapshot.supportsLoad === item?.snapshot.supportsLoad,
        )
        .flatMap((i) =>
          i.results.filter((r) => !r.removedAt).map((result) => ({ performance: p, result })),
        ),
    );
  const performanceView = (
    <>
      {performanceBusy && <Body>Loading previous sets…</Body>}
      {!!performanceError && <Body error>{performanceError}</Body>}
      {!performanceBusy && !performanceError && !previous.length && <Body>No previous sets.</Body>}
      {previous.map(({ performance: s, result: r }) => (
        <Body key={r.id}>
          Previous · {new Date(s.startedAt).toLocaleDateString()} · {r.kind}:{' '}
          {describeMeasurements(r.measurements, preferences)}
          {r.correctedAt ? ' · corrected' : ''}
          {s.status === 'abandoned' ? ' · Partial / abandoned' : ' · completed'}
        </Body>
      ))}
      {comparablePerformances.map((p) => (
        <Body key={p.sessionId}>
          {new Date(p.startedAt).toLocaleDateString()} ·{' '}
          {p.status === 'abandoned' ? 'Partial / abandoned' : 'Completed'} · Measured weighted
          working-set volume:{' '}
          {Number(
            p.items
              .reduce(
                (total, i) =>
                  total +
                  i.results.reduce(
                    (sum, r) =>
                      sum +
                      (!r.removedAt &&
                      r.kind === 'working' &&
                      r.measurements.mode === 'weighted' &&
                      r.measurements.reps !== null &&
                      r.measurements.loadKg !== null
                        ? r.measurements.reps * r.measurements.loadKg
                        : 0),
                    0,
                  ),
                0,
              )
              .toFixed(2),
          )}{' '}
          kg-repetitions. Actual reps × kg; excludes plans, warm-ups, removed sets and missing
          measurements.
        </Body>
      ))}
      {performancePage.nextCursor && (
        <Action
          title="Load older exercise performance"
          secondary
          disabled={performanceBusy}
          onPress={() => void loadPerformance(true)}
        />
      )}
      {!!performanceError && (
        <Action
          title="Retry exercise performance"
          secondary
          disabled={performanceBusy}
          onPress={() => void loadPerformance()}
        />
      )}
    </>
  );
  const active = session?.status === 'active';
  const usingDeviceTimer = !!client.offline && !clockReady;
  const timerView = active && session && (
    <Card>
      <Heading compact>Rest timer</Heading>
      {session.timer && (
        <View style={styles.timerRow}>
          <Body>
            {session.timer.kind === 'rest' ? 'Rest' : 'Exercise'} ·{' '}
            {clockReady
              ? `${seconds}s`
              : `${Math.ceil(session.timer.remainingSeconds)}s · needs connection`}{' '}
            · {session.timer.state}
          </Body>
          <Action
            title={session.timer.state === 'running' ? 'Pause timer' : 'Resume timer'}
            compact
            secondary
            disabled={locked}
            onPress={() =>
              void timerAction(session.timer!.state === 'running' ? 'pause' : 'resume')
            }
          />
          <Action
            title="Cancel timer"
            compact
            variant="quiet"
            disabled={locked}
            onPress={() => void timerAction('cancel')}
          />
        </View>
      )}
      {deviceTimer?.sessionId === session.id && (
        <View style={styles.timerRow}>
          <Body>
            Device {deviceTimer.kind} · {deviceSeconds}s · {deviceTimer.status}
          </Body>
          <Action
            title={deviceTimer.status === 'running' ? 'Pause device timer' : 'Resume device timer'}
            compact
            secondary
            disabled={locked}
            onPress={() =>
              void deviceTimerAction(deviceTimer.status === 'running' ? 'pause' : 'resume')
            }
          />
          <Action
            title="Cancel device timer"
            compact
            variant="quiet"
            disabled={locked}
            onPress={() => void deviceTimerAction('cancel')}
          />
        </View>
      )}
      <Action
        title="Start rest timer"
        compact
        secondary
        disabled={locked || (!usingDeviceTimer && !clockReady)}
        onPress={() => void (usingDeviceTimer ? deviceTimerAction('start') : timerAction('start'))}
      />
      {usingDeviceTimer && <Body>Saved on this device.</Body>}
      <Disclosure title="Timer options">
        <Field
          label="Timer seconds"
          keyboardType="number-pad"
          editable={!locked}
          value={rest}
          onChangeText={setRest}
        />
        <Choice
          label="Auto rest after new actual set"
          value={autoRest ? 'yes' : 'no'}
          disabled={locked}
          onChange={(v) => setAutoRest(v === 'yes')}
          options={[
            { value: 'no', label: 'Manual rest' },
            { value: 'yes', label: 'Auto rest' },
          ]}
        />
        <Action
          title="Start exercise timer"
          compact
          secondary
          disabled={locked || (!usingDeviceTimer && !clockReady)}
          onPress={() =>
            void (usingDeviceTimer
              ? deviceTimerAction('start', 'exercise')
              : timerAction('start', session, 'exercise'))
          }
        />
        {session.timer && (
          <Action
            title="Reset timer"
            compact
            secondary
            disabled={locked}
            onPress={() => void timerAction('reset')}
          />
        )}
        {deviceTimer?.sessionId === session.id && (
          <Action
            title="Reset device timer"
            compact
            secondary
            disabled={locked}
            onPress={() => void deviceTimerAction('reset')}
          />
        )}
      </Disclosure>
      <Disclosure title="Alerts">
        <Choice
          label="Timer notification"
          value={alerts ? 'yes' : 'no'}
          onChange={(v) => {
            setAlerts(v === 'yes');
            if (v === 'yes')
              void requestTimerAlertPermission()
                .then(setError)
                .catch((e) => setError(messageOf(e)));
          }}
          options={[
            { value: 'no', label: 'Off' },
            { value: 'yes', label: 'Enable alerts' },
          ]}
        />
        <Choice
          label="Timer sound"
          value={sound ? 'yes' : 'no'}
          onChange={(v) => setSound(v === 'yes')}
          options={[
            { value: 'no', label: 'Silent' },
            { value: 'yes', label: 'Sound' },
          ]}
        />
        <Choice
          label="Foreground haptic"
          value={haptics ? 'yes' : 'no'}
          onChange={(v) => setHaptics(v === 'yes')}
          options={[
            { value: 'no', label: 'No haptic' },
            { value: 'yes', label: 'Haptic' },
          ]}
        />
        {!!alertMessage && <Body>{alertMessage}</Body>}
      </Disclosure>
    </Card>
  );
  const list = (
    <View style={[styles.stack, wide && area === 'history' && styles.sidebar]}>
      <View style={styles.timerRow}>
        {area === 'history' && (
          <Action
            title="Current workout"
            compact
            variant="quiet"
            onPress={() => setArea('session')}
          />
        )}
        <Action
          title="Workout history"
          compact
          variant="quiet"
          onPress={() => setArea('history')}
        />
      </View>
      {!!error && <Body error>{error}</Body>}

      {!session && !sessions.some((s) => s.status === 'active') && area === 'session' && (
        <Card>
          <Heading compact>Start workout</Heading>
          <Action
            title={routines.find((r) => r.id === routineId)?.name ?? 'Empty workout'}
            secondary
            disabled={locked}
            onPress={() => setShowRoutinePicker(true)}
          />
          <Disclosure title="Name workout">
            <Field label="Session name" value={name} editable={!locked} onChangeText={setName} />
          </Disclosure>
          <Action
            title="Start workout"
            disabled={locked || !libraryLoaded}
            onPress={() => void startWorkout(routines.find((r) => r.id === routineId))}
          />
        </Card>
      )}
      {area === 'history' && (
        <Field label="Filter session or exercise history" value={filter} onChangeText={setFilter} />
      )}
      {sessions
        .filter((s) =>
          area === 'session'
            ? false
            : `${s.name} ${s.items.map((i) => i.snapshot.name).join(' ')}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
        )
        .map((s) => (
          <ListRow
            key={s.id}
            title={s.name}
            detail={`${s.status === 'abandoned' ? 'Partial workout' : s.status} · ${new Date(s.startedAt).toLocaleDateString()} · ${s.items.reduce((n, i) => n + i.results.filter((r) => !r.removedAt).length, 0)} sets`}
            selected={session?.id === s.id}
            disabled={locked}
            onPress={() => {
              setSession(s);
              setSelected(null);
              setNotes(s.notes);
              setHistory([]);
              setHistoryCursor(null);
              historySequence.current++;
            }}
          />
        ))}
      {area === 'history' && cursor && (
        <Action title="Load older sessions" secondary onPress={() => void load(true)} />
      )}
    </View>
  );
  return (
    <View
      testID="session-pane"
      style={styles.stack}
      onLayout={(event) => setPaneWidth(event.nativeEvent.layout.width)}
    >
      <View style={wide && area === 'history' ? styles.columns : styles.stack}>
        {list}
        {session && (
          <View style={[styles.stack, wide && area === 'history' && styles.detail]}>
            <Heading
              compact
              eyebrow={
                session.status === 'abandoned'
                  ? 'Partial workout'
                  : session.status === 'active'
                    ? undefined
                    : 'Completed workout'
              }
            >
              {session.name}
            </Heading>
            {active && (
              <Action
                title="Finish workout"
                secondary
                disabled={locked}
                onPress={() => setConfirm('finish')}
              />
            )}
            {!active && (
              <Action
                title="Start another workout"
                secondary
                disabled={locked}
                onPress={() => {
                  setSession(null);
                  setArea('session');
                }}
              />
            )}
            {!!command.error && <Body error>{command.error}</Body>}
            {command.pending ? (
              <Action
                title="Retry unchanged request"
                busy={command.busy}
                onPress={() => void send('session.finish')}
              />
            ) : command.error || error ? (
              <Action
                title="Review latest saved session"
                secondary
                disabled={command.busy}
                onPress={() => void review()}
              />
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.exerciseChoices}
            >
              {session.items.map((i) => (
                <Action
                  key={i.id}
                  compact
                  variant={item?.id === i.id ? 'secondary' : 'quiet'}
                  title={`${i.snapshot.name} · ${i.status} · ${i.results.filter((r) => !r.removedAt).length} sets`}
                  onPress={() => setSelected(i.id)}
                />
              ))}
            </ScrollView>
            {item && (
              <Card>
                <Heading compact>{item.snapshot.name}</Heading>
                {!!item.notes && <Body>{item.notes}</Body>}
                {!active && !draft.setId && (
                  <Disclosure title="Previous sets">{performanceView}</Disclosure>
                )}
                <Disclosure title="Planned targets">
                  {item.targets.map((t, index) => (
                    <Body key={t.id}>
                      Planned {index + 1}: {t.kind} ·{' '}
                      {describeMeasurements(t.measurements, preferences)}
                      {t.notes ? ` · ${t.notes}` : ''}
                    </Body>
                  ))}
                </Disclosure>
                {item.results.map((r, index) => (
                  <View key={r.id} style={styles.stack}>
                    <Body>
                      Actual {index + 1}: {r.kind} ·{' '}
                      {describeMeasurements(r.measurements, preferences)}
                      {r.round ? ` · Round ${r.round}` : ''}
                      {r.correctedAt ? ' · Corrected' : ''}
                      {r.removedAt ? ' · Removed' : ''}
                      {r.notes ? ` · ${r.notes}` : ''}
                    </Body>
                    {!r.removedAt && (
                      <Disclosure title={`Set ${index + 1} actions`}>
                        <Action
                          title={`Correct actual set ${index + 1}`}
                          secondary
                          disabled={locked}
                          onPress={() =>
                            setDrafts((old) => ({ ...old, [item.id]: toDraft(r, preferences) }))
                          }
                        />
                      </Disclosure>
                    )}
                  </View>
                ))}
                {(draft.setId ||
                  (item.status !== 'removed' && item.status !== 'skipped' && active)) && (
                  <>
                    {draft.setId && <Heading compact>Correct set</Heading>}
                    {previous[0] && (
                      <Body>
                        Previous set ·{' '}
                        {describeMeasurements(previous[0].result.measurements, preferences)}
                      </Body>
                    )}
                    <Disclosure title="Previous sets">{performanceView}</Disclosure>
                    <View style={styles.measurements}>
                      {(item.snapshot.mode === 'weighted' || item.snapshot.mode === 'bodyweight'
                        ? [['reps', 'Repetitions']]
                        : item.snapshot.mode === 'timed'
                          ? [['durationSeconds', 'Duration (seconds)']]
                          : [
                              ['distanceMeters', `Distance (${draftPreferences.distanceUnit})`],
                              ['durationSeconds', 'Duration (seconds)'],
                            ]
                      )
                        .concat(
                          item.snapshot.supportsLoad
                            ? [
                                [
                                  item.snapshot.mode === 'bodyweight' ? 'addedLoadKg' : 'loadKg',
                                  `${item.snapshot.mode === 'bodyweight' ? 'Added load' : 'Load'} (${draftPreferences.weightUnit})`,
                                ],
                              ]
                            : [],
                        )
                        .map(([key, label]) => (
                          <View key={key} style={styles.measurement}>
                            <Field
                              label={label!}
                              keyboardType="decimal-pad"
                              value={draft.values[key!] ?? ''}
                              editable={!locked}
                              onChangeText={(value) =>
                                updateDraft({ values: { ...draft.values, [key!]: value } })
                              }
                            />
                          </View>
                        ))}
                    </View>
                    {session.supersets.some((g) => g.itemIds.includes(item.id)) && (
                      <Field
                        label="Superset round"
                        keyboardType="number-pad"
                        editable={!locked}
                        value={draft.round}
                        onChangeText={(round) => updateDraft({ round })}
                      />
                    )}
                    <Disclosure title="Set options">
                      <Choice
                        label="Actual set type"
                        value={draft.kind}
                        disabled={locked}
                        onChange={(kind) => updateDraft({ kind })}
                        options={[
                          { value: 'working', label: 'Working' },
                          { value: 'warmup', label: 'Warm-up' },
                        ]}
                      />
                      <Field
                        label="Actual set notes"
                        value={draft.notes}
                        multiline
                        editable={!locked}
                        onChangeText={(notes) => updateDraft({ notes })}
                      />
                    </Disclosure>
                    {draft.setId && (
                      <Field
                        label="Correction reason"
                        value={draft.reason}
                        editable={!locked}
                        onChangeText={(reason) => updateDraft({ reason })}
                      />
                    )}
                    <Action
                      title={draft.setId ? 'Save correction' : 'Log set'}
                      busy={command.busy}
                      disabled={locked || (!!draft.setId && !draft.reason.trim())}
                      onPress={() => void record()}
                    />
                    {draft.setId && (
                      <>
                        <Action
                          title="Remove recorded set with reason"
                          secondary
                          disabled={locked || !draft.reason.trim()}
                          onPress={() =>
                            void send('session.remove-set', {
                              itemId: item.id,
                              setId: draft.setId,
                              reason: draft.reason,
                            }).then((next) => {
                              if (next) updateDraft(emptyDraft());
                            })
                          }
                        />
                        <Action
                          title="Cancel correction"
                          secondary
                          disabled={locked}
                          onPress={() => updateDraft(emptyDraft())}
                        />
                      </>
                    )}
                    {!draft.setId && item.results.some((r) => !r.removedAt) && (
                      <Action
                        title="Copy previous set into inputs"
                        secondary
                        disabled={locked}
                        onPress={() => {
                          const last = item.results.filter((r) => !r.removedAt).at(-1)!;
                          const copy = toDraft(last, preferences);
                          delete copy.setId;
                          updateDraft(copy);
                        }}
                      />
                    )}
                  </>
                )}
                {timerView}
                {active && (
                  <Disclosure title="Exercise options">
                    <Action
                      title="Substitute this exercise"
                      secondary
                      disabled={locked}
                      onPress={() => setPicker('substitute')}
                    />
                    <Action
                      title="Skip remaining planned activity"
                      secondary
                      disabled={locked || item.status === 'skipped' || item.status === 'removed'}
                      onPress={() => void send('session.skip-exercise', { itemId: item.id })}
                    />
                    <Action
                      title="Remove exercise from this session"
                      secondary
                      disabled={locked || item.status === 'removed'}
                      onPress={() => void send('session.remove-exercise', { itemId: item.id })}
                    />
                    <Body>Removing or skipping does not erase already recorded sets.</Body>
                    {session.items.indexOf(item) > 0 && (
                      <Action
                        title="Move exercise earlier"
                        secondary
                        disabled={locked}
                        onPress={() => {
                          const ids = session.items.map((i) => i.id),
                            index = ids.indexOf(item.id);
                          [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                          void send('session.reorder-exercises', { itemIds: ids });
                        }}
                      />
                    )}
                    <Field
                      label="Exercise session notes"
                      value={draft.values.exerciseNotes ?? item.notes}
                      editable={!locked}
                      multiline
                      onChangeText={(v) =>
                        updateDraft({ values: { ...draft.values, exerciseNotes: v } })
                      }
                    />
                    <Action
                      title="Save exercise notes"
                      secondary
                      disabled={locked}
                      onPress={() =>
                        void send('session.set-notes', {
                          itemId: item.id,
                          notes: draft.values.exerciseNotes ?? item.notes,
                        })
                      }
                    />
                  </Disclosure>
                )}
              </Card>
            )}
            {active && (
              <>
                <Action
                  title="Add exercise to session"
                  secondary
                  disabled={locked}
                  onPress={() => setPicker('add')}
                />
                {!item && timerView}
                <Disclosure title="Workout options">
                  <Field
                    label="Session notes"
                    value={notes ?? session.notes}
                    multiline
                    editable={!locked}
                    onChangeText={setNotes}
                  />
                  <Action
                    title="Save session notes"
                    secondary
                    disabled={locked}
                    onPress={() =>
                      void send('session.set-notes', {
                        itemId: null,
                        notes: notes ?? session.notes,
                      })
                    }
                  />
                  <Action
                    title="Arrange superset"
                    secondary
                    disabled={locked}
                    onPress={() => {
                      setGroup([]);
                      setShowGroups(true);
                    }}
                  />
                  {session.supersets.map((g) => (
                    <Card key={g.id}>
                      <Body>
                        Superset order:{' '}
                        {g.itemIds
                          .map((id) => session.items.find((i) => i.id === id)?.snapshot.name)
                          .join(' → ')}
                      </Body>
                      <Action
                        title="Remove superset grouping"
                        secondary
                        disabled={locked}
                        onPress={() =>
                          void send('session.set-supersets', {
                            supersets: session.supersets.filter((v) => v.id !== g.id),
                          })
                        }
                      />
                    </Card>
                  ))}
                  <Action
                    title="Abandon partial workout"
                    secondary
                    disabled={locked}
                    onPress={() => setConfirm('abandon')}
                  />
                </Disclosure>
              </>
            )}
            <Disclosure title="Workout details">
              <Action
                title="Refresh sessions"
                variant="quiet"
                compact
                disabled={locked}
                onPress={() => void load()}
              />
              <Body>
                Measured weighted working-set volume:{' '}
                {Number(measuredWorkingVolume(session).toFixed(2))} kg-repetitions. Reps × load in
                kg; excludes warm-ups, targets, removed sets and missing measurements.
              </Body>
              {session.sourceRoutineId && (
                <Action
                  title="Choose changes for future routine"
                  secondary
                  disabled={locked}
                  onPress={() => {
                    setRoutineChoices(
                      session.items
                        .filter((i) => i.status !== 'removed' && i.status !== 'skipped')
                        .map((i) => i.id),
                    );
                    setShowRoutineUpdate(true);
                  }}
                />
              )}
              <Action
                title="View correction history"
                secondary
                disabled={locked}
                onPress={() => void loadHistory()}
              />
              {historyCursor && (
                <Action
                  title="Load older correction history"
                  secondary
                  onPress={() => void loadHistory(true)}
                />
              )}
              {history.map((event) => (
                <Card key={event.id}>
                  <Body>
                    {new Date(event.createdAt).toLocaleString()} · {event.eventType} · revision{' '}
                    {event.revision} · {event.actorType === 'agent' ? 'Agent' : 'Owner'}{' '}
                    {event.actorId}
                  </Body>
                  {event.reason && <Body>Reason: {event.reason}</Body>}
                  {event.session.items.map((i) => (
                    <View key={i.id}>
                      <Body>
                        {i.snapshot.name} · {i.status}
                      </Body>
                      {i.results.map((r) => (
                        <Body key={r.id}>
                          {r.kind}: {describeMeasurements(r.measurements, preferences)}
                          {r.removedAt ? ' · removed' : ''}
                          {r.correctedAt ? ' · corrected' : ''} {r.notes}
                        </Body>
                      ))}
                    </View>
                  ))}
                </Card>
              ))}
            </Disclosure>
          </View>
        )}
      </View>
      {showRoutinePicker && (
        <Sheet title="Choose routine" onClose={() => setShowRoutinePicker(false)}>
          <Action
            title="Empty workout"
            secondary
            onPress={() => {
              setRoutineId('');
              setShowRoutinePicker(false);
            }}
          />
          {routines
            .filter((r) => !r.archivedAt)
            .map((r) => (
              <Action
                key={r.id}
                title={r.name}
                secondary
                onPress={() => {
                  setRoutineId(r.id);
                  setShowRoutinePicker(false);
                }}
              />
            ))}
          <Action title="Refresh routines" secondary onPress={() => void load()} />
        </Sheet>
      )}
      {picker && (
        <Sheet
          error={command.error}
          title={picker === 'add' ? 'Add exercise' : 'Substitute exercise'}
          onClose={() => setPicker(null)}
        >
          <Body>Changes apply to this session. Existing results keep their exercise identity.</Body>
          <Field label="Find exercise" value={search} onChangeText={setSearch} />
          {exercises
            .filter((e) => !e.archivedAt && e.name.toLowerCase().includes(search.toLowerCase()))
            .map((e) => (
              <Action
                key={e.id}
                title={`Choose ${e.name}`}
                secondary
                disabled={locked}
                onPress={() =>
                  void send(
                    picker === 'add' ? 'session.add-exercise' : 'session.substitute-exercise',
                    {
                      itemId: Crypto.randomUUID(),
                      exerciseId: e.id,
                      expectedExerciseRevision: e.revision,
                      ...(picker === 'substitute' ? { replacedItemId: item?.id } : {}),
                    },
                  ).then((next) => {
                    if (next) {
                      setSelected(next.items.at(-1)?.id ?? null);
                      setPicker(null);
                    }
                  })
                }
              />
            ))}
        </Sheet>
      )}
      {confirm && (
        <Sheet
          error={command.error}
          title={confirm === 'finish' ? 'Finish this workout?' : 'Save a partial workout?'}
          onClose={() => setConfirm(null)}
        >
          <Body>
            {confirm === 'finish'
              ? 'Only the actual sets you recorded will count. Unperformed targets remain unperformed.'
              : 'Recorded sets and notes remain in history as a partial / abandoned workout.'}
          </Body>
          <Action
            title={confirm === 'finish' ? 'Confirm finish' : 'Confirm abandon'}
            disabled={locked}
            onPress={() =>
              void send(confirm === 'finish' ? 'session.finish' : 'session.abandon').then(
                (next) => {
                  if (next) setConfirm(null);
                },
              )
            }
          />
        </Sheet>
      )}
      {showGroups && session && (
        <Sheet error={command.error} title="Ordered superset" onClose={() => setShowGroups(false)}>
          <Body>
            Select exercises in execution order. A recorded set advances to the next exercise,
            retaining its round.
          </Body>
          {session.items
            .filter((i) => i.status !== 'removed' && i.status !== 'skipped')
            .map((i) => (
              <Action
                key={i.id}
                title={`${group.includes(i.id) ? `${group.indexOf(i.id) + 1}. ` : ''}${i.snapshot.name}`}
                secondary
                disabled={locked}
                onPress={() =>
                  setGroup((old) =>
                    old.includes(i.id) ? old.filter((id) => id !== i.id) : [...old, i.id],
                  )
                }
              />
            ))}
          <Action
            title="Save superset"
            disabled={locked || group.length < 2}
            onPress={() =>
              void send('session.set-supersets', {
                supersets: [
                  ...session.supersets.filter((g) => !g.itemIds.some((id) => group.includes(id))),
                  { id: Crypto.randomUUID(), itemIds: group },
                ],
              }).then((next) => {
                if (next) setShowGroups(false);
              })
            }
          />
        </Sheet>
      )}
      {showRoutineUpdate && session && (
        <Sheet
          error={command.error}
          title="Update the future routine"
          onClose={() => setShowRoutineUpdate(false)}
        >
          <Body>
            Select exercises to keep in their session order. Only planned targets and exercise notes
            are copied; actual sets stay in this session. A changed routine revision requires
            reviewing its latest plan first.
          </Body>
          {session.items
            .filter((i) => i.status !== 'removed' && i.status !== 'skipped')
            .map((i) => (
              <Action
                key={i.id}
                title={`${routineChoices.includes(i.id) ? 'Keep' : 'Exclude'} ${i.snapshot.name}`}
                secondary
                disabled={locked}
                onPress={() =>
                  setRoutineChoices((old) =>
                    old.includes(i.id) ? old.filter((id) => id !== i.id) : [...old, i.id],
                  )
                }
              />
            ))}
          <Action
            title="Review latest future routine"
            secondary
            onPress={() =>
              void client
                .request('/api/routines')
                .then((raw) => setRoutines(RoutineListSchema.parse(raw).routines))
                .catch((e) => command.setError(messageOf(e)))
            }
          />
          {(() => {
            const routine = routines.find((r) => r.id === session.sourceRoutineId);
            return routine ? (
              <>
                <Body>
                  Future plan: {routine.name} · revision {routine.revision}
                </Body>
                {routine.items.map((i) => (
                  <Body key={i.id}>
                    Saved plan: {i.snapshot.name} · {i.targets.length} targets
                  </Body>
                ))}
                <Action
                  title="Apply selected future plan changes"
                  disabled={locked}
                  onPress={() =>
                    void send('session.update-routine', {
                      routineId: routine.id,
                      expectedRoutineRevision: routine.revision,
                      content: {
                        name: routine.name,
                        notes: routine.notes,
                        items: session.items
                          .filter((i) => routineChoices.includes(i.id))
                          .map((i) => ({
                            id: i.id,
                            exerciseId: i.exerciseId,
                            snapshot: i.snapshot,
                            targets: i.targets,
                            notes: i.notes,
                          })),
                      },
                    }).then((next) => {
                      if (next) setShowRoutineUpdate(false);
                    })
                  }
                />
              </>
            ) : (
              <Body error>Refresh routines to find the source plan.</Body>
            );
          })()}
        </Sheet>
      )}
    </View>
  );
}
function Sheet({
  title,
  onClose,
  children,
  error,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  error?: string;
}) {
  const palette = usePalette();
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      {/* A modal has its own native root; its safe-area view needs a local provider. */}
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
              <Heading compact>{title}</Heading>
              {children}
              {!!error && <Body error>{error}</Body>}
              <Action title="Close" secondary onPress={onClose} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
const styles = StyleSheet.create({
  stack: { gap: 16 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  sidebar: { width: 220, flexShrink: 0 },
  exerciseChoices: { gap: 8, flexDirection: 'row', paddingBottom: 4 },
  timerRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  measurements: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  measurement: { flex: 1, minWidth: 120 },
  detail: { flex: 1, minWidth: 0 },
  sheet: { padding: 24, gap: 18 },
});
