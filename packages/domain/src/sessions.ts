import { z } from 'zod';
import {
  ExerciseSnapshotSchema,
  MeasurementsSchema,
  RoutineTargetSchema,
  RoutineContentSchema,
  type RoutineItem,
} from './workouts.js';
const uuid = z.uuid();
const instant = z.iso.datetime();
const notes = z.string().max(20_000);
export const ActualMeasurementsSchema = MeasurementsSchema.superRefine((value, context) => {
  const meaningful =
    value.mode === 'weighted' || value.mode === 'bodyweight'
      ? value.reps !== null
      : value.mode === 'timed'
        ? value.durationSeconds !== null
        : value.distanceMeters !== null || value.durationSeconds !== null;
  if (!meaningful)
    context.addIssue({
      code: 'custom',
      message: 'Record repetitions, duration or distance before saving an actual set.',
    });
});
export const SetResultSchema = z.strictObject({
  id: uuid,
  kind: z.enum(['warmup', 'working']),
  measurements: ActualMeasurementsSchema,
  notes,
  round: z.number().int().min(1).max(1000).nullable(),
  recordedAt: instant,
  correctedAt: instant.nullable(),
  removedAt: instant.nullable(),
});
export const SessionExerciseSchema = z.strictObject({
  id: uuid,
  exerciseId: uuid,
  snapshot: ExerciseSnapshotSchema,
  targets: z.array(RoutineTargetSchema).max(100),
  notes,
  status: z.enum(['planned', 'in-progress', 'skipped', 'removed']),
  results: z.array(SetResultSchema).max(1000),
  replacedItemId: uuid.nullable(),
});
export const SessionTimerSchema = z.strictObject({
  id: uuid,
  kind: z.enum(['rest', 'exercise']),
  state: z.enum(['running', 'paused', 'finished']),
  durationSeconds: z.number().finite().positive().max(86400),
  remainingSeconds: z.number().finite().nonnegative().max(86400),
  deadline: instant.nullable(),
  updatedAt: instant,
  clockBasis: z.literal('server'),
  initiatingDeviceId: z.string().min(1).max(200),
  itemId: uuid.nullable(),
});
export const SupersetSchema = z.strictObject({ id: uuid, itemIds: z.array(uuid).min(2).max(100) });
export const SessionSchema = z
  .strictObject({
    id: uuid,
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(500),
    notes,
    status: z.enum(['active', 'completed', 'abandoned']),
    sourceRoutineId: uuid.nullable(),
    sourceRoutineRevision: z.number().int().positive().nullable(),
    items: z.array(SessionExerciseSchema).max(100),
    supersets: z.array(SupersetSchema).max(50),
    timer: SessionTimerSchema.nullable(),
    startedAt: instant,
    updatedAt: instant,
    finishedAt: instant.nullable(),
  })
  .superRefine((session, ctx) => {
    const ids = new Set<string>();
    for (const [i, item] of session.items.entries()) {
      if (ids.has(item.id))
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'id'],
          message: 'Duplicate item identity.',
        });
      ids.add(item.id);
      for (const [j, result] of item.results.entries()) {
        if (ids.has(result.id))
          ctx.addIssue({
            code: 'custom',
            path: ['items', i, 'results', j, 'id'],
            message: 'Duplicate result identity.',
          });
        ids.add(result.id);
        if (result.measurements.mode !== item.snapshot.mode)
          ctx.addIssue({
            code: 'custom',
            path: ['items', i, 'results', j],
            message: 'Result mode must match the recorded exercise.',
          });
        const load =
          result.measurements.mode === 'bodyweight'
            ? result.measurements.addedLoadKg
            : result.measurements.loadKg;
        if (!item.snapshot.supportsLoad && load !== null)
          ctx.addIssue({
            code: 'custom',
            path: ['items', i, 'results', j],
            message: 'Exercise does not support load.',
          });
      }
    }
    const grouped = new Set<string>();
    for (const group of session.supersets)
      for (const id of group.itemIds) {
        if (
          grouped.has(id) ||
          !session.items.some(
            (item) => item.id === id && item.status !== 'removed' && item.status !== 'skipped',
          )
        )
          ctx.addIssue({
            code: 'custom',
            path: ['supersets'],
            message: 'Supersets require distinct available exercises.',
          });
        grouped.add(id);
      }
    if ((session.status === 'active') !== (session.finishedAt === null))
      ctx.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Finished timestamp must match status.',
      });
  });
const base = {
  operationId: uuid,
  sessionId: uuid,
  expectedRevision: z.number().int().nonnegative(),
};
const added = {
  itemId: uuid,
  exerciseId: uuid,
  expectedExerciseRevision: z.number().int().positive(),
};
const setInput = {
  itemId: uuid,
  setId: uuid,
  kind: z.enum(['warmup', 'working']),
  measurements: ActualMeasurementsSchema,
  notes,
  round: z.number().int().min(1).max(1000).nullable(),
};
export const SessionRoutineItemIdentitySchema = z.strictObject({
  routineItemId: uuid,
  itemId: uuid,
  targets: z.array(z.strictObject({ routineTargetId: uuid, targetId: uuid })).max(100),
});
export type SessionRoutineItemIdentity = z.infer<typeof SessionRoutineItemIdentitySchema>;

/** Copy trusted routine content while preserving caller-created identities for queued commands. */
export function sessionItemsFromRoutine(
  items: RoutineItem[],
  identities: SessionRoutineItemIdentity[] | undefined,
  createId: () => string,
): SessionExercise[] {
  if (identities) {
    const ids = identities.flatMap((item) => [
      item.itemId,
      ...item.targets.map((target) => target.targetId),
    ]);
    if (new Set(ids).size !== ids.length)
      throw new Error('Session item and target identities must be unique.');
    if (
      identities.length !== items.length ||
      new Set(identities.map((item) => item.routineItemId)).size !== items.length
    )
      throw new Error('Session identities must match every source routine item.');
    for (const identity of identities) {
      const source = items.find((item) => item.id === identity.routineItemId);
      if (
        !source ||
        identity.targets.length !== source.targets.length ||
        new Set(identity.targets.map((target) => target.routineTargetId)).size !==
          source.targets.length ||
        identity.targets.some(
          (target) =>
            !source.targets.some((sourceTarget) => sourceTarget.id === target.routineTargetId),
        )
      )
        throw new Error('Session target identities must match every source routine target.');
    }
  }
  return items.map((item) => {
    const identity = identities?.find((candidate) => candidate.routineItemId === item.id);
    return {
      ...structuredClone(item),
      id: identity?.itemId ?? createId(),
      targets: item.targets.map((target) => ({
        ...structuredClone(target),
        id:
          identity?.targets.find((candidate) => candidate.routineTargetId === target.id)
            ?.targetId ?? createId(),
      })),
      status: 'planned',
      results: [],
      replacedItemId: null,
    };
  });
}
export const SessionCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('session.start'),
    expectedRevision: z.literal(0),
    name: z.string().trim().min(1).max(500),
    routineId: uuid.nullable(),
    expectedRoutineRevision: z.number().int().positive().nullable(),
    itemIdentities: z.array(SessionRoutineItemIdentitySchema).max(100).optional(),
  }),
  z.strictObject({ ...base, type: z.literal('session.add-exercise'), ...added }),
  z.strictObject({
    ...base,
    type: z.literal('session.substitute-exercise'),
    ...added,
    replacedItemId: uuid,
  }),
  z.strictObject({
    ...base,
    type: z.literal('session.reorder-exercises'),
    itemIds: z.array(uuid).max(100),
  }),
  z.strictObject({ ...base, type: z.literal('session.skip-exercise'), itemId: uuid }),
  z.strictObject({ ...base, type: z.literal('session.remove-exercise'), itemId: uuid }),
  z.strictObject({ ...base, type: z.literal('session.record-set'), ...setInput }),
  z.strictObject({
    ...base,
    type: z.literal('session.correct-set'),
    ...setInput,
    reason: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({
    ...base,
    type: z.literal('session.remove-set'),
    itemId: uuid,
    setId: uuid,
    reason: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({ ...base, type: z.literal('session.set-notes'), itemId: uuid.nullable(), notes }),
  z.strictObject({
    ...base,
    type: z.literal('session.set-supersets'),
    supersets: z.array(SupersetSchema).max(50),
  }),
  z.strictObject({
    ...base,
    type: z.literal('session.timer'),
    action: z.enum(['start', 'pause', 'resume', 'reset', 'cancel']),
    timerId: uuid,
    kind: z.enum(['rest', 'exercise']),
    durationSeconds: z.number().finite().positive().max(86400),
    deviceId: z.string().min(1).max(200),
    itemId: uuid.nullable(),
  }),
  z.strictObject({ ...base, type: z.literal('session.finish') }),
  z.strictObject({ ...base, type: z.literal('session.abandon') }),
  z.strictObject({
    ...base,
    type: z.literal('session.update-routine'),
    routineId: uuid,
    expectedRoutineRevision: z.number().int().positive(),
    content: RoutineContentSchema,
  }),
]);
export const SessionCommandResponseSchema = z.strictObject({
  operationId: uuid,
  session: SessionSchema,
  feedPosition: z.string().regex(/^\d+$/),
});
export const SessionResponseSchema = z.strictObject({ session: SessionSchema });
export const SessionListSchema = z.strictObject({
  sessions: z.array(SessionSchema),
  nextCursor: uuid.nullable(),
});
export const SessionHistorySchema = z.strictObject({
  events: z.array(
    z.strictObject({
      id: z.string(),
      operationId: uuid,
      actorId: z.string(),
      actorType: z.enum(['owner', 'agent']),
      reason: z.string().nullable(),
      eventType: z.string(),
      revision: z.number().int().positive(),
      session: SessionSchema,
      createdAt: instant,
    }),
  ),
  nextCursor: z.string().nullable(),
});
/** Canonical actual exercise results, including partial sessions; never planned volume. */
export const ExercisePerformanceResponseSchema = z.strictObject({
  performances: z.array(
    z.strictObject({
      sessionId: uuid,
      status: z.enum(['active', 'completed', 'abandoned']),
      startedAt: instant,
      items: z.array(SessionExerciseSchema),
      measuredWorkingVolumeKgReps: z.number().finite().nonnegative(),
    }),
  ),
  nextCursor: uuid.nullable(),
});
export const PerformanceResponseSchema = ExercisePerformanceResponseSchema;
export type ExercisePerformanceResponse = z.infer<typeof ExercisePerformanceResponseSchema>;
export type SetResult = z.infer<typeof SetResultSchema>;
export type SessionExercise = z.infer<typeof SessionExerciseSchema>;
export type SessionTimer = z.infer<typeof SessionTimerSchema>;
export type WorkoutSession = z.infer<typeof SessionSchema>;
export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export type SessionCommandResponse = z.infer<typeof SessionCommandResponseSchema>;
export function timerRemaining(timer: SessionTimer, serverNow: string): number {
  return timer.state === 'running' && timer.deadline
    ? Math.max(0, (Date.parse(timer.deadline) - Date.parse(serverNow)) / 1000)
    : timer.state === 'finished'
      ? 0
      : timer.remainingSeconds;
}
/** Measured kg-repetitions only: excludes targets, warmups, missing measurements and removed results. */
export function measuredWorkingVolume(session: WorkoutSession): number {
  return session.items.reduce(
    (sum, item) =>
      sum +
      item.results.reduce(
        (n, set) =>
          n +
          (!set.removedAt &&
          set.kind === 'working' &&
          set.measurements.mode === 'weighted' &&
          set.measurements.reps !== null &&
          set.measurements.loadKg !== null
            ? set.measurements.reps * set.measurements.loadKg
            : 0),
        0,
      ),
    0,
  );
}
