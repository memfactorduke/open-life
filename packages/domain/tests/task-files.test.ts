import { TaskFileAllocateSchema, taskFileLimit } from '../src/task-files';
const input = {
  operationId: '11111111-1111-4111-8111-111111111111',
  fileId: '22222222-2222-4222-8222-222222222222',
  expectedRevision: 1,
  name: 'fictional.md',
  size: 32,
  sha256: 'a'.repeat(64),
  contentType: 'text/markdown',
};
test('private file allocation rejects paths, unsafe types and unbounded transfer declarations', () => {
  expect(TaskFileAllocateSchema.parse(input)).toEqual(input);
  for (const change of [
    { name: '../result.md' },
    { name: 'x\r\nX-Test: value' },
    { size: taskFileLimit + 1 },
    { size: 0 },
    { sha256: 'bad' },
    { contentType: 'text/html' },
    { expectedRevision: 0 },
  ])
    expect(() => TaskFileAllocateSchema.parse({ ...input, ...change })).toThrow();
});
