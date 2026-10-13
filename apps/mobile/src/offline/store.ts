import { aggregateOf, parseOfflineCommand, reduceOffline } from './reducers';
import { recoveryCommand } from './recovery';
import { FoodEntrySchema } from '@mems-life/domain';
import {
  OfflineError,
  type SqlDatabase,
  type SqlExecutor,
  type Partition,
  type OfflineCommand,
  type OutboxEntry,
  type SyncRecord,
  type LocalRecord,
  type SyncState,
  type SnapshotPage,
  type FeedPage,
} from './types';
const json = JSON.stringify;
const initialState: SyncState = {
  epoch: null,
  cursor: '0',
  replayPaused: false,
  activeSessionId: null,
  signedOut: false,
};
type RecordRow = {
  aggregate: string;
  record_type: string;
  id: string;
  revision: number;
  confirmed: string | null;
  projection: string;
  status: LocalRecord['status'];
};
type OpRow = {
  operation_id: string;
  aggregate: string;
  payload: string;
  local_at: string;
  dependencies: string;
  state: OutboxEntry['state'];
  attempts: number;
  next_attempt_at: number;
  error: string | null;
};
const op = (r: OpRow): OutboxEntry => ({
  operationId: r.operation_id,
  aggregate: r.aggregate,
  payload: r.payload,
  localAt: r.local_at,
  dependencies: JSON.parse(r.dependencies),
  state: r.state,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at,
  error: r.error,
});
const pendingStates = "'never-sent','attempted','uncertain','conflict','review'";
export class OfflineStore {
  readonly partitionKey: string;
  constructor(
    readonly db: SqlDatabase,
    readonly partition: Partition,
  ) {
    this.partitionKey = json([partition.installationId, partition.ownerId]);
  }
  async initialize(): Promise<void> {
    await this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS offline_state(partition TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS offline_records(partition TEXT NOT NULL,aggregate TEXT NOT NULL,record_type TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,confirmed TEXT,projection TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(partition,aggregate));
      CREATE TABLE IF NOT EXISTS offline_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,partition TEXT NOT NULL,operation_id TEXT NOT NULL,aggregate TEXT NOT NULL,payload TEXT NOT NULL,local_at TEXT NOT NULL,dependencies TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,error TEXT,UNIQUE(partition,operation_id));
      CREATE INDEX IF NOT EXISTS offline_pending ON offline_outbox(partition,aggregate,seq);
      CREATE TABLE IF NOT EXISTS offline_conflicts(partition TEXT NOT NULL,operation_id TEXT NOT NULL,local_value TEXT NOT NULL,server_value TEXT,error TEXT NOT NULL,PRIMARY KEY(partition,operation_id));
      CREATE TABLE IF NOT EXISTS offline_snapshot(partition TEXT NOT NULL,snapshot_id TEXT NOT NULL,ordinal TEXT NOT NULL,page TEXT NOT NULL,PRIMARY KEY(partition,snapshot_id,ordinal));
      CREATE TABLE IF NOT EXISTS offline_drafts(partition TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(partition,key));
      CREATE TABLE IF NOT EXISTS offline_photos(partition TEXT NOT NULL,id TEXT NOT NULL,entry_id TEXT NOT NULL,value TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(partition,id));`);
    await this.db.run(
      'INSERT OR IGNORE INTO offline_state(partition,value) VALUES(?,?)',
      this.partitionKey,
      json(initialState),
    );
    // An interrupted send is uncertain, never silently changed back to never-sent.
    await this.db.run(
      "UPDATE offline_outbox SET state='uncertain' WHERE partition=? AND state='attempted'",
      this.partitionKey,
    );
  }
  async state(tx: SqlExecutor = this.db): Promise<SyncState> {
    return JSON.parse(
      (
        await tx.all<{ value: string }>(
          'SELECT value FROM offline_state WHERE partition=?',
          this.partitionKey,
        )
      )[0].value,
    );
  }
  private async setState(state: SyncState, tx: SqlExecutor) {
    await tx.run(
      'UPDATE offline_state SET value=? WHERE partition=?',
      json(state),
      this.partitionKey,
    );
  }
  async records(recordType?: string, tx: SqlExecutor = this.db): Promise<LocalRecord[]> {
    const rows = await tx.all<RecordRow>(
      `SELECT * FROM offline_records WHERE partition=?${recordType ? ' AND record_type=?' : ''}`,
      this.partitionKey,
      ...(recordType ? [recordType] : []),
    );
    return rows.map((r) => ({
      recordType: r.record_type,
      id: r.id,
      revision: r.revision,
      value: JSON.parse(r.projection),
      confirmed: r.confirmed ? JSON.parse(r.confirmed) : null,
      status: r.status,
    }));
  }
  async outbox(tx: SqlExecutor = this.db): Promise<OutboxEntry[]> {
    return (
      await tx.all<OpRow>(
        'SELECT * FROM offline_outbox WHERE partition=? ORDER BY seq',
        this.partitionKey,
      )
    ).map(op);
  }
  async conflicts() {
    return this.db.all<{
      operation_id: string;
      local_value: string;
      server_value: string | null;
      error: string;
    }>('SELECT * FROM offline_conflicts WHERE partition=?', this.partitionKey);
  }
  async save(
    input: OfflineCommand,
    options: {
      now?: string;
      dependencies?: string[];
      photo?: DurablePhoto;
      foodSave?: { photoUris: string[]; draftKey: string };
    } = {},
  ): Promise<LocalRecord> {
    let command = parseOfflineCommand(input);
    let payload = json(command);
    const aggregate = aggregateOf(command);
    const now = options.now ?? new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const state = await this.state(tx);
      if (state.signedOut)
        throw new OfflineError('SIGNED_OUT', 'Sign in to this account before saving new work.');
      const all = await this.outbox(tx);
      const duplicate = all.find((o) => o.operationId === command.operationId);
      if (duplicate) {
        // Reusing an unstamped caller command must reuse the first durable event instant.
        const saved = JSON.parse(duplicate.payload) as OfflineCommand;
        if ('occurredAt' in saved && !('occurredAt' in command && command.occurredAt !== undefined))
          payload = json(
            parseOfflineCommand({ ...command, occurredAt: saved.occurredAt } as OfflineCommand),
          );
        if (duplicate.payload !== payload)
          throw new OfflineError(
            'OPERATION_REUSED',
            'An operation ID cannot be reused with changed content.',
          );
        return (await this.records(undefined, tx)).find(
          (r) => `${r.recordType}:${r.id}` === aggregate,
        )!;
      }
      if (
        [
          'session.start',
          'session.record-set',
          'session.correct-set',
          'session.remove-set',
          'session.finish',
          'session.abandon',
        ].includes(command.type)
      ) {
        command = parseOfflineCommand({
          ...command,
          occurredAt: 'occurredAt' in command ? (command.occurredAt ?? now) : now,
        } as OfflineCommand);
        payload = json(command);
      }
      const catalogue = await this.records(undefined, tx);
      const current = catalogue.find((r) => `${r.recordType}:${r.id}` === aggregate);
      if (current?.status === 'needs-attention')
        throw new OfflineError('REVIEW_REQUIRED', 'Review this record before adding more edits.');
      if (
        command.type === 'session.start' &&
        catalogue.some(
          (r) => r.recordType === 'session' && (r.value as { status?: string }).status === 'active',
        )
      )
        throw new OfflineError(
          'ACTIVE_SESSION_EXISTS',
          'Resume or abandon your existing active workout first.',
        );
      const value = reduceOffline(current?.value ?? null, command, now, catalogue);
      const previous = all
        .filter((o) => o.aggregate === aggregate && !['synced', 'discarded'].includes(o.state))
        .at(-1);
      const dependencies = [
        ...new Set([...(options.dependencies ?? []), ...(previous ? [previous.operationId] : [])]),
      ];
      if (dependencies.some((id) => !all.some((o) => o.operationId === id)))
        throw new OfflineError(
          'DEPENDENCY_NOT_FOUND',
          'A prerequisite local operation is unavailable.',
        );
      const [recordType, id] = aggregate.split(':');
      await tx.run(
        'INSERT INTO offline_outbox(partition,operation_id,aggregate,payload,local_at,dependencies,state) VALUES(?,?,?,?,?,?,?)',
        this.partitionKey,
        command.operationId,
        aggregate,
        payload,
        now,
        json(dependencies),
        state.replayPaused ? 'review' : 'never-sent',
      );
      await tx.run(
        'INSERT INTO offline_records(partition,aggregate,record_type,id,revision,confirmed,projection,status) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(partition,aggregate) DO UPDATE SET revision=excluded.revision,projection=excluded.projection,status=excluded.status',
        this.partitionKey,
        aggregate,
        recordType,
        id,
        (value as { revision: number }).revision,
        current?.confirmed ? json(current.confirmed) : null,
        json(value),
        state.replayPaused ? 'needs-attention' : 'pending',
      );
      if (options.photo) {
        if (!command.type.startsWith('food.') || options.photo.entryId !== id)
          throw new OfflineError(
            'PHOTO_ENTRY_MISMATCH',
            'Save this photo with its selected diary entry.',
          );
        await this.addPhoto(options.photo, tx);
      }
      if (options.foodSave) {
        if (command.type !== 'food.create' && command.type !== 'food.edit')
          throw new OfflineError('PHOTO_ENTRY_MISMATCH', 'Save selected photos with diary text.');
        for (const uri of new Set(options.foodSave.photoUris)) {
          const rows = await tx.all<{
            id: string;
            entry_id: string;
            value: string;
            status: string;
          }>(
            'SELECT id,entry_id,value,status FROM offline_photos WHERE partition=? AND entry_id=?',
            this.partitionKey,
            id,
          );
          const matches = rows.filter((row) => (JSON.parse(row.value) as DurablePhoto).uri === uri);
          if (matches.length !== 1 || matches[0].status !== 'draft')
            throw new OfflineError(
              'PHOTO_DRAFT_CHANGED',
              'The selected photo changed. Keep the draft and select it again.',
            );
          const row = matches[0];
          const photo = JSON.parse(row.value) as DurablePhoto;
          await tx.run(
            'UPDATE offline_photos SET value=?,status=? WHERE partition=? AND id=?',
            json({ ...photo, retainedEntry: value }),
            state.replayPaused ? 'needs-attention' : 'pending',
            this.partitionKey,
            row.id,
          );
        }
        await tx.run(
          'DELETE FROM offline_drafts WHERE partition=? AND key=?',
          this.partitionKey,
          options.foodSave.draftKey,
        );
      }
      if (recordType === 'session') {
        const s = value as { status: string };
        state.activeSessionId =
          s.status === 'active' ? id : state.activeSessionId === id ? null : state.activeSessionId;
        await this.setState(state, tx);
      }
      return {
        recordType,
        id,
        revision: (value as { revision: number }).revision,
        value,
        confirmed: current?.confirmed ?? null,
        status: state.replayPaused ? 'needs-attention' : 'pending',
      };
    });
  }
  async retainPhoto(photo: DurablePhoto): Promise<void> {
    await this.db.transaction((tx) => this.addPhoto(photo, tx, 'draft'));
  }
  private async addPhoto(
    photo: DurablePhoto,
    tx: SqlExecutor,
    status: 'pending' | 'draft' = 'pending',
  ) {
    if (
      !photo.uri ||
      !photo.uri.includes('/Documents/') ||
      !Number.isInteger(photo.size) ||
      photo.size < 1 ||
      photo.size > 8388608 ||
      !/^\w{64}$/.test(photo.sha256) ||
      !/^[a-f0-9]{64}$/.test(photo.sha256)
    )
      throw new OfflineError(
        'PHOTO_NOT_DURABLE',
        'Copy and checksum the photo in document storage before saving.',
      );
    // Keep capture context outside the server cache, which can legitimately disappear.
    const record = (await this.records('food', tx)).find((r) => r.id === photo.entryId);
    const retainedEntry = photo.retainedEntry ?? record?.value;
    await tx.run(
      'INSERT INTO offline_photos(partition,id,entry_id,value,status) VALUES(?,?,?,?,?) ON CONFLICT(partition,id) DO UPDATE SET value=excluded.value,status=excluded.status',
      this.partitionKey,
      photo.id,
      photo.entryId,
      json({
        ...photo,
        retainedEntry,
        attempts: photo.attempts ?? 0,
        delivery: photo.delivery ?? 'never-sent',
      }),
      status,
    );
  }
  async photos() {
    return (
      await this.db.all<{ value: string; status: string }>(
        'SELECT value,status FROM offline_photos WHERE partition=?',
        this.partitionKey,
      )
    ).map((r) => ({ ...(JSON.parse(r.value) as DurablePhoto), status: r.status }));
  }
  async updatePhoto(photo: DurablePhoto, status: 'pending' | 'synced' | 'needs-attention') {
    const previous = (await this.photos()).find((p) => p.id === photo.id);
    if (previous) {
      for (const key of [
        'uri',
        'sha256',
        'size',
        'entryId',
        'operationId',
        'attemptEpoch',
        'uploadId',
        'allocationRevision',
        'finalizeRevision',
      ] as const) {
        if (previous[key] !== undefined && previous[key] !== photo[key])
          throw new OfflineError(
            'PHOTO_ATTEMPT_IMMUTABLE',
            'Earlier upload details must remain unchanged. Save a reviewed copy with new identities.',
          );
      }
      if ((photo.attempts ?? 0) < (previous.attempts ?? 0))
        throw new OfflineError(
          'PHOTO_ATTEMPT_IMMUTABLE',
          'Earlier upload attempts must remain recorded.',
        );
    }
    await this.db.run(
      'UPDATE offline_photos SET value=?,status=? WHERE partition=? AND id=?',
      json({
        ...photo,
        retainedEntry: previous?.retainedEntry ?? photo.retainedEntry,
        recoveryEntryId: previous?.recoveryEntryId ?? photo.recoveryEntryId,
        recoveryOperationId: previous?.recoveryOperationId ?? photo.recoveryOperationId,
      }),
      status,
      this.partitionKey,
      photo.id,
    );
  }
  async requeueReviewedPhoto(oldId: string, id: string, operationId: string, entryId?: string) {
    await this.db.transaction(async (tx) => {
      const rows = await tx.all<{ value: string; status: string }>(
        'SELECT value,status FROM offline_photos WHERE partition=? AND id=?',
        this.partitionKey,
        oldId,
      );
      if (rows[0]?.status !== 'needs-attention' || id === oldId)
        throw new OfflineError('REVIEW_REQUIRED', 'Choose a retained photo and a new identity.');
      const old = JSON.parse(rows[0].value) as DurablePhoto;
      const targetId = entryId ?? old.entryId;
      if (targetId !== old.entryId) {
        const target = (await this.records('food', tx)).find((r) => r.id === targetId);
        const confirmed = target?.confirmed as { deletedAt?: string | null } | null;
        if (
          old.recoveryEntryId !== targetId ||
          !confirmed ||
          confirmed.deletedAt ||
          target?.status !== 'synced'
        )
          throw new OfflineError(
            'REVIEW_REQUIRED',
            'The new diary entry must be server confirmed first.',
          );
      }
      await this.addPhoto(
        {
          id,
          operationId,
          entryId: targetId,
          uri: old.uri,
          size: old.size,
          sha256: old.sha256,
          attempts: 0,
          delivery: 'never-sent',
        },
        tx,
      );
      await tx.run(
        "UPDATE offline_photos SET status='discarded' WHERE partition=? AND id=?",
        this.partitionKey,
        oldId,
      );
    });
  }
  async forkRetainedPhotoEntry(
    photoId: string,
    entryId: string,
    operationId: string,
    epoch: string,
  ) {
    return this.db.transaction(async (tx) => {
      const state = await this.state(tx);
      if (state.signedOut || state.epoch !== epoch)
        throw new OfflineError('REVIEW_EXPIRED', 'Check the current server again.');
      const row = (
        await tx.all<{ value: string; status: string }>(
          'SELECT value,status FROM offline_photos WHERE partition=? AND id=?',
          this.partitionKey,
          photoId,
        )
      )[0];
      const photo = row ? (JSON.parse(row.value) as DurablePhoto) : null;
      if (!photo || row.status !== 'needs-attention' || photo.recoveryEntryId)
        throw new OfflineError(
          'REVIEW_REQUIRED',
          'Review the retained diary entry or its earlier recovery submission.',
        );
      const catalogue = await this.records(undefined, tx);
      const original = catalogue.find((r) => r.recordType === 'food' && r.id === photo.entryId);
      if (original?.confirmed && !(original.confirmed as { deletedAt?: string | null }).deletedAt)
        throw new OfflineError(
          'REVIEW_EXPIRED',
          'The original entry is available. Review it again.',
        );
      if (
        entryId === photo.entryId ||
        catalogue.some((r) => r.id === entryId) ||
        (await this.outbox(tx)).some((o) => o.operationId === operationId)
      )
        throw new OfflineError('NEW_ID_REQUIRED', 'Use fresh diary and operation identities.');
      const retained = FoodEntrySchema.parse(photo.retainedEntry);
      const command = parseOfflineCommand({
        type: 'food.create',
        operationId,
        entryId,
        expectedRevision: 0,
        content: retained.content,
      });
      const now = new Date().toISOString();
      const value = reduceOffline(null, command, now, catalogue);
      await tx.run(
        'INSERT INTO offline_outbox(partition,operation_id,aggregate,payload,local_at,dependencies,state) VALUES(?,?,?,?,?,?,?)',
        this.partitionKey,
        operationId,
        `food:${entryId}`,
        json(command),
        now,
        '[]',
        'never-sent',
      );
      await tx.run(
        'INSERT INTO offline_records(partition,aggregate,record_type,id,revision,confirmed,projection,status) VALUES(?,?,?,?,?,?,?,?)',
        this.partitionKey,
        `food:${entryId}`,
        'food',
        entryId,
        1,
        null,
        json(value),
        'pending',
      );
      // Link all sibling captures to this text recovery; do not create upload work before acknowledgement.
      for (const sibling of await tx.all<{ id: string; value: string }>(
        "SELECT id,value FROM offline_photos WHERE partition=? AND entry_id=? AND status='needs-attention'",
        this.partitionKey,
        photo.entryId,
      )) {
        const saved = JSON.parse(sibling.value) as DurablePhoto;
        if (!saved.recoveryEntryId)
          await tx.run(
            'UPDATE offline_photos SET value=? WHERE partition=? AND id=?',
            json({ ...saved, recoveryEntryId: entryId, recoveryOperationId: operationId }),
            this.partitionKey,
            sibling.id,
          );
      }
      return value;
    });
  }
  async assertLogoutAllowed(): Promise<void> {
    if (
      (await this.outbox()).some((o) => !['synced', 'discarded'].includes(o.state)) ||
      (await this.photos()).some((p) => !['synced', 'discarded'].includes(p.status))
    )
      throw new OfflineError(
        'PENDING_CHANGES',
        'Pending edits and photos remain on this device. Export, discard, or retain them explicitly before logout.',
      );
  }
  async signOut(retainPending = false) {
    if (!retainPending) await this.assertLogoutAllowed();
    await this.db.transaction(async (tx) => {
      const s = await this.state(tx);
      s.signedOut = true;
      await this.setState(s, tx);
    });
  }
  async signIn() {
    await this.db.transaction(async (tx) => {
      const s = await this.state(tx);
      s.signedOut = false;
      await this.setState(s, tx);
    });
  }
  async exportPending() {
    return json({
      partition: this.partition,
      state: await this.state(),
      outbox: await this.outbox(),
      records: await this.records(),
      conflicts: await this.conflicts(),
      photos: await this.photos(),
    });
  }
  private assertIdentity(page: Partition & { schemaVersion: number }) {
    if (
      page.schemaVersion !== 1 ||
      page.ownerId !== this.partition.ownerId ||
      page.installationId !== this.partition.installationId
    )
      throw new OfflineError(
        'PARTITION_MISMATCH',
        'The response belongs to a different account or installation.',
      );
  }
  async observeEpoch(epoch: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const s = await this.state(tx);
      if (s.epoch === null || s.epoch === epoch) return false;
      s.replayPaused = true;
      await this.setState(s, tx);
      await tx.run(
        "UPDATE offline_photos SET status='needs-attention' WHERE partition=? AND status IN ('pending','draft')",
        this.partitionKey,
      );
      await tx.run(
        "UPDATE offline_records SET status='needs-attention' WHERE partition=? AND status='pending'",
        this.partitionKey,
      );
      await tx.run(
        `UPDATE offline_outbox SET state='review',error='Server restored. Reconcile previous attempts; revalidate unsent work.' WHERE partition=? AND state IN (${pendingStates})`,
        this.partitionKey,
      );
      return true;
    });
  }
  async stageSnapshot(page: SnapshotPage, ordinal = '0'): Promise<void> {
    this.assertIdentity(page);
    await this.observeEpoch(page.epoch);
    await this.db.transaction(async (tx) => {
      const existing = await tx.all<{ page: string }>(
        'SELECT page FROM offline_snapshot WHERE partition=? AND snapshot_id=?',
        this.partitionKey,
        page.snapshotId,
      );
      for (const p of existing) {
        const old = JSON.parse(p.page) as SnapshotPage;
        if (old.epoch !== page.epoch || old.watermark !== page.watermark)
          throw new OfflineError(
            'INCONSISTENT_SNAPSHOT',
            'Snapshot pages changed watermark. Restart the snapshot.',
          );
      }
      await tx.run(
        'INSERT OR REPLACE INTO offline_snapshot(partition,snapshot_id,ordinal,page) VALUES(?,?,?,?)',
        this.partitionKey,
        page.snapshotId,
        ordinal,
        json(page),
      );
      if (page.nextCursor !== null) return;
      const staged = await tx.all<{ ordinal: string; page: string }>(
        'SELECT ordinal,page FROM offline_snapshot WHERE partition=? AND snapshot_id=?',
        this.partitionKey,
        page.snapshotId,
      );
      const pages = new Map(staged.map((p) => [p.ordinal, JSON.parse(p.page) as SnapshotPage]));
      let at: string | null = '0';
      const complete: SyncRecord[] = [];
      const seen = new Set<string>();
      while (at !== null) {
        if (seen.has(at) || !pages.has(at))
          throw new OfflineError('INCOMPLETE_SNAPSHOT', 'A snapshot page is missing.');
        seen.add(at);
        const p: SnapshotPage = pages.get(at)!;
        complete.push(...p.records);
        at = p.nextCursor;
      }
      // Delete only confirmed-only cache records absent from the snapshot. Local pending work remains recoverable.
      const keys = new Set(complete.map((r) => `${r.recordType}:${r.id}`));
      for (const r of await tx.all<RecordRow>(
        'SELECT * FROM offline_records WHERE partition=?',
        this.partitionKey,
      )) {
        if (keys.has(r.aggregate)) continue;
        const pending = await tx.all(
          `SELECT operation_id FROM offline_outbox WHERE partition=? AND aggregate=? AND state IN (${pendingStates})`,
          this.partitionKey,
          r.aggregate,
        );
        // Older captures also receive an immutable copy before cache replacement.
        const photos = await tx.all<{ id: string; value: string; status: string }>(
          "SELECT id,value,status FROM offline_photos WHERE partition=? AND entry_id=? AND status NOT IN ('synced','discarded')",
          this.partitionKey,
          r.id,
        );
        if (r.record_type === 'food')
          for (const row of photos) {
            const photo = JSON.parse(row.value) as DurablePhoto;
            await tx.run(
              "UPDATE offline_photos SET value=?,status='needs-attention' WHERE partition=? AND id=?",
              json({ ...photo, retainedEntry: photo.retainedEntry ?? JSON.parse(r.projection) }),
              this.partitionKey,
              row.id,
            );
          }
        if (pending.length)
          await tx.run(
            'UPDATE offline_records SET confirmed=NULL WHERE partition=? AND aggregate=?',
            this.partitionKey,
            r.aggregate,
          );
        else
          await tx.run(
            'DELETE FROM offline_records WHERE partition=? AND aggregate=?',
            this.partitionKey,
            r.aggregate,
          );
      }
      for (const r of complete) await this.applyConfirmed(r, tx, true);
      const s = await this.state(tx);
      s.epoch = page.epoch;
      s.cursor = page.watermark;
      await this.setState(s, tx);
      await tx.run('DELETE FROM offline_snapshot WHERE partition=?', this.partitionKey);
    });
  }
  async applyFeed(page: FeedPage): Promise<void> {
    this.assertIdentity(page);
    if (await this.observeEpoch(page.epoch))
      throw new OfflineError(
        'SYNC_EPOCH_CHANGED',
        'The server was restored. Download a snapshot and review local work.',
      );
    await this.db.transaction(async (tx) => {
      const s = await this.state(tx);
      if (s.epoch !== page.epoch)
        throw new OfflineError('SNAPSHOT_REQUIRED', 'Download a consistent snapshot first.');
      if (BigInt(page.cursor) < BigInt(s.cursor)) return;
      for (const r of page.records) await this.applyConfirmed(r, tx);
      s.cursor = page.cursor;
      await this.setState(s, tx);
    });
  }
  private async applyConfirmed(r: SyncRecord, tx: SqlExecutor, snapshotReplace = false) {
    const aggregate = `${r.recordType}:${r.id}`;
    const old = (
      await tx.all<RecordRow>(
        'SELECT * FROM offline_records WHERE partition=? AND aggregate=?',
        this.partitionKey,
        aggregate,
      )
    )[0];
    if (
      !snapshotReplace &&
      old?.confirmed &&
      (JSON.parse(old.confirmed) as { revision: number }).revision > r.revision
    )
      return;
    const pending = await tx.all(
      `SELECT operation_id FROM offline_outbox WHERE partition=? AND aggregate=? AND state IN (${pendingStates})`,
      this.partitionKey,
      aggregate,
    );
    await tx.run(
      'INSERT INTO offline_records(partition,aggregate,record_type,id,revision,confirmed,projection,status) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(partition,aggregate) DO UPDATE SET confirmed=excluded.confirmed,projection=excluded.projection,revision=excluded.revision,status=excluded.status',
      this.partitionKey,
      aggregate,
      r.recordType,
      r.id,
      pending.length && old ? old.revision : r.revision,
      json(r.value),
      pending.length && old ? old.projection : json(r.value),
      pending.length && old ? old.status : 'synced',
    );
    if (r.recordType === 'session') {
      const value = pending.length && old ? JSON.parse(old.projection) : r.value;
      const state = await this.state(tx);
      state.activeSessionId =
        (value as { status: string }).status === 'active'
          ? r.id
          : state.activeSessionId === r.id
            ? null
            : state.activeSessionId;
      await this.setState(state, tx);
    }
  }
  async markAttempt(operationId: string): Promise<void> {
    await this.db.run(
      "UPDATE offline_outbox SET state='attempted',attempts=attempts+1 WHERE partition=? AND operation_id=? AND state IN ('never-sent','uncertain')",
      this.partitionKey,
      operationId,
    );
  }
  async requireAttemptReview(operationId: string, error: string) {
    await this.db.run(
      "UPDATE offline_outbox SET state='review',error=? WHERE partition=? AND operation_id=? AND attempts>0",
      error,
      this.partitionKey,
      operationId,
    );
  }
  async markUncertain(operationId: string, attempts: number) {
    await this.db.run(
      "UPDATE offline_outbox SET state='uncertain',next_attempt_at=?,error='Connection interrupted; the server may have saved this operation.' WHERE partition=? AND operation_id=?",
      Date.now() + Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)),
      this.partitionKey,
      operationId,
    );
  }
  async accept(operationId: string, records: SyncRecord[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const operation = (await this.outbox(tx)).find((o) => o.operationId === operationId);
      if (!operation) throw new OfflineError('OPERATION_NOT_FOUND', 'Unknown local operation.');
      const before = (await this.records(undefined, tx)).find(
        (r) => `${r.recordType}:${r.id}` === operation.aggregate,
      );
      await tx.run(
        "UPDATE offline_outbox SET state='synced',error=NULL WHERE partition=? AND operation_id=?",
        this.partitionKey,
        operationId,
      );
      for (const r of records) await this.applyConfirmed(r, tx);
      const current = (await this.records(undefined, tx)).find(
        (r) => `${r.recordType}:${r.id}` === operation.aggregate,
      );
      if (!current?.confirmed)
        throw new OfflineError(
          'INVALID_ACK',
          'The server acknowledgement omitted the edited record.',
        );
      let value: unknown = current.confirmed;
      const remaining = (await this.outbox(tx)).filter(
        (o) => o.aggregate === operation.aggregate && !['synced', 'discarded'].includes(o.state),
      );
      try {
        for (const o of remaining) {
          if (['conflict', 'review'].includes(o.state))
            throw new OfflineError('REVIEW_REQUIRED', 'A local change requires review.');
          value = reduceOffline(
            value,
            JSON.parse(o.payload),
            o.localAt,
            await this.records(undefined, tx),
          );
        }
      } catch {
        if (remaining[0])
          await this.conflictInTx(
            remaining[0],
            before?.value ?? value,
            current.confirmed,
            'Server acknowledgement changed the local assumptions. Review retained edits.',
            tx,
          );
        return;
      }
      await tx.run(
        'UPDATE offline_records SET projection=?,revision=?,status=? WHERE partition=? AND aggregate=?',
        json(value),
        (value as { revision: number }).revision,
        remaining.length ? 'pending' : 'synced',
        this.partitionKey,
        operation.aggregate,
      );
      if (current.recordType === 'session') {
        const s = await this.state(tx);
        s.activeSessionId =
          (value as { status: string }).status === 'active'
            ? current.id
            : s.activeSessionId === current.id
              ? null
              : s.activeSessionId;
        await this.setState(s, tx);
      }
    });
  }
  private async conflictInTx(
    operation: OutboxEntry,
    local: unknown,
    server: unknown,
    error: string,
    tx: SqlExecutor,
  ) {
    await tx.run(
      'INSERT OR REPLACE INTO offline_conflicts(partition,operation_id,local_value,server_value,error) VALUES(?,?,?,?,?)',
      this.partitionKey,
      operation.operationId,
      json(local),
      server === null ? null : json(server),
      error,
    );
    await tx.run(
      "UPDATE offline_outbox SET state='conflict',error=? WHERE partition=? AND operation_id=?",
      error,
      this.partitionKey,
      operation.operationId,
    );
    await tx.run(
      "UPDATE offline_records SET status='needs-attention' WHERE partition=? AND aggregate=?",
      this.partitionKey,
      operation.aggregate,
    );
  }
  async reject(operationId: string, error: string) {
    await this.db.transaction(async (tx) => {
      const o = (await this.outbox(tx)).find((o) => o.operationId === operationId);
      const record = (await this.records(undefined, tx)).find(
        (r) => `${r.recordType}:${r.id}` === o?.aggregate,
      );
      if (o && record) await this.conflictInTx(o, record.value, record.confirmed, error, tx);
    });
  }
  async keepServer(aggregate: string) {
    await this.db.transaction(async (tx) => {
      const preserved = (await this.records(undefined, tx)).find(
        (r) => `${r.recordType}:${r.id}` === aggregate,
      );
      if (preserved)
        for (const operation of (await this.outbox(tx)).filter(
          (o) => o.aggregate === aggregate && !['synced', 'discarded'].includes(o.state),
        ))
          await tx.run(
            'INSERT OR IGNORE INTO offline_conflicts(partition,operation_id,local_value,server_value,error) VALUES(?,?,?,?,?)',
            this.partitionKey,
            operation.operationId,
            json(preserved.value),
            preserved.confirmed ? json(preserved.confirmed) : null,
            'Owner chose the server version; local copy retained.',
          );
      await tx.run(
        `UPDATE offline_outbox SET state='discarded',error='Owner chose server version; local copies remain in export.' WHERE partition=? AND aggregate=? AND state IN (${pendingStates})`,
        this.partitionKey,
        aggregate,
      );
      const row = (
        await tx.all<RecordRow>(
          'SELECT * FROM offline_records WHERE partition=? AND aggregate=?',
          this.partitionKey,
          aggregate,
        )
      )[0];
      if (row?.confirmed)
        await tx.run(
          "UPDATE offline_records SET projection=confirmed,revision=?,status='synced' WHERE partition=? AND aggregate=?",
          (JSON.parse(row.confirmed) as { revision: number }).revision,
          this.partitionKey,
          aggregate,
        );
      else
        await tx.run(
          'DELETE FROM offline_records WHERE partition=? AND aggregate=?',
          this.partitionKey,
          aggregate,
        );
    });
  }
  /** Review is explicit: existing bytes/IDs are immutable. Resubmit with a NEW ID via save after keepServer; fork a tombstone with a NEW record ID. */
  async revalidateNeverSent(operationId: string) {
    await this.db.transaction(async (tx) => {
      const o = (await this.outbox(tx)).find((o) => o.operationId === operationId);
      if (!o || o.attempts !== 0 || o.state !== 'review')
        throw new OfflineError(
          'RECONCILE_REQUIRED',
          'Previously attempted work requires explicit reconciliation.',
        );
      const records = await this.records(undefined, tx);
      const r = records.find((r) => `${r.recordType}:${r.id}` === o.aggregate);
      const dependencyOps = (await this.outbox(tx)).filter((p) =>
        o.dependencies.includes(p.operationId),
      );
      if (dependencyOps.some((p) => p.state !== 'synced'))
        throw new OfflineError(
          'DEPENDENCY_BLOCKED',
          'Review and synchronize its prerequisite first.',
        );
      reduceOffline(r?.confirmed ?? null, JSON.parse(o.payload), o.localAt, records);
      await tx.run(
        "UPDATE offline_outbox SET state='never-sent',error=NULL WHERE partition=? AND operation_id=?",
        this.partitionKey,
        operationId,
      );
    });
  }
  async getDraft<T>(key: string): Promise<T | null> {
    const row = (
      await this.db.all<{ value: string }>(
        'SELECT value FROM offline_drafts WHERE partition=? AND key=?',
        this.partitionKey,
        key,
      )
    )[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }
  async setDraft(key: string, value: unknown): Promise<void> {
    // This store is content-only. Reject common credential containers rather than accepting an auth/session object.
    const rejectCredentials = (v: unknown): void => {
      if (v && typeof v === 'object')
        for (const [name, item] of Object.entries(v)) {
          if (
            /^(cookie|authorization|accessToken|refreshToken|password|secret|sessionToken)$/i.test(
              name,
            )
          )
            throw new OfflineError(
              'CREDENTIAL_STORAGE_FORBIDDEN',
              'Credentials must stay in OS secure storage.',
            );
          rejectCredentials(item);
        }
    };
    rejectCredentials(value);
    await this.db.transaction(async (tx) => {
      if (value === null)
        await tx.run(
          'DELETE FROM offline_drafts WHERE partition=? AND key=?',
          this.partitionKey,
          key,
        );
      else
        await tx.run(
          'INSERT OR REPLACE INTO offline_drafts(partition,key,value) VALUES(?,?,?)',
          this.partitionKey,
          key,
          json(value),
        );
    });
  }
  async ingestValidatedRecords(records: SyncRecord[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const record of records) await this.applyConfirmed(record, tx);
    });
  }
  async discardPending(): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Explicit user choice only. Keep archived immutable commands/conflict copies exportable; never silently purge bytes.
      await tx.run(
        `UPDATE offline_outbox SET state='discarded',error='Owner explicitly discarded pending work.' WHERE partition=? AND state IN (${pendingStates})`,
        this.partitionKey,
      );
      for (const row of await tx.all<RecordRow>(
        'SELECT * FROM offline_records WHERE partition=?',
        this.partitionKey,
      )) {
        if (row.confirmed)
          await tx.run(
            "UPDATE offline_records SET projection=confirmed,revision=?,status='synced' WHERE partition=? AND aggregate=?",
            (JSON.parse(row.confirmed) as { revision: number }).revision,
            this.partitionKey,
            row.aggregate,
          );
        else
          await tx.run(
            'DELETE FROM offline_records WHERE partition=? AND aggregate=?',
            this.partitionKey,
            row.aggregate,
          );
      }
      await tx.run(
        "UPDATE offline_photos SET status='discarded' WHERE partition=? AND status!='synced'",
        this.partitionKey,
      );
      await tx.run('DELETE FROM offline_drafts WHERE partition=?', this.partitionKey);
      const state = await this.state(tx);
      state.activeSessionId = null;
      await this.setState(state, tx);
    });
  }
  async reconcileAttempted(
    operationId: string,
    choice: 'already-applied' | 'reviewed-absent',
    records: SyncRecord[] = [],
  ): Promise<void> {
    const operation = (await this.outbox()).find((o) => o.operationId === operationId);
    if (!operation || operation.attempts === 0 || operation.state !== 'review')
      throw new OfflineError(
        'RECONCILE_REQUIRED',
        'Choose a previously attempted operation awaiting review.',
      );
    if (choice === 'already-applied') {
      await this.accept(operationId, records);
      return;
    }
    throw new OfflineError(
      'NEW_ID_REQUIRED',
      'After checking the original outcome, save reviewed work as a new operation. The old attempt stays archived.',
    );
  }
  async saveReviewed(
    operationId: string,
    newOperationId: string,
    proof: { epoch: string; revision: number | null; outcomeChecked: boolean },
    newRecordId?: string,
    photoCopies: { oldId: string; id: string; operationId: string }[] = [],
  ): Promise<LocalRecord> {
    return this.db.transaction(async (tx) => {
      const state = await this.state(tx);
      if (state.signedOut || !state.epoch || state.epoch !== proof.epoch)
        throw new OfflineError(
          'REVIEW_EXPIRED',
          'Sign in and check the current server version again.',
        );
      const all = await this.outbox(tx);
      const old = all.find((o) => o.operationId === operationId);
      if (!old || !['review', 'conflict'].includes(old.state))
        throw new OfflineError('REVIEW_REQUIRED', 'Choose a retained change awaiting review.');
      if (old.attempts && !proof.outcomeChecked)
        throw new OfflineError(
          'RECONCILE_REQUIRED',
          'Check whether the original attempt saved before creating a new submission.',
        );
      if (all.some((o) => o.operationId === newOperationId))
        throw new OfflineError('NEW_ID_REQUIRED', 'Use a fresh operation identity.');
      const catalogue = await this.records(undefined, tx);
      const record = catalogue.find((r) => `${r.recordType}:${r.id}` === old.aggregate);
      if (
        !record ||
        ((record.confirmed as { revision?: number } | null)?.revision ?? null) !== proof.revision
      )
        throw new OfflineError('REVIEW_EXPIRED', 'The server version changed. Review it again.');
      if (
        !newRecordId &&
        old.dependencies.some(
          (id) => !all.some((o) => o.operationId === id && o.state === 'synced'),
        )
      )
        throw new OfflineError('DEPENDENCY_BLOCKED', 'Save or keep the earlier change first.');
      const command = recoveryCommand(old, record, newOperationId, newRecordId);
      const aggregate = aggregateOf(command);
      const value = reduceOffline(
        newRecordId ? null : record.confirmed,
        command,
        old.localAt,
        catalogue,
      );
      await tx.run(
        'INSERT OR IGNORE INTO offline_conflicts(partition,operation_id,local_value,server_value,error) VALUES(?,?,?,?,?)',
        this.partitionKey,
        old.operationId,
        json(record.value),
        record.confirmed ? json(record.confirmed) : null,
        'Owner reviewed and saved a new operation; original attempt retained.',
      );
      await tx.run(
        "UPDATE offline_outbox SET state='discarded',error='Owner saved reviewed work with a new identity.' WHERE partition=? AND operation_id=?",
        this.partitionKey,
        old.operationId,
      );
      for (const dependent of all.filter(
        (o) =>
          o.dependencies.includes(old.operationId) && !['synced', 'discarded'].includes(o.state),
      ))
        await tx.run(
          "UPDATE offline_outbox SET dependencies=?,state='review',error=? WHERE partition=? AND operation_id=?",
          json(dependent.dependencies.map((id) => (id === old.operationId ? newOperationId : id))),
          'Review after the earlier recovered change synchronizes.',
          this.partitionKey,
          dependent.operationId,
        );
      await tx.run(
        'INSERT INTO offline_outbox(partition,operation_id,aggregate,payload,local_at,dependencies,state) VALUES(?,?,?,?,?,?,?)',
        this.partitionKey,
        newOperationId,
        aggregate,
        json(command),
        old.localAt,
        json(newRecordId ? [] : old.dependencies),
        'never-sent',
      );
      const id = newRecordId ?? record.id;
      await tx.run(
        'INSERT INTO offline_records(partition,aggregate,record_type,id,revision,confirmed,projection,status) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(partition,aggregate) DO UPDATE SET projection=excluded.projection,revision=excluded.revision,status=excluded.status',
        this.partitionKey,
        aggregate,
        record.recordType,
        id,
        (value as { revision: number }).revision,
        newRecordId ? null : json(record.confirmed),
        json(value),
        'pending',
      );
      if (newRecordId) {
        if (record.recordType === 'food')
          for (const copy of photoCopies) {
            const rows = await tx.all<{ value: string; status: string }>(
              'SELECT value,status FROM offline_photos WHERE partition=? AND id=?',
              this.partitionKey,
              copy.oldId,
            );
            const oldPhoto = rows[0] ? (JSON.parse(rows[0].value) as DurablePhoto) : null;
            if (
              !oldPhoto ||
              oldPhoto.entryId !== record.id ||
              ['synced', 'discarded'].includes(rows[0].status) ||
              copy.oldId === copy.id
            )
              throw new OfflineError(
                'REVIEW_EXPIRED',
                'The retained photos changed. Review them again.',
              );
            await this.addPhoto(
              {
                id: copy.id,
                operationId: copy.operationId,
                entryId: newRecordId,
                uri: oldPhoto.uri,
                size: oldPhoto.size,
                sha256: oldPhoto.sha256,
                attempts: 0,
                delivery: 'never-sent',
              },
              tx,
            );
            await tx.run(
              "UPDATE offline_photos SET status='needs-attention' WHERE partition=? AND id=?",
              this.partitionKey,
              copy.id,
            );
            await tx.run(
              "UPDATE offline_photos SET status='discarded' WHERE partition=? AND id=?",
              this.partitionKey,
              copy.oldId,
            );
          }
        if (record.confirmed)
          await tx.run(
            "UPDATE offline_records SET projection=confirmed,revision=?,status='synced' WHERE partition=? AND aggregate=?",
            (record.confirmed as { revision: number }).revision,
            this.partitionKey,
            old.aggregate,
          );
        // A missing original stays retained for other pending edits; never resurrect it.
      }
      return {
        recordType: record.recordType,
        id,
        revision: (value as { revision: number }).revision,
        value,
        confirmed: newRecordId ? null : record.confirmed,
        status: 'pending',
      };
    });
  }
  async resumeAfterReview() {
    await this.db.transaction(async (tx) => {
      const s = await this.state(tx);
      if (
        (await this.outbox(tx)).some((o) =>
          ['review', 'conflict', 'attempted', 'uncertain'].includes(o.state),
        ) ||
        (
          await tx.all<{ status: string }>(
            'SELECT status FROM offline_photos WHERE partition=?',
            this.partitionKey,
          )
        ).some((p) => p.status === 'needs-attention')
      )
        throw new OfflineError(
          'REVIEW_REQUIRED',
          'Review every retained change and photo before resuming.',
        );
      s.replayPaused = false;
      await this.setState(s, tx);
    });
  }
}
export type DurablePhoto = {
  id: string;
  entryId: string;
  uri: string;
  size: number;
  sha256: string;
  operationId: string;
  uploadId?: string;
  attemptEpoch?: string;
  recoveredMediaId?: string;
  retainedEntry?: unknown;
  recoveryEntryId?: string;
  recoveryOperationId?: string;
  allocationRevision?: number;
  finalizeRevision?: number;
  attempts?: number;
  delivery?: 'never-sent' | 'attempted' | 'uncertain' | 'synced' | 'review';
};
