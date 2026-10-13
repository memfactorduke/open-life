import { PortableExportSchema } from '../src';
test('portable document has explicit version and typed checksum manifest', () => {
  const document = {
    format: 'mems-life-owner-export',
    version: 1,
    exportedAt: '2026-10-12T12:00:00.000Z',
    installationId: '00000000-0000-4000-8000-000000000001',
    epoch: '00000000-0000-4000-8000-000000000002',
    records: { tasks: [{ id: 'fictional', revision: 2, deleted_at: '2026-10-12T12:00:00.000Z' }] },
    attachments: [
      {
        id: '00000000-0000-4000-8000-000000000003',
        kind: 'task',
        path: 'attachments/task-files/files/00000000-0000-4000-8000-000000000003',
        size: 7,
        sha256: 'a'.repeat(64),
        contentType: 'text/plain',
        name: 'fixture.txt',
      },
    ],
  };
  expect(PortableExportSchema.parse(document).records.tasks[0]?.revision).toBe(2);
  expect(PortableExportSchema.safeParse({ ...document, version: 2 }).success).toBe(false);
  expect(
    PortableExportSchema.safeParse({
      ...document,
      attachments: [{ ...document.attachments[0], sha256: 'invalid' }],
    }).success,
  ).toBe(false);
});
