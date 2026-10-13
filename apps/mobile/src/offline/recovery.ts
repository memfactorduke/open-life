import { FoodEntrySchema, TaskSchema, type WorkoutSession } from '@mems-life/domain';
import { parseOfflineCommand } from './reducers';
import { OfflineError, type LocalRecord, type OfflineCommand, type OutboxEntry } from './types';

type Value = {
  revision: number;
  name?: string;
  status?: string;
  phase?: string;
  deletedAt?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  notes?: string;
  photoIds?: string[];
  content?: {
    title?: string;
    text?: string;
    occurredAt?: string;
    description?: string;
    notes?: string;
  };
  schedule?: { dueAt?: string | null; scheduledAt?: string | null };
  organization?: { priority?: string };
  items?: {
    snapshot?: { name?: string };
    results?: {
      removedAt?: string | null;
      notes?: string;
      measurements?: {
        reps?: number | null;
        loadKg?: number | null;
        addedLoadKg?: number | null;
        durationSeconds?: number | null;
        distanceMeters?: number | null;
      };
    }[];
  }[];
};
const date = (value: unknown) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString()
    : 'Not set';
/** Content-only review: never render storage paths, account identities, or protocol payloads. */
export function reviewFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return { Availability: 'Not present on the server' };
  const v = value as Value;
  if (v.content?.occurredAt)
    return {
      Entry: v.content.text || 'Photo diary entry',
      Time: date(v.content.occurredAt),
      Photos: String(v.photoIds?.length ?? 0),
      Status: v.deletedAt ? 'Deleted' : 'Saved',
    };
  if (v.content?.title)
    return {
      Title: v.content.title,
      Description: v.content.description || 'None',
      Notes: v.content.notes || 'None',
      Status: v.deletedAt ? 'Deleted' : (v.phase ?? 'Saved'),
      Due: date(v.schedule?.dueAt),
      Scheduled: date(v.schedule?.scheduledAt),
      Priority: v.organization?.priority ?? 'None',
    };
  return {
    Workout: v.name || 'Workout',
    Status: v.status ?? 'Unknown',
    Started: date(v.startedAt),
    Finished: v.finishedAt ? date(v.finishedAt) : 'Not finished',
    Notes: v.notes || 'None',
    Exercises:
      (v.items ?? [])
        .map(
          (item) =>
            `${item.snapshot?.name ?? 'Exercise'}: ${
              (item.results ?? [])
                .filter((s) => !s.removedAt)
                .map((s) => {
                  const m = s.measurements ?? {};
                  return [
                    m.reps != null ? `${m.reps} reps` : '',
                    m.loadKg != null ? `${m.loadKg} kg` : '',
                    m.addedLoadKg != null ? `${m.addedLoadKg} kg added` : '',
                    m.durationSeconds != null ? `${m.durationSeconds} seconds` : '',
                    m.distanceMeters != null ? `${m.distanceMeters} meters` : '',
                    s.notes,
                  ]
                    .filter(Boolean)
                    .join(', ');
                })
                .join('; ') || 'No recorded sets'
            }`,
        )
        .join('\n') || 'No exercises',
  };
}
export function reviewDifferences(local: unknown, server: unknown) {
  const left = reviewFields(local),
    right = reviewFields(server);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].map((field) => ({
    field,
    local: left[field] ?? 'Not set',
    server: right[field] ?? 'Not set',
    changed: left[field] !== right[field],
  }));
}
/** Compare this immutable operation's intent with the latest checked server record. */
export function reviewCommandDifferences(
  command: OfflineCommand,
  server: unknown,
  records: LocalRecord[],
) {
  const current = server as (Omit<Value, 'items'> & WorkoutSession) | null;
  const left: Record<string, string> = {};
  const right: Record<string, string> = {};
  const field = (name: string, local: unknown, remote: unknown) => {
    const display = (v: unknown) => (v == null || v === '' ? 'None' : String(v));
    left[name] = display(local);
    right[name] = display(remote);
  };
  const name = (id: string | null, type: string) => {
    if (!id) return 'None';
    for (const record of records) {
      const value = record.value as {
        name?: string;
        title?: string;
        content?: { name?: string; title?: string; columns?: { id: string; name: string }[] };
      };
      if (type === 'column') {
        const column = value.content?.columns?.find((column) => column.id === id);
        if (column) return column.name;
      }
      if (record.id === id && record.recordType === type)
        return (
          value.name ??
          value.title ??
          value.content?.name ??
          value.content?.title ??
          `Unavailable ${type} (${id.slice(0, 8)})`
        );
    }
    return `Unavailable ${type} (${id.slice(0, 8)})`;
  };
  const itemName = (id: string) =>
    current?.items?.find((item) => item.id === id)?.snapshot.name ?? 'Retained exercise';
  const measurements = (m: Record<string, unknown> | undefined) =>
    m
      ? Object.entries(m)
          .filter(([key, v]) => key !== 'mode' && v !== null && v !== undefined)
          .map(
            ([k, v]) =>
              `${v} ${({ reps: 'reps', loadKg: 'kg', addedLoadKg: 'kg added', durationSeconds: 'seconds', distanceMeters: 'meters' } as Record<string, string>)[k] ?? k}`,
          )
          .join(', ') || 'None'
      : 'None';
  switch (command.type) {
    case 'task.create':
    case 'task.edit':
      field('Title', command.content.title, current?.content?.title);
      field('Description', command.content.description, current?.content?.description);
      field('Notes', command.content.notes, current?.content?.notes);
      break;
    case 'task.schedule':
      field('Due', date(command.dueAt), date(current?.schedule?.dueAt));
      field('Scheduled', date(command.scheduledAt), date(current?.schedule?.scheduledAt));
      break;
    case 'task.organize': {
      const org = (server as { organization?: typeof command.organization } | null)?.organization;
      field('Priority', command.organization.priority, org?.priority);
      field('Tags', command.organization.tags.join(', '), org?.tags.join(', '));
      for (const [label, key, type] of [
        ['Board', 'boardId', 'board'],
        ['Column', 'columnId', 'column'],
        ['Project', 'projectId', 'project'],
      ] as const)
        field(label, name(command.organization[key], type), name(org?.[key] ?? null, type));
      break;
    }
    case 'food.create':
    case 'food.edit':
      field('Entry', command.content.text || 'Photo diary entry', current?.content?.text);
      field('Time', date(command.content.occurredAt), date(current?.content?.occurredAt));
      field(
        'Timezone',
        command.content.timezone,
        (server as { content?: { timezone?: string } } | null)?.content?.timezone,
      );
      break;
    case 'food.delete':
      field('Status', 'Deleted', current?.deletedAt ? 'Deleted' : 'Saved');
      break;
    case 'food.detach':
      field(
        'Photo',
        `Remove photo ${Math.max(1, (current?.photoIds?.indexOf(command.photoId) ?? -1) + 1)}`,
        current?.photoIds?.includes(command.photoId) ? 'Attached' : 'Not attached',
      );
      break;
    case 'session.start':
      field('Workout', command.name, current?.name);
      field(
        'Routine',
        name(command.routineId, 'routine'),
        current?.sourceRoutineId ? name(current.sourceRoutineId, 'routine') : 'None',
      );
      break;
    case 'session.record-set':
    case 'session.correct-set': {
      const item = current?.items?.find((i) => i.id === command.itemId);
      const set = item?.results.find((r) => r.id === command.setId);
      field('Exercise', itemName(command.itemId), item ? item.snapshot.name : 'Not present');
      field('Set', command.kind, set?.kind);
      field('Measurement type', command.measurements.mode, set?.measurements.mode);
      field('Measurements', measurements(command.measurements), measurements(set?.measurements));
      field('Set notes', command.notes, set?.notes);
      field('Round', command.round, set?.round);
      if (command.type === 'session.correct-set')
        field('Reason', command.reason, 'No correction submitted');
      break;
    }
    case 'session.set-notes':
      field(
        'Notes',
        command.notes,
        command.itemId
          ? current?.items?.find((i) => i.id === command.itemId)?.notes
          : current?.notes,
      );
      field(
        'Applies to',
        command.itemId ? itemName(command.itemId) : 'Workout',
        command.itemId ? itemName(command.itemId) : 'Workout',
      );
      break;
    case 'session.add-exercise':
    case 'session.substitute-exercise':
      field(
        'Exercise',
        name(command.exerciseId, 'exercise'),
        current?.items?.find((i) => i.id === command.itemId)?.snapshot.name,
      );
      if (command.type === 'session.substitute-exercise')
        field('Replaces', itemName(command.replacedItemId), itemName(command.replacedItemId));
      break;
    case 'session.reorder-exercises':
      field(
        'Exercise order',
        command.itemIds.map(itemName).join(' → '),
        current?.items?.map((i) => i.snapshot.name).join(' → '),
      );
      break;
    case 'session.skip-exercise':
    case 'session.remove-exercise':
      field('Exercise', itemName(command.itemId), itemName(command.itemId));
      field(
        'Exercise status',
        command.type === 'session.skip-exercise' ? 'Skipped' : 'Removed',
        current?.items?.find((i) => i.id === command.itemId)?.status,
      );
      break;
    case 'session.remove-set':
      field('Exercise', itemName(command.itemId), itemName(command.itemId));
      field(
        'Set status',
        'Removed',
        current?.items
          ?.find((i) => i.id === command.itemId)
          ?.results.find((r) => r.id === command.setId)?.removedAt
          ? 'Removed'
          : 'Recorded',
      );
      field('Reason', command.reason, 'No removal submitted');
      break;
    case 'session.set-supersets':
      field(
        'Supersets',
        command.supersets.map((g) => g.itemIds.map(itemName).join(' + ')).join('; '),
        current?.supersets?.map((g) => g.itemIds.map(itemName).join(' + ')).join('; '),
      );
      break;
    case 'session.finish':
    case 'session.abandon':
      field(
        'Workout status',
        command.type === 'session.finish' ? 'Finished' : 'Abandoned',
        current?.status,
      );
      break;
    default:
      return reviewDifferences(null, server);
  }
  return Object.keys(left).map((key) => ({
    field: key,
    local: left[key],
    server: right[key],
    changed: left[key] !== right[key],
  }));
}
export function recoveryCommand(
  entry: OutboxEntry,
  record: LocalRecord,
  operationId: string,
  newRecordId?: string,
): OfflineCommand {
  const original = JSON.parse(entry.payload) as OfflineCommand;
  if (operationId === original.operationId)
    throw new OfflineError(
      'NEW_ID_REQUIRED',
      'Saving reviewed work needs a new operation identity.',
    );
  const local = record.value as Value,
    server = record.confirmed as Value | null;
  if (newRecordId) {
    if (newRecordId === record.id)
      throw new OfflineError('NEW_ID_REQUIRED', 'A separate copy needs a new record identity.');
    if (record.recordType === 'food')
      return parseOfflineCommand({
        type: 'food.create',
        operationId,
        entryId: newRecordId,
        expectedRevision: 0,
        content:
          original.type === 'food.create' || original.type === 'food.edit'
            ? original.content
            : FoodEntrySchema.parse(local).content,
      });
    if (record.recordType === 'task')
      return parseOfflineCommand({
        type: 'task.create',
        operationId,
        taskId: newRecordId,
        expectedRevision: 0,
        content:
          original.type === 'task.create' || original.type === 'task.edit'
            ? original.content
            : TaskSchema.parse(local).content,
      });
    throw new OfflineError(
      'WORKOUT_COPY_REQUIRED',
      'Export this workout with all recorded measurements before creating another workout.',
    );
  }
  if (!server || server.deletedAt)
    throw new OfflineError(
      'DELETED_RECORD',
      'The server record was deleted. Save a separate copy instead.',
    );
  if (record.recordType === 'session' && server.status !== 'active')
    throw new OfflineError(
      'WORKOUT_FINISHED',
      'A finished workout cannot be replaced by a conflicting local version. Keep the server workout or export your recorded measurements.',
    );
  if (
    original.type === 'task.create' ||
    original.type === 'food.create' ||
    original.type === 'session.start'
  )
    throw new OfflineError(
      'COPY_REQUIRED',
      'This creation already has a server record. Save a separate copy instead.',
    );
  return parseOfflineCommand({ ...original, operationId, expectedRevision: server.revision });
}
