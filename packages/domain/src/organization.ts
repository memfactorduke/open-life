import { z } from 'zod';
import { TaskOpenPhaseSchema } from './tasks.js';
const base = {
  id: z.uuid(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};
export const BoardColumnSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  phase: TaskOpenPhaseSchema,
});
export const BoardContentSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    columns: z.array(BoardColumnSchema).min(3).max(30),
  })
  .superRefine((board, ctx) => {
    if (new Set(board.columns.map((c) => c.id)).size !== board.columns.length)
      ctx.addIssue({ code: 'custom', message: 'Column IDs must be unique.' });
    for (const phase of ['planned', 'next', 'active'])
      if (!board.columns.some((c) => c.phase === phase))
        ctx.addIssue({ code: 'custom', message: `Provide a ${phase} column.` });
  });
export const BoardSchema = z.strictObject({ ...base, content: BoardContentSchema });
export const ProjectContentSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(20000),
});
export const ProjectSchema = z.strictObject({ ...base, content: ProjectContentSchema });
const command = {
  operationId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
export const BoardCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...command,
    type: z.literal('board.create'),
    expectedRevision: z.literal(0),
    content: BoardContentSchema,
  }),
  z.strictObject({ ...command, type: z.literal('board.edit'), content: BoardContentSchema }),
]);
export const ProjectCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...command,
    type: z.literal('project.create'),
    expectedRevision: z.literal(0),
    content: ProjectContentSchema,
  }),
  z.strictObject({ ...command, type: z.literal('project.edit'), content: ProjectContentSchema }),
]);
export type Board = z.infer<typeof BoardSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type BoardCommand = z.infer<typeof BoardCommandSchema>;
export type ProjectCommand = z.infer<typeof ProjectCommandSchema>;
