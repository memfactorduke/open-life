import { AgentGrantCreateSchema, ReportedSourceSchema } from '../src/agent-grants.js';
test('bounded grants accept distinct domain scopes and reject unknown or duplicated privileges', () => {
  const grant = {
    operationId: '00000000-0000-4000-8000-000000000001',
    label: 'Fixture watcher',
    scopes: ['tasks:read'],
    expiresAt: '2027-01-01T00:00:00.000Z',
  };
  expect(AgentGrantCreateSchema.parse(grant).scopes).toEqual(['tasks:read']);
  expect(AgentGrantCreateSchema.safeParse({ ...grant, scopes: ['grants:issue'] }).success).toBe(
    false,
  );
  expect(
    AgentGrantCreateSchema.safeParse({ ...grant, scopes: ['tasks:read', 'tasks:read'] }).success,
  ).toBe(false);
  expect(AgentGrantCreateSchema.safeParse({ ...grant, ownerId: 'another-owner' }).success).toBe(
    false,
  );
});
test('actual-record attribution requires an explicit reported or imported source', () => {
  expect(
    ReportedSourceSchema.safeParse({
      kind: 'planned',
      reference: 'Routine',
      reportedAt: '2026-10-12T00:00:00.000Z',
    }).success,
  ).toBe(false);
  expect(
    ReportedSourceSchema.safeParse({
      kind: 'reported',
      reference: '',
      reportedAt: '2026-10-12T00:00:00.000Z',
    }).success,
  ).toBe(false);
  expect(
    ReportedSourceSchema.parse({
      kind: 'reported',
      reference: 'Fictional person report',
      reportedAt: '2026-10-12T00:00:00.000Z',
    }).kind,
  ).toBe('reported');
});
