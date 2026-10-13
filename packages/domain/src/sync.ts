import { z } from 'zod';

// Decimal strings prevent loss of PostgreSQL bigint precision on native clients.
export const SyncPositionSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const SyncRecordSchema = z.strictObject({
  recordType: z.enum([
    'preferences',
    'task',
    'exercise',
    'routine',
    'session',
    'food',
    'media',
    'taskFile',
    'board',
    'project',
    'series',
    'step',
    'skill',
    'binding',
    'attempt',
    'result',
    'provider',
    'connection',
  ]),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  value: z.unknown(),
});
export const SyncIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  ownerId: z.string().min(1),
  installationId: z.uuid(),
  epoch: z.uuid(),
  watermark: SyncPositionSchema,
});
export const SyncSnapshotRequestSchema = z.strictObject({
  requestId: z.uuid(),
  schemaVersion: z.literal(1),
});
export const SyncSnapshotPageSchema = SyncIdentitySchema.extend({
  snapshotId: z.uuid(),
  expiresAt: z.iso.datetime(),
  records: z.array(SyncRecordSchema),
  nextCursor: SyncPositionSchema.nullable(),
});
export const SyncChangeRecordSchema = SyncRecordSchema.extend({
  position: SyncPositionSchema,
  ordinal: z.number().int().nonnegative(),
  operationId: z.uuid(),
});
export const SyncChangesPageSchema = SyncIdentitySchema.extend({
  records: z.array(SyncChangeRecordSchema),
  cursor: SyncPositionSchema,
  hasMore: z.boolean(),
});
export type SyncRecord = z.infer<typeof SyncRecordSchema>;
export type SyncSnapshotPage = z.infer<typeof SyncSnapshotPageSchema>;
export type SyncChangesPage = z.infer<typeof SyncChangesPageSchema>;
