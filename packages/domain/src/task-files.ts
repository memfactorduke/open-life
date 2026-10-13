import { z } from 'zod';
export const taskFileLimit = 50 * 1024 * 1024;
export const TaskFileContentTypeSchema = z.enum([
  'text/plain',
  'text/markdown',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'video/mp4',
]);
export const TaskFileAllocateSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().min(1),
  fileId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine(
      (value) => !/[\u0000-\u001f\u007f/\\]/.test(value),
      'Use a filename without paths or control characters.',
    ),
  size: z.number().int().min(1).max(taskFileLimit),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: TaskFileContentTypeSchema,
});
export const TaskFileMutationSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().min(1),
});
export const TaskFileSchema = z.strictObject({
  id: z.uuid(),
  taskId: z.uuid(),
  name: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  contentType: TaskFileContentTypeSchema,
  status: z.enum(['pending', 'received', 'finalized']),
  createdAt: z.iso.datetime(),
  detachedAt: z.iso.datetime().nullable(),
});
export type TaskFileAllocate = z.infer<typeof TaskFileAllocateSchema>;
export type TaskFileMutation = z.infer<typeof TaskFileMutationSchema>;
export type TaskFile = z.infer<typeof TaskFileSchema>;
