import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import * as Crypto from 'expo-crypto';
import {
  SyncSnapshotPageSchema,
  SyncChangesPageSchema,
  SessionCommandResponseSchema,
  FoodCommandResponseSchema,
  FoodUploadResponseSchema,
  TaskCommandResponseSchema,
  SessionSchema,
  FoodEntrySchema,
  TaskSchema,
  RoutineSchema,
  ExerciseSchema,
  BoardSchema,
  ProjectSchema,
  AttentionResponseSchema,
  PreferencesSchema,
  TaskStepSchema,
  AgentAttemptSchema,
  AgentResultSchema,
  attentionDate,
  buildTaskAttention,
} from '@mems-life/domain';
import type { InstallationClient } from './client';
import { SessionExpiredError } from './client';
import { openOfflineStore } from './offline/expo';
import {
  OfflineCoordinator,
  OfflineError,
  parseOfflineCommand,
  type OfflineStore,
  type OfflineCommand,
  type Partition,
  type DurablePhoto,
} from './offline';
import { uploadFoodPhoto } from './media';

export type LocalAcknowledgement = { localSaved: true; operationId: string; record: unknown };
export function isLocalAcknowledgement(value: unknown): value is LocalAcknowledgement {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as LocalAcknowledgement).localSaved === true &&
    typeof (value as LocalAcknowledgement).operationId === 'string'
  );
}
export const parseSessionAcknowledgement = (v: unknown) =>
  isLocalAcknowledgement(v)
    ? { operationId: v.operationId, session: SessionSchema.parse(v.record) }
    : SessionCommandResponseSchema.parse(v);
export const parseFoodAcknowledgement = (v: unknown) =>
  isLocalAcknowledgement(v)
    ? { operationId: v.operationId, entry: FoodEntrySchema.parse(v.record) }
    : FoodCommandResponseSchema.parse(v);
export const parseTaskAcknowledgement = (v: unknown) =>
  isLocalAcknowledgement(v)
    ? { operationId: v.operationId, task: TaskSchema.parse(v.record) }
    : TaskCommandResponseSchema.parse(v);

const supported = new Set([
  'task.create',
  'task.edit',
  'task.organize',
  'task.schedule',
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
  'food.create',
  'food.edit',
  'food.delete',
  'food.detach',
]);
export class NativeOfflineClient {
  private listeners = new Set<() => void>();
  revision = 0;
  error = '';
  needsSignIn = false;
  attentionFromDevice = false;
  readonly coordinator: OfflineCoordinator;
  constructor(
    readonly base: InstallationClient,
    readonly store: OfflineStore,
  ) {
    this.coordinator = new OfflineCoordinator(
      store,
      {
        snapshot: async (requestId, snapshotId, cursor) =>
          SyncSnapshotPageSchema.parse(
            await base.request(
              snapshotId
                ? `/api/sync/snapshots/${snapshotId}?cursor=${cursor ?? '0'}`
                : '/api/sync/snapshots',
              snapshotId ? undefined : { requestId, schemaVersion: 1 },
              'POST',
            ),
          ),
        changes: async (epoch, cursor) =>
          SyncChangesPageSchema.parse(
            await base.request(`/api/sync/changes?epoch=${epoch}&cursor=${cursor}`),
          ),
        send: async (command) => {
          const type = command.type.startsWith('task.')
            ? 'task'
            : command.type.startsWith('session.')
              ? 'session'
              : 'food';
          const raw = await base.request(
            `/api/${type === 'task' ? 'tasks' : type === 'session' ? 'sessions' : 'food'}/commands`,
            command,
            'POST',
            { expectedEpoch: (await store.state()).epoch ?? undefined },
          );
          const result =
            type === 'task'
              ? TaskCommandResponseSchema.parse(raw).task
              : type === 'session'
                ? SessionCommandResponseSchema.parse(raw).session
                : FoodCommandResponseSchema.parse(raw).entry;
          return [{ recordType: type, id: result.id, revision: result.revision, value: result }];
        },
      },
      Crypto.randomUUID,
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  notify() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
  snapshot = () => this.revision;
  private syncing: Promise<void> | null = null;
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.performSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }
  private async performSync() {
    try {
      await this.coordinator.sync();
      if (!this.coordinator.lastError?.startsWith('Sign in again')) await this.syncPhotos();
      this.error = this.coordinator.lastError ?? '';
      this.needsSignIn = this.error.startsWith('Sign in again');
    } catch (error) {
      this.needsSignIn = error instanceof SessionExpiredError;
      this.error =
        error instanceof Error ? error.message : 'Sync interrupted; local changes are retained.';
    }
    this.notify();
  }
  async syncPhotos() {
    const state = await this.store.state();
    if (state.signedOut || state.replayPaused || !state.epoch) return;
    for (const photo of await this.store.photos()) {
      if (photo.status !== 'pending') continue;
      const record = (await this.store.records('food')).find((r) => r.id === photo.entryId);
      if (!record || record.status !== 'synced') continue;
      const entry = FoodEntrySchema.parse(record.value);
      try {
        if (photo.attemptEpoch && photo.attemptEpoch !== state.epoch) {
          await this.store.updatePhoto(photo, 'needs-attention');
          continue;
        }
        photo.attemptEpoch ??= state.epoch;
        photo.delivery = 'attempted';
        photo.attempts = (photo.attempts ?? 0) + 1;
        await this.store.updatePhoto(photo, 'pending');
        if (!photo.uploadId) {
          photo.allocationRevision ??= entry.revision;
          await this.store.updatePhoto(photo, 'pending');
          const allocated = FoodUploadResponseSchema.parse(
            await this.base.request(
              `/api/food/${entry.id}/uploads`,
              {
                operationId: photo.id,
                expectedRevision: photo.allocationRevision,
                size: photo.size,
                sha256: photo.sha256,
                contentType: 'image/jpeg',
              },
              'POST',
              { expectedEpoch: state.epoch },
            ),
          );
          photo.uploadId = allocated.upload.id;
          await this.store.updatePhoto(photo, 'pending');
        }
        await uploadFoodPhoto(this.base, photo, photo.uploadId, state.epoch);
        photo.finalizeRevision ??= entry.revision;
        await this.store.updatePhoto(photo, 'pending');
        const finalized = FoodCommandResponseSchema.parse(
          await this.base.request(
            `/api/media/${photo.uploadId}/finalize`,
            { operationId: photo.operationId, expectedRevision: photo.finalizeRevision },
            'POST',
            { expectedEpoch: state.epoch },
          ),
        );
        await this.store.ingestValidatedRecords([
          {
            recordType: 'food',
            id: finalized.entry.id,
            revision: finalized.entry.revision,
            value: finalized.entry,
          },
        ]);
        photo.delivery = 'synced';
        await this.store.updatePhoto(photo, 'synced');
      } catch (error) {
        photo.delivery = 'uncertain';
        await this.store.updatePhoto(photo, 'pending');
        if ((error as { code?: string }).code === 'SYNC_EPOCH_CHANGED') {
          await this.store.observeEpoch(
            (error as { epoch?: string }).epoch ?? 'unknown-restored-epoch',
          );
          await this.coordinator.bootstrap();
        }
        if (
          (error as { status?: number }).status === 409 &&
          !['SYNC_EPOCH_CHANGED'].includes((error as { code?: string }).code ?? '')
        )
          await this.store.updatePhoto(photo, 'needs-attention');
        throw error;
      }
    }
  }
  async checkRecovery(operationId: string) {
    if (this.syncing) await this.syncing;
    await this.coordinator.bootstrap();
    const operation = (await this.store.outbox()).find((o) => o.operationId === operationId);
    if (!operation)
      throw new OfflineError('OPERATION_NOT_FOUND', 'The retained change is unavailable.');
    const record = (await this.store.records()).find(
      (r) => `${r.recordType}:${r.id}` === operation.aggregate,
    );
    if (!record) throw new OfflineError('REVIEW_REQUIRED', 'The local copy is unavailable.');
    const type =
      record.recordType === 'session'
        ? 'sessions'
        : record.recordType === 'task'
          ? 'tasks'
          : 'food';
    let originalSaved = false;
    if (operation.attempts && record.confirmed) {
      const history = (await this.base.request(`/api/${type}/${record.id}/history`)) as {
        events?: { operationId?: string }[];
      };
      if (!Array.isArray(history.events))
        throw new Error('The server history could not be checked.');
      originalSaved = history.events.some((event) => event.operationId === operationId);
    }
    this.notify();
    return {
      epoch: (await this.store.state()).epoch!,
      revision: (record.confirmed as { revision?: number } | null)?.revision ?? null,
      originalSaved,
      outcomeChecked: operation.attempts === 0,
      record,
    };
  }
  async saveReviewed(
    operationId: string,
    proof: { epoch: string; revision: number | null; outcomeChecked: boolean },
    asNew = false,
  ) {
    const freshOperationId = Crypto.randomUUID();
    const source = (await this.store.outbox()).find((o) => o.operationId === operationId);
    const photoCopies =
      asNew && source?.aggregate.startsWith('food:')
        ? (await this.store.photos())
            .filter(
              (p) =>
                `food:${p.entryId}` === source.aggregate &&
                !['synced', 'discarded'].includes(p.status),
            )
            .map((p) => ({
              oldId: p.id,
              id: Crypto.randomUUID(),
              operationId: Crypto.randomUUID(),
            }))
        : [];
    const saved = await this.store.saveReviewed(
      operationId,
      freshOperationId,
      proof,
      asNew ? Crypto.randomUUID() : undefined,
      photoCopies,
    );
    await this.dispatchReviewedOperation(freshOperationId);
    this.notify();
    return saved;
  }
  async revalidateReviewed(operationId: string) {
    await this.store.revalidateNeverSent(operationId);
    await this.dispatchReviewedOperation(operationId);
    this.notify();
  }
  private async dispatchReviewedOperation(operationId: string) {
    // Dispatch only the newly reviewed operation while global automatic replay stays paused.
    // This lets its dependent retained edits be reviewed against the real acknowledgement.
    const newlySaved = (await this.store.outbox()).find(
      (o) => o.operationId === operationId && o.state === 'never-sent' && o.attempts === 0,
    );
    if (newlySaved) {
      await this.store.markAttempt(newlySaved.operationId);
      try {
        const records = await this.coordinator.transport.send(JSON.parse(newlySaved.payload));
        await this.store.accept(newlySaved.operationId, records);
      } catch (error) {
        await this.store.requireAttemptReview(
          newlySaved.operationId,
          'The reviewed submission may have saved. Check its outcome before making another copy.',
        );
        if ((error as { code?: string }).code === 'SYNC_EPOCH_CHANGED') {
          await this.store.observeEpoch(
            (error as { epoch?: string }).epoch ?? 'unknown-restored-epoch',
          );
          await this.coordinator.bootstrap();
        }
        this.notify();
        throw error;
      }
    }
  }
  async checkPhotoRecovery(photoId: string) {
    if (this.syncing) await this.syncing;
    await this.coordinator.bootstrap();
    const photo = (await this.store.photos()).find((p) => p.id === photoId);
    if (!photo) throw new Error('The retained photo is unavailable.');
    const records = await this.store.records();
    const targetId = photo.recoveryEntryId ?? photo.entryId;
    const entry = records.find((r) => r.recordType === 'food' && r.id === targetId)?.confirmed as {
      deletedAt?: string | null;
      photoIds: string[];
      content?: { text?: string };
    } | null;
    const matching = records.find((r) => {
      const media = r.confirmed as {
        entryId?: string;
        status?: string;
        sha256?: string;
        size?: number;
        detachedAt?: string | null;
      } | null;
      return (
        r.recordType === 'media' &&
        media?.entryId === targetId &&
        media.status === 'finalized' &&
        !media.detachedAt &&
        media.sha256 === photo.sha256 &&
        media.size === photo.size &&
        entry?.photoIds.includes(r.id)
      );
    });
    this.notify();
    return {
      epoch: (await this.store.state()).epoch!,
      matchingId: matching?.id,
      entryExists: !!entry && !entry.deletedAt,
      text: entry?.content?.text ?? 'Food entry',
      retainedEntry: photo.retainedEntry ? FoodEntrySchema.parse(photo.retainedEntry) : null,
      recoveryEntryId: photo.recoveryEntryId,
      targetId,
      photoCount: entry?.photoIds.length ?? 0,
    };
  }
  async recoverPhoto(
    photoId: string,
    proof: { epoch: string; matchingId?: string; entryExists: boolean },
    stoppedAndAbsent = false,
    createDiaryEntry = false,
  ) {
    if (this.syncing) await this.syncing;
    const state = await this.store.state();
    if (state.signedOut || state.epoch !== proof.epoch)
      throw new Error('Sign in and check the current photos again.');
    const photo = (await this.store.photos()).find((p) => p.id === photoId);
    if (!photo || photo.status !== 'needs-attention')
      throw new Error('Choose a photo awaiting review.');
    if (createDiaryEntry) {
      const current = await this.checkPhotoRecovery(photoId);
      if (
        current.epoch !== proof.epoch ||
        current.entryExists ||
        current.recoveryEntryId ||
        !current.retainedEntry
      )
        throw new Error('The diary recovery changed. Check it again.');
      const operationId = Crypto.randomUUID();
      await this.store.forkRetainedPhotoEntry(
        photoId,
        Crypto.randomUUID(),
        operationId,
        proof.epoch,
      );
      await this.dispatchReviewedOperation(operationId);
      this.notify();
      return;
    }
    if (proof.matchingId) {
      const checked = await this.checkPhotoRecovery(photoId);
      if (checked.epoch !== proof.epoch || checked.matchingId !== proof.matchingId)
        throw new Error('The saved photo changed. Review it again.');
      await this.store.updatePhoto(
        { ...photo, delivery: 'synced', recoveredMediaId: proof.matchingId },
        'synced',
      );
    } else {
      if (!stoppedAndAbsent && (photo.attempts ?? 0) > 0)
        throw new Error(
          'Confirm that the original upload has stopped and this photo is absent before saving another copy.',
        );
      if (!proof.entryExists)
        throw new Error(
          'Save the retained diary text as a new entry first. The photo remains on this device.',
        );
      const current = await this.checkPhotoRecovery(photoId);
      if (current.epoch !== proof.epoch || current.matchingId || !current.entryExists)
        throw new Error('The server photos changed. Review them again.');
      await this.store.requeueReviewedPhoto(
        photoId,
        Crypto.randomUUID(),
        Crypto.randomUUID(),
        current.targetId,
      );
    }
    this.notify();
  }
  async save(command: OfflineCommand, photo?: DurablePhoto) {
    const record = await this.store.save(command, photo ? { photo } : {});
    this.error = '';
    this.notify();
    void this.sync();
    return {
      localSaved: true,
      operationId: command.operationId,
      record: record.value,
    } as LocalAcknowledgement;
  }
  async saveFood(command: OfflineCommand, photoUris: string[]) {
    const record = await this.store.save(command, {
      foodSave: { photoUris, draftKey: 'food-editor' },
    });
    this.error = '';
    this.notify();
    void this.sync();
    return {
      localSaved: true,
      operationId: command.operationId,
      record: record.value,
    } as LocalAcknowledgement;
  }
  async request(
    path: string,
    body?: unknown,
    method: 'PUT' | 'POST' | 'DELETE' = 'PUT',
    options: { expectedEpoch?: string } = {},
  ): Promise<unknown> {
    if (
      body === undefined &&
      path.split('?')[0] === '/api/attention' &&
      (await this.store.state()).epoch
    ) {
      const records = await this.store.records();
      const values = (type: string) =>
        records.filter((r) => r.recordType === type).map((r) => r.value);
      const pref = values('preferences')[0] as { value?: unknown } | undefined;
      const preferences = PreferencesSchema.safeParse(pref?.value ?? pref);
      const timezone = preferences.success
        ? preferences.data.timeZone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date().toISOString();
      const date = attentionDate(now, timezone);
      const food = values('food')
        .map((v) => FoodEntrySchema.parse(v))
        .filter((e) => !e.deletedAt && attentionDate(e.content.occurredAt, timezone) === date);
      this.attentionFromDevice = true;
      return AttentionResponseSchema.parse({
        now,
        timezone,
        date,
        items: buildTaskAttention(
          values('task').map((v) => TaskSchema.parse(v)),
          values('step').map((v) => TaskStepSchema.parse(v)),
          values('attempt').map((v) => AgentAttemptSchema.parse(v)),
          values('result').map((v) => AgentResultSchema.parse(v)),
          now,
        ),
        activeSession:
          values('session')
            .map((v) => SessionSchema.parse(v))
            .find((s) => s.status === 'active') ?? null,
        food: { entries: food, count: food.length, route: '/food' },
      });
    }
    const type = (body as { type?: string } | undefined)?.type;
    if (
      body &&
      type &&
      supported.has(type) &&
      /^\/api\/(tasks|sessions|food)\/commands$/.test(path)
    )
      return this.save(parseOfflineCommand(body as OfflineCommand));
    if (body !== undefined || method === 'DELETE') {
      const localState = await this.store.state();
      if (localState.signedOut) throw new SessionExpiredError();
      if (localState.replayPaused)
        throw new OfflineError(
          'REVIEW_REQUIRED',
          'The server was restored. Review retained changes before sending new actions.',
        );
      try {
        return await this.base.request(path, body, method, {
          expectedEpoch: options.expectedEpoch ?? (await this.store.state()).epoch ?? undefined,
        });
      } catch (error) {
        const failure = error as { code?: string; epoch?: string };
        if (failure.code === 'SYNC_EPOCH_CHANGED') {
          await this.store.observeEpoch(failure.epoch ?? 'unknown-restored-epoch');
          this.error = 'The server was restored. Review saved work before sending again.';
          this.notify();
          void this.sync();
        }
        if (error instanceof SessionExpiredError) {
          this.needsSignIn = true;
          this.notify();
        }
        throw error;
      }
    }
    const url = new URL(path, this.base.baseURL);
    const route = url.pathname;
    const mappings = [
      ['/api/sessions', 'session', 'sessions', SessionSchema],
      ['/api/food', 'food', 'entries', FoodEntrySchema],
      ['/api/tasks/query', 'task', 'tasks', TaskSchema],
      ['/api/tasks', 'task', 'tasks', TaskSchema],
      ['/api/routines', 'routine', 'routines', RoutineSchema],
      ['/api/exercises', 'exercise', 'exercises', ExerciseSchema],
      ['/api/boards', 'board', 'boards', BoardSchema],
      ['/api/projects', 'project', 'projects', ProjectSchema],
    ] as const;
    const map = mappings.find(([routeName]) => route === routeName);
    const detail = /^\/api\/(sessions|food|tasks)\/([a-f0-9-]{36})$/.exec(route);
    const detailType =
      detail?.[1] === 'sessions' ? 'session' : detail?.[1] === 'tasks' ? 'task' : 'food';
    const detailKey = detailType === 'food' ? 'entry' : detailType;
    if (!map && !detail) return this.base.request(path);
    // Cache only validated content records. Cookies and account/session responses never enter SQLite.
    if (!(await this.store.state()).epoch)
      try {
        const raw = (await this.base.request(path)) as Record<string, unknown>;
        if (detail) {
          const session = (
            detailType === 'session'
              ? SessionSchema
              : detailType === 'task'
                ? TaskSchema
                : FoodEntrySchema
          ).parse(raw[detailKey]);
          await this.store.ingestValidatedRecords([
            { recordType: detailType, id: session.id, revision: session.revision, value: session },
          ]);
        } else if (map) {
          const [, recordType, key, schema] = map;
          const values = raw[key];
          if (!Array.isArray(values)) throw new Error('Invalid installation response.');
          const records = values.map((v) => {
            const parsed = schema.parse(v);
            return { recordType, id: parsed.id, revision: parsed.revision, value: parsed };
          });
          await this.store.ingestValidatedRecords(records);
        }
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          this.needsSignIn = true;
          this.notify();
          throw error;
        }
        if (
          !(await this.store.state()).epoch &&
          !(await this.store.records(detail ? detailType : map![1])).length
        )
          throw error;
      }
    if (detail) {
      const record = (await this.store.records(detailType)).find((r) => r.id === detail[2]);
      if (!record) throw new Error('This record has not been downloaded.');
      return { [detailKey]: record.value };
    }
    const [, recordType, key] = map!;
    let values = (await this.store.records(recordType))
      .map((r) => r.value as Record<string, unknown>)
      .filter((v) => !v.deletedAt && (recordType === 'task' || !v.archivedAt));
    if (recordType === 'food' && url.searchParams.has('date'))
      values = values.filter(
        (v) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: url.searchParams.get('timezone') ?? 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date((v.content as { occurredAt: string }).occurredAt)) ===
          url.searchParams.get('date'),
      );
    if (recordType === 'task') {
      const view = url.searchParams.get('view') ?? 'open';
      values = values.filter((v) =>
        view === 'archived'
          ? !!v.archivedAt
          : !v.archivedAt &&
            (view === 'completed' ? v.phase === 'completed' : v.phase !== 'completed'),
      );
      for (const field of ['boardId', 'projectId', 'priority']) {
        const filter = url.searchParams.get(field);
        if (filter && filter !== 'all')
          values = values.filter(
            (v) => String((v.organization as Record<string, unknown>)[field]) === filter,
          );
      }
      const search = url.searchParams.get('search')?.toLowerCase();
      if (search)
        values = values.filter((v) =>
          Object.values(v.content as Record<string, string>).some((text) =>
            text.toLowerCase().includes(search),
          ),
        );
      const tag = url.searchParams.get('tag');
      if (tag)
        values = values.filter((v) => (v.organization as { tags: string[] }).tags.includes(tag));
      const timing = url.searchParams.get('timing');
      if (timing)
        values = values.filter((v) => {
          const schedule = v.schedule as {
            dueAt: string | null;
            scheduledAt: string | null;
            skippedAt: string | null;
          };
          if (v.phase === 'completed' || schedule.skippedAt) return false;
          return timing === 'overdue'
            ? !!schedule.dueAt && Date.parse(schedule.dueAt) < Date.now()
            : !!(schedule.dueAt || schedule.scheduledAt) &&
                Math.min(
                  ...[schedule.dueAt, schedule.scheduledAt]
                    .filter(Boolean)
                    .map((d) => Date.parse(d!)),
                ) >= Date.now();
        });
      const responsibility = url.searchParams.get('responsibility');
      if (responsibility) {
        const steps = await this.store.records('step');
        values = values.filter((v) =>
          steps.some((r) => {
            const step = r.value as {
              taskId: string;
              status: string;
              deletedAt: string | null;
              content: { responsibility: string };
            };
            return (
              step.taskId === v.id &&
              !step.deletedAt &&
              !['completed', 'skipped'].includes(step.status) &&
              [responsibility, 'either'].includes(step.content.responsibility)
            );
          }),
        );
      }
    }
    return {
      [key]: values,
      ...(recordType === 'session' || route === '/api/tasks/query' ? { nextCursor: null } : {}),
    };
  }
  async signOut(choice: 'retain' | 'discard' | 'export') {
    const exported = choice === 'export' ? await this.store.exportPending() : undefined;
    if (choice === 'discard') await this.store.discardPending();
    await this.store.signOut(true);
    this.notify();
    return exported;
  }
  start() {
    void this.sync();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void this.sync();
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void this.sync();
    });
    return () => {
      foreground.remove();
      network.remove();
    };
  }
}
export async function createOfflineClient(
  base: InstallationClient,
  partition: Partition,
  options: { resumeOffline?: boolean } = {},
): Promise<InstallationClient> {
  const store = await openOfflineStore(partition);
  if (options.resumeOffline && (await store.state()).signedOut) {
    await store.db.close();
    throw new SessionExpiredError();
  }
  await store.signIn();
  const offline = new NativeOfflineClient(base, store);
  return { ...base, offline, request: offline.request.bind(offline) };
}
export function useOfflineRevision(client: InstallationClient) {
  return useSyncExternalStore(
    client.offline?.subscribe ?? (() => () => {}),
    client.offline?.snapshot ?? (() => 0),
    () => 0,
  );
}
