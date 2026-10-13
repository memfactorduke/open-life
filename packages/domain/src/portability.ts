import { z } from 'zod';
export const PortableAttachmentSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['food', 'task']),
  path: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string(),
  name: z.string().optional(),
});
export const PortableExportSchema = z.strictObject({
  format: z.literal('mems-life-owner-export'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  installationId: z.uuid(),
  epoch: z.uuid(),
  records: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  attachments: z.array(PortableAttachmentSchema),
});
export type PortableExport = z.infer<typeof PortableExportSchema>;
