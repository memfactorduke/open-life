import { z } from 'zod';
export const AgentScopeSchema = z.enum([
  'tasks:read',
  'tasks:write',
  'workouts:read',
  'workouts:plan',
  'workouts:record',
  'food:read',
  'food:write',
  'food:attach',
  'whoop:read',
]);
export type AgentScope = z.infer<typeof AgentScopeSchema>;
export const AgentGrantCreateSchema = z.strictObject({
  operationId: z.uuid(),
  label: z.string().trim().min(1).max(100),
  scopes: z
    .array(AgentScopeSchema)
    .min(1)
    .max(9)
    .refine((v) => new Set(v).size === v.length, 'Duplicate scope.'),
  expiresAt: z.iso.datetime(),
});
export const AgentGrantRevokeSchema = z.strictObject({ operationId: z.uuid(), grantId: z.uuid() });
export const ReportedSourceSchema = z.strictObject({
  kind: z.enum(['reported', 'imported']),
  reference: z.string().trim().min(1).max(500),
  reportedAt: z.iso.datetime(),
});
export const AgentGrantSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().min(1).max(100),
  scopes: z.array(AgentScopeSchema),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const AgentGrantListSchema = z.strictObject({ grants: z.array(AgentGrantSchema) });
export const AgentGrantIssueResponseSchema = z.strictObject({
  grant: AgentGrantSchema.pick({ id: true, label: true, scopes: true, expiresAt: true }),
  secret: z.string().regex(/^ml_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/),
});
export const AgentGrantRevokeResponseSchema = z.strictObject({
  grant: z.strictObject({ id: z.uuid(), revokedAt: z.iso.datetime() }),
});
