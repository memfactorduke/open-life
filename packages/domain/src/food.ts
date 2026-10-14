import { z } from 'zod';
import { timeZoneSchema } from './foundation.js';
export const FoodTimezoneSchema = timeZoneSchema.max(100);
export const FoodContentSchema = z.strictObject({
  text: z.string().max(20_000),
  occurredAt: z.iso.datetime(),
  timezone: FoodTimezoneSchema,
});
export const FoodEntrySchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  content: FoodContentSchema,
  photoIds: z.array(z.uuid()).max(12),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
const base = {
  operationId: z.uuid(),
  entryId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
export const FoodCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('food.create'),
    expectedRevision: z.literal(0),
    content: FoodContentSchema,
  }),
  z.strictObject({ ...base, type: z.literal('food.edit'), content: FoodContentSchema }),
  z.strictObject({ ...base, type: z.literal('food.delete') }),
  z.strictObject({ ...base, type: z.literal('food.detach'), photoId: z.uuid() }),
]);
export const FoodListResponseSchema = z.strictObject({ entries: z.array(FoodEntrySchema) });
export const FoodResponseSchema = z.strictObject({ entry: FoodEntrySchema });
export const FoodCommandResponseSchema = z.strictObject({
  operationId: z.uuid(),
  feedPosition: z.string().regex(/^\d+$/),
  entry: FoodEntrySchema,
});
export const FoodHistorySchema = z.strictObject({
  events: z.array(
    z.strictObject({
      operationId: z.uuid(),
      type: z.string(),
      actorId: z.string(),
      actorType: z.enum(['owner', 'agent']),
      entry: FoodEntrySchema,
      createdAt: z.iso.datetime(),
    }),
  ),
});
export const FoodUploadSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  size: z
    .number()
    .int()
    .min(1)
    .max(8 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.enum(['image/jpeg', 'image/png']),
});
export const FoodUploadResponseSchema = z.strictObject({
  upload: z.strictObject({ id: z.uuid(), status: z.enum(['pending', 'received', 'finalized']) }),
});
export const FoodFinalizeSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().positive(),
});
export type FoodEntry = z.infer<typeof FoodEntrySchema>;
export type FoodCommand = z.infer<typeof FoodCommandSchema>;
export type FoodUpload = z.infer<typeof FoodUploadSchema>;
