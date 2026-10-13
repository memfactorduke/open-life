import { z } from 'zod';
export const WhoopResourceSchema = z.enum(['workout', 'cycle', 'recovery', 'sleep']);
export type WhoopResource = z.infer<typeof WhoopResourceSchema>;
export const WhoopObservationSchema = z.object({
  accountId: z.uuid(),
  providerAccountId: z.string(),
  resource: WhoopResourceSchema,
  providerId: z.string(),
  revision: z.number().int().positive(),
  providerUpdatedAt: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  timezoneOffset: z.string().nullable(),
  retrievedAt: z.string(),
  scoreState: z.string(),
  score: z.record(z.string(), z.unknown()).nullable(),
  available: z.boolean(),
  currentAccount: z.boolean(),
  linkedSessionId: z.uuid().nullable(),
});
export type WhoopObservation = z.infer<typeof WhoopObservationSchema>;
export const WhoopStateSchema = z.object({
  configured: z.boolean(),
  revision: z.number().int().nonnegative(),
  status: z.enum(['unconfigured', 'disconnected', 'connected', 'reconnect']),
  accountId: z.uuid().nullable(),
  providerAccountId: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  error: z.string().nullable(),
  stale: z.boolean(),
  nextRefreshAt: z.string().nullable(),
  observations: z.array(WhoopObservationSchema),
});
export type WhoopState = z.infer<typeof WhoopStateSchema>;
export const WhoopCommandSchema = z.union([
  z.strictObject({
    type: z.literal('whoop.connect'),
    channel: z.enum(['web', 'native']).default('web'),
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.enum(['whoop.refresh', 'whoop.disconnect', 'whoop.delete-cache']),
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('whoop.refresh-observation'),
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    resource: WhoopResourceSchema,
    providerId: z.string().min(1).max(100),
  }),
  z.strictObject({
    type: z.literal('whoop.link'),
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    providerId: z.string().min(1).max(100),
    sessionId: z.uuid().nullable(),
  }),
]);
export type WhoopCommand = z.infer<typeof WhoopCommandSchema>;
export const WhoopCommandResponseSchema = z.object({
  state: WhoopStateSchema,
  operationId: z.uuid(),
  feedPosition: z.string(),
  authorizationUrl: z.string().url().optional(),
  revocation: z.enum(['succeeded', 'failed', 'not-connected']).optional(),
});
export function whoopWindow(connectedAt: Date, now: Date): Date {
  return new Date(Math.max(connectedAt.getTime() - 86400000, now.getTime() - 7 * 86400000));
}
