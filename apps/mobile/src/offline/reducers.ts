import {
  TaskCommandSchema,
  SessionCommandSchema,
  FoodCommandSchema,
  TaskSchema,
  SessionSchema,
  FoodEntrySchema,
  RoutineSchema,
  ExerciseSchema,
  applyTaskCommand,
  sessionItemsFromRoutine,
  type WorkoutSession,
  type SessionExercise,
} from '@mems-life/domain';
import { OfflineError, type OfflineCommand, type SyncRecord } from './types';
export const aggregateOf = (command: OfflineCommand): string =>
  command.type.startsWith('task.')
    ? `task:${(command as { taskId: string }).taskId}`
    : command.type.startsWith('session.')
      ? `session:${(command as { sessionId: string }).sessionId}`
      : `food:${(command as { entryId: string }).entryId}`;
const safeTasks = new Set(['task.create', 'task.edit', 'task.organize', 'task.schedule']);
const safeSessions = new Set([
  'session.start',
  'session.add-exercise',
  'session.substitute-exercise',
  'session.reorder-exercises',
  'session.skip-exercise',
  'session.remove-exercise',
  'session.record-set',
  'session.correct-set',
  'session.remove-set',
  'session.set-notes',
  'session.set-supersets',
  'session.finish',
  'session.abandon',
]);
export function parseOfflineCommand(input: OfflineCommand): OfflineCommand {
  const command = input.type.startsWith('task.')
    ? TaskCommandSchema.parse(input)
    : input.type.startsWith('session.')
      ? SessionCommandSchema.parse(input)
      : FoodCommandSchema.parse(input);
  if (
    (command.type.startsWith('task.') && !safeTasks.has(command.type)) ||
    (command.type.startsWith('session.') && !safeSessions.has(command.type))
  )
    throw new OfflineError('ONLINE_REQUIRED', 'This action needs online confirmation.');
  return command;
}
export function reduceOffline(
  current: unknown | null,
  command: OfflineCommand,
  now: string,
  catalogue: SyncRecord[],
): unknown {
  if (command.type.startsWith('task.'))
    return TaskSchema.parse(
      applyTaskCommand(
        current ? TaskSchema.parse(current) : null,
        TaskCommandSchema.parse(command),
        now,
      ),
    );
  if (command.type.startsWith('food.')) {
    const c = FoodCommandSchema.parse(command);
    const old = current ? FoodEntrySchema.parse(current) : null;
    if (c.type === 'food.create') {
      if (old) throw new OfflineError('EXISTS', 'This entry already exists.');
      return FoodEntrySchema.parse({
        id: c.entryId,
        revision: 1,
        content: c.content,
        photoIds: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }
    if (!old || old.revision !== c.expectedRevision || old.deletedAt)
      throw new OfflineError(
        'REVISION_CONFLICT',
        'This entry changed or was deleted. Preserve this edit for review.',
      );
    return FoodEntrySchema.parse({
      ...old,
      revision: old.revision + 1,
      updatedAt: now,
      ...(c.type === 'food.edit'
        ? { content: c.content }
        : c.type === 'food.delete'
          ? { deletedAt: now }
          : { photoIds: old.photoIds.filter((id) => id !== c.photoId) }),
    });
  }
  const c = SessionCommandSchema.parse(command);
  if (c.type === 'session.start') {
    if (current) throw new OfflineError('EXISTS', 'This workout already exists.');
    const routine = c.routineId
      ? RoutineSchema.parse(
          catalogue.find((r) => r.recordType === 'routine' && r.id === c.routineId)?.value,
        )
      : null;
    if (routine && (routine.revision !== c.expectedRoutineRevision || routine.archivedAt))
      throw new OfflineError('ROUTINE_CHANGED', 'Download the current routine before starting.');
    // Stable IDs derived by the service protocol are required for offline routine starts.
    if (routine && !c.itemIdentities)
      throw new OfflineError(
        'SESSION_IDENTITIES_REQUIRED',
        'Supply stable workout exercise and target identities before saving offline.',
      );
    const items: SessionExercise[] = routine
      ? sessionItemsFromRoutine(routine.items, c.itemIdentities, () => {
          throw new OfflineError('SESSION_IDENTITIES_REQUIRED', 'Stable identities are required.');
        })
      : [];
    return SessionSchema.parse({
      id: c.sessionId,
      revision: 1,
      name: c.name,
      notes: '',
      status: 'active',
      sourceRoutineId: c.routineId,
      sourceRoutineRevision: routine?.revision ?? null,
      items,
      supersets: [],
      timer: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    });
  }
  if (!current) throw new OfflineError('NOT_FOUND', 'Download this workout before editing.');
  const session: WorkoutSession = structuredClone(SessionSchema.parse(current));
  if (session.revision !== c.expectedRevision)
    throw new OfflineError(
      'REVISION_CONFLICT',
      'This workout changed. Preserve this edit for review.',
    );
  if (
    session.status !== 'active' &&
    !['session.correct-set', 'session.remove-set', 'session.set-notes'].includes(c.type)
  )
    throw new OfflineError('SESSION_FINISHED', 'Use explicit corrections for a completed workout.');
  const itemOf = (id: string) => {
    const item = session.items.find((i) => i.id === id);
    if (!item) throw new OfflineError('ITEM_NOT_FOUND', 'The workout exercise is unavailable.');
    return item;
  };
  session.revision++;
  session.updatedAt = now;
  switch (c.type) {
    case 'session.add-exercise':
    case 'session.substitute-exercise': {
      if (session.items.some((i) => i.id === c.itemId))
        throw new OfflineError('DUPLICATE_ITEM', 'This exercise identity is already used.');
      const exercise = ExerciseSchema.parse(
        catalogue.find((r) => r.recordType === 'exercise' && r.id === c.exerciseId)?.value,
      );
      if (exercise.revision !== c.expectedExerciseRevision || exercise.archivedAt)
        throw new OfflineError('EXERCISE_CHANGED', 'Download the current exercise first.');
      const added: SessionExercise = {
        id: c.itemId,
        exerciseId: exercise.id,
        snapshot: { name: exercise.name, mode: exercise.mode, supportsLoad: exercise.supportsLoad },
        targets: [],
        notes: '',
        status: 'planned',
        results: [],
        replacedItemId: null,
      };
      if (c.type === 'session.substitute-exercise') {
        const old = itemOf(c.replacedItemId);
        if (['removed', 'skipped'].includes(old.status))
          throw new OfflineError('INVALID_TRANSITION', 'Exercise is unavailable.');
        old.status = 'removed';
        added.replacedItemId = old.id;
        session.items.splice(session.items.indexOf(old) + 1, 0, added);
        session.supersets = session.supersets.map((g) => ({
          ...g,
          itemIds: g.itemIds.map((id) => (id === old.id ? added.id : id)),
        }));
      } else session.items.push(added);
      break;
    }
    case 'session.reorder-exercises':
      if (
        c.itemIds.length !== session.items.length ||
        new Set(c.itemIds).size !== session.items.length
      )
        throw new OfflineError('INVALID_ORDER', 'Include every exercise exactly once.');
      session.items = c.itemIds.map(itemOf);
      break;
    case 'session.skip-exercise':
    case 'session.remove-exercise': {
      const item = itemOf(c.itemId);
      item.status = c.type === 'session.skip-exercise' ? 'skipped' : 'removed';
      session.supersets = session.supersets
        .map((g) => ({ ...g, itemIds: g.itemIds.filter((id) => id !== item.id) }))
        .filter((g) => g.itemIds.length >= 2);
      break;
    }
    case 'session.record-set':
    case 'session.correct-set': {
      const item = itemOf(c.itemId);
      const existing = item.results.find((r) => r.id === c.setId);
      if (c.type === 'session.record-set') {
        if (
          ['removed', 'skipped'].includes(item.status) ||
          session.items.some((i) => i.results.some((r) => r.id === c.setId))
        )
          throw new OfflineError('INVALID_SET', 'This set cannot be added.');
        item.results.push({
          id: c.setId,
          kind: c.kind,
          measurements: c.measurements,
          notes: c.notes,
          round: c.round,
          recordedAt: now,
          correctedAt: null,
          removedAt: null,
        });
        item.status = 'in-progress';
      } else {
        if (!existing || existing.removedAt)
          throw new OfflineError('SET_NOT_FOUND', 'Choose a recorded set.');
        Object.assign(existing, {
          kind: c.kind,
          measurements: c.measurements,
          notes: c.notes,
          round: c.round,
          correctedAt: now,
        });
      }
      break;
    }
    case 'session.remove-set': {
      const set = itemOf(c.itemId).results.find((r) => r.id === c.setId);
      if (!set || set.removedAt) throw new OfflineError('SET_NOT_FOUND', 'Choose a recorded set.');
      set.removedAt = now;
      set.correctedAt = now;
      break;
    }
    case 'session.set-notes':
      if (c.itemId) itemOf(c.itemId).notes = c.notes;
      else session.notes = c.notes;
      break;
    case 'session.set-supersets':
      session.supersets = c.supersets;
      break;
    case 'session.finish':
    case 'session.abandon':
      session.status = c.type === 'session.finish' ? 'completed' : 'abandoned';
      session.finishedAt = now;
      session.timer = null;
      break;
    default:
      throw new OfflineError('ONLINE_REQUIRED', 'This action needs online confirmation.');
  }
  return SessionSchema.parse(session);
}
