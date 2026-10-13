import { OfflineError, type OfflineTransport } from './types';
import { OfflineStore } from './store';
import { reduceOffline } from './reducers';
export class OfflineCoordinator {
  private running: Promise<void> | null = null;
  lastError: string | null = null;
  constructor(
    readonly store: OfflineStore,
    readonly transport: OfflineTransport,
    readonly randomId: () => string,
  ) {}
  /** Invoke on authenticated launch, foreground and reconnect. No terminated-app/background guarantee. */
  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.perform().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async bootstrap() {
    const requestId = this.randomId();
    let snapshotId: string | undefined;
    let cursor: string | undefined;
    for (let pages = 0; pages < 10000; pages++) {
      const page = await this.transport.snapshot(requestId, snapshotId, cursor);
      await this.store.stageSnapshot(page, cursor ?? '0');
      if (page.nextCursor === null) return;
      snapshotId = page.snapshotId;
      cursor = page.nextCursor;
    }
    throw new OfflineError(
      'SNAPSHOT_LIMIT',
      'The snapshot is too large. Retry after reviewing the installation.',
    );
  }
  private async perform() {
    this.lastError = null;
    try {
      let state = await this.store.state();
      if (state.signedOut) return;
      if (!state.epoch) await this.bootstrap();
      state = await this.store.state();
      let recoveredCursor = false;
      for (;;) {
        try {
          let more = true;
          for (let pages = 0; more && pages < 10000; pages++) {
            const page = await this.transport.changes(state.epoch!, state.cursor);
            await this.store.applyFeed(page);
            state = await this.store.state();
            more = page.hasMore;
          }
          if (more)
            throw new OfflineError(
              'FEED_LIMIT',
              'More changes remain to download. Retry synchronization before sending local work.',
            );
          break;
        } catch (error) {
          const failure = error as {
            code?: string;
            epoch?: string;
            details?: { rebootstrap?: boolean };
          };
          if (failure.code === 'SYNC_EPOCH_CHANGED') {
            await this.store.observeEpoch(failure.epoch ?? 'unknown-restored-epoch');
            await this.bootstrap();
            return;
          }
          // These feed failures describe a lost/unusable cursor, not a server restore.
          // Keep the old cursor until the frozen snapshot commits, then catch up
          // concurrent commits before considering any immutable pending commands.
          if (
            failure.details?.rebootstrap !== true ||
            !['SYNC_CURSOR_EXPIRED', 'SYNC_CURSOR_INVALID', 'SYNC_TRANSACTION_TOO_LARGE'].includes(
              failure.code ?? '',
            )
          )
            throw error;
          if (recoveredCursor)
            throw new OfflineError(
              'SYNC_RECOVERY_LIMIT',
              'Changes still exceed capacity or the cursor remains unavailable after a fresh snapshot. Local work remains saved; retry after reviewing the server.',
            );
          recoveredCursor = true;
          await this.bootstrap();
          state = await this.store.state();
          // A snapshot can independently reveal an actual epoch change. The
          // store has already retained work for review; do not replay it here.
          if (state.replayPaused) return;
        }
      }
      if ((await this.store.state()).replayPaused) return;
      for (const entry of await this.store.outbox()) {
        const state = await this.store.state();
        if (state.signedOut || state.replayPaused) return;
        if (!['never-sent', 'uncertain'].includes(entry.state) || entry.nextAttemptAt > Date.now())
          continue;
        const all = await this.store.outbox();
        if (
          entry.dependencies.some((id) => all.find((o) => o.operationId === id)?.state !== 'synced')
        )
          continue;
        if (recoveredCursor && entry.state === 'never-sent') {
          // Validate against the newly confirmed server version without changing
          // the original payload. Uncertain attempts must instead query their
          // existing receipt by resending the exact original operation.
          const records = await this.store.records();
          const current = records.find((r) => `${r.recordType}:${r.id}` === entry.aggregate);
          try {
            reduceOffline(
              current?.confirmed ?? null,
              JSON.parse(entry.payload),
              entry.localAt,
              records,
            );
          } catch {
            await this.store.reject(
              entry.operationId,
              'The server version changed. Review the retained local and server versions.',
            );
            continue;
          }
        }
        // Persist attempted before network dispatch; a crash at any later boundary is uncertain.
        await this.store.markAttempt(entry.operationId);
        try {
          const records = await this.transport.send(JSON.parse(entry.payload));
          await this.store.accept(entry.operationId, records);
        } catch (error) {
          const code = (error as { code?: string }).code;
          const status = (error as { status?: number }).status;
          if (code === 'SYNC_EPOCH_CHANGED') {
            await this.store.observeEpoch(
              (error as { epoch?: string }).epoch ?? 'unknown-restored-epoch',
            );
            await this.bootstrap();
            return;
          }
          if (status === 401 || status === 403 || code === 'UNAUTHORIZED') {
            await this.store.markUncertain(entry.operationId, entry.attempts + 1);
            this.lastError = 'Sign in again. Local changes remain saved.';
            return;
          }
          if (status === 409 || status === 404 || status === 400 || status === 422) {
            await this.store.reject(
              entry.operationId,
              'The server rejected this change. Review the local and server versions.',
            );
            continue;
          }
          await this.store.markUncertain(entry.operationId, entry.attempts + 1);
          this.lastError = 'Connection interrupted. Local changes remain saved.';
        }
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Synchronization failed.';
      throw error;
    }
  }
}
