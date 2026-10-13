import { z } from 'zod';
import { TaskSchema } from './tasks.js';
import { TaskStepSchema, StepContentSchema } from './steps.js';
const key = z.string().trim().min(1).max(100);
export const ArtifactReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ key, kind: z.literal('text'), text: z.string().min(1).max(100000) }),
  z.strictObject({
    key,
    kind: z.literal('link'),
    url: z
      .url()
      .max(2000)
      .refine((s) => {
        const u = new URL(s);
        return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
      }),
    description: z.string().max(2000),
  }),
  z.strictObject({
    key,
    kind: z.literal('file'),
    fileId: z.uuid(),
    description: z.string().max(2000),
  }),
]);
export const ResultRequirementSchema = z.strictObject({
  key,
  kind: z.enum(['text', 'link', 'file']),
  required: z.boolean(),
});
export const SkillContentSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(20000),
  resources: z
    .array(
      z
        .url()
        .max(2000)
        .refine((s) => ['https:', 'http:'].includes(new URL(s).protocol)),
    )
    .max(20),
  inputKeys: z.array(key).max(50),
  requirements: z.array(ResultRequirementSchema).min(1).max(50),
});
const operation = { operationId: z.uuid() };
const work = { ...operation, taskId: z.uuid(), stepId: z.uuid() };
const owned = {
  ...work,
  attemptId: z.uuid(),
  ownershipToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
};
const feedback = z.string().trim().min(1).max(20000);
export const AgentWorkflowCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...operation, type: z.literal('workflow.youtube-create'), taskId: z.uuid() }),
  z.strictObject({
    ...operation,
    type: z.literal('skill.put'),
    id: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    content: SkillContentSchema,
  }),
  z.strictObject({
    ...work,
    type: z.literal('binding.put'),
    expectedRevision: z.number().int().nonnegative(),
    skillId: z.uuid(),
    skillVersion: z.number().int().positive(),
    inputs: z.record(key, z.string().max(20000)),
    requirements: z.array(ResultRequirementSchema).min(1).max(50),
    risk: z.enum(['none', 'external-effect']),
    retryable: z.boolean(),
    requiresApproval: z.boolean().default(false),
  }),
  z.strictObject({
    ...work,
    type: z.literal('attempt.claim'),
    expectedStepRevision: z.number().int().positive(),
    ownershipToken: owned.ownershipToken,
  }),
  z.strictObject({ ...owned, type: z.literal('attempt.heartbeat') }),
  z.strictObject({ ...owned, type: z.literal('attempt.progress'), message: feedback }),
  z.strictObject({
    ...owned,
    type: z.literal('attempt.finish'),
    artifacts: z.array(ArtifactReferenceSchema).min(1).max(50),
    summary: feedback,
  }),
  z.strictObject({
    ...owned,
    type: z.literal('attempt.fail'),
    message: feedback,
    outcome: z.enum(['stopped', 'unknown']),
  }),
  z.strictObject({
    ...owned,
    type: z.literal('attempt.yield'),
    message: feedback,
    outcome: z.enum(['stopped', 'unknown']),
  }),
  z.strictObject({
    ...work,
    type: z.literal('attempt.cancel'),
    attemptId: z.uuid(),
    reason: feedback,
  }),
  z.strictObject({
    ...work,
    type: z.literal('attempt.reconcile'),
    workerStoppedEvidence: feedback.optional(),
    allowReplacement: z.boolean().default(false),
    attemptId: z.uuid(),
    outcome: z.enum(['not-performed', 'performed']),
    evidence: feedback,
    artifacts: z.array(ArtifactReferenceSchema).max(50),
  }),
  z.strictObject({
    ...work,
    type: z.literal('result.approve'),
    resultId: z.uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.strictObject({
    ...work,
    type: z.literal('result.request-changes'),
    resultId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    feedback,
  }),
]);
export type AgentWorkflowCommand = z.infer<typeof AgentWorkflowCommandSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
export type SkillContent = z.infer<typeof SkillContentSchema>;
export const SkillReferenceSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  versions: z.array(SkillContentSchema).min(1),
});
export const SkillBindingSchema = z.strictObject({
  taskId: z.uuid(),
  stepId: z.uuid(),
  revision: z.number().int().positive(),
  skillId: z.uuid(),
  skillVersion: z.number().int().positive(),
  inputs: z.record(key, z.string().max(20000)),
  requirements: z.array(ResultRequirementSchema).min(1).max(50),
  risk: z.enum(['none', 'external-effect']),
  retryable: z.boolean(),
  requiresApproval: z.boolean().default(false),
});
export const AgentAttemptSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  stepId: z.uuid(),
  revision: z.number().int().positive(),
  actorId: z.string().min(1).max(200),
  status: z.enum([
    'running',
    'cancel-requested',
    'submitted',
    'failed',
    'yielded',
    'outcome-unknown',
    'reconciled',
  ]),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  snapshot: z.strictObject({
    stepContent: StepContentSchema,
    stepRevision: z.number().int().positive(),
    binding: SkillBindingSchema,
    skill: SkillContentSchema,
    dependencyRevisions: z.record(z.uuid(), z.number().int().positive()).default({}),
  }),
  progress: z.array(z.strictObject({ at: z.iso.datetime(), message: feedback })).max(1000),
  error: feedback.nullable(),
  reconciliation: z
    .strictObject({
      outcome: z.enum(['not-performed', 'performed']),
      evidence: feedback,
      workerStoppedEvidence: feedback.nullable().default(null),
      replacementAuthorized: z.boolean().default(false),
      actorId: z.string().min(1).max(200),
      at: z.iso.datetime(),
    })
    .nullable(),
});
export const AgentResultSchema = z.strictObject({
  revision: z.number().int().positive(),
  id: z.uuid(),
  taskId: z.uuid(),
  stepId: z.uuid(),
  attemptId: z.uuid(),
  version: z.number().int().positive(),
  artifacts: z.array(ArtifactReferenceSchema).min(1).max(50),
  summary: feedback,
  approvedAt: z.iso.datetime().nullable(),
  approvedBy: z.string().min(1).max(200).nullable(),
  feedback: feedback.nullable(),
  createdAt: z.iso.datetime(),
});
export const AgentWorkflowResponseSchema = z.strictObject({
  task: TaskSchema,
  steps: z.array(TaskStepSchema),
  bindings: z.array(SkillBindingSchema),
  attempts: z.array(
    AgentAttemptSchema.extend({
      effectiveStatus: z.enum([
        'running',
        'cancel-requested',
        'submitted',
        'failed',
        'yielded',
        'outcome-unknown',
        'reconciled',
        'expired',
      ]),
    }),
  ),
  results: z.array(AgentResultSchema),
  skills: z.array(SkillReferenceSchema),
});
export const EligibleAgentStepsSchema = z.strictObject({
  eligible: z.array(
    z.strictObject({ task: TaskSchema, step: TaskStepSchema, binding: SkillBindingSchema }),
  ),
});
export const AgentSkillsSchema = z.strictObject({ skills: z.array(SkillReferenceSchema) });
export const AgentWorkflowCommandResponseSchema = z.strictObject({
  operationId: z.uuid(),
  feedPosition: z.string().regex(/^\d+$/),
  skill: SkillReferenceSchema.optional(),
  binding: SkillBindingSchema.optional(),
  task: TaskSchema.optional(),
  attempt: AgentAttemptSchema.optional(),
  result: AgentResultSchema.nullable().optional(),
});
export type SkillReference = z.infer<typeof SkillReferenceSchema>;
export type SkillBinding = z.infer<typeof SkillBindingSchema>;
export type AgentAttempt = z.infer<typeof AgentAttemptSchema>;
export type AgentResult = z.infer<typeof AgentResultSchema>;
export type AgentWorkflowResponse = z.infer<typeof AgentWorkflowResponseSchema>;
