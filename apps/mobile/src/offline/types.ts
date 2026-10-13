import type { TaskCommand, SessionCommand, FoodCommand } from '@mems-life/domain';
export type OfflineCommand = TaskCommand | SessionCommand | FoodCommand;
export type Partition = { installationId: string; ownerId: string };
export type SyncRecord = { recordType: string; id: string; revision: number; value: unknown };
export type SnapshotPage = Partition & {
  schemaVersion: 1;
  epoch: string;
  watermark: string;
  snapshotId: string;
  records: SyncRecord[];
  nextCursor: string | null;
};
export type FeedPage = Partition & {
  schemaVersion: 1;
  epoch: string;
  watermark: string;
  records: SyncRecord[];
  cursor: string;
  hasMore: boolean;
};
export type OutboxState =
  'never-sent' | 'attempted' | 'uncertain' | 'synced' | 'conflict' | 'review' | 'discarded';
export type OutboxEntry = {
  operationId: string;
  aggregate: string;
  payload: string;
  localAt: string;
  dependencies: string[];
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
  error: string | null;
};
export type LocalRecord = SyncRecord & {
  confirmed: unknown | null;
  status: 'synced' | 'pending' | 'needs-attention';
};
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: (string | number | null)[]): Promise<void>;
  all<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
}
export interface SqlDatabase extends SqlExecutor {
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export interface OfflineTransport {
  snapshot(requestId: string, snapshotId?: string, cursor?: string): Promise<SnapshotPage>;
  changes(epoch: string, cursor: string): Promise<FeedPage>;
  send(command: OfflineCommand): Promise<SyncRecord[]>;
}
export class OfflineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OfflineError';
  }
}
export type SyncState = {
  epoch: string | null;
  cursor: string;
  replayPaused: boolean;
  activeSessionId: string | null;
  signedOut: boolean;
};
