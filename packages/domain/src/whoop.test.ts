import assert from 'node:assert/strict';
import { test } from 'node:test';
import { whoopWindow, WhoopObservationSchema } from './whoop.js';
test('WHOOP initial and rolling bounds remain fixed; missing scores never become zero', () => {
  const connected = new Date('2026-10-10T00:00:00Z');
  assert.equal(
    whoopWindow(connected, new Date('2026-10-11')).toISOString(),
    '2026-10-09T00:00:00.000Z',
  );
  assert.equal(
    whoopWindow(connected, new Date('2026-10-20')).toISOString(),
    '2026-10-13T00:00:00.000Z',
  );
  assert.equal(
    WhoopObservationSchema.parse({
      accountId: 'b85e6fb7-d3b8-4e7e-8bfb-357613b0be21',
      providerAccountId: '123',
      resource: 'sleep',
      providerId: 'sleep-fixture',
      revision: 1,
      providerUpdatedAt: '2026-10-10',
      start: null,
      end: null,
      timezoneOffset: null,
      retrievedAt: '2026-10-10',
      scoreState: 'PENDING_SCORE',
      score: null,
      available: true,
      currentAccount: true,
      linkedSessionId: null,
    }).score,
    null,
  );
});
