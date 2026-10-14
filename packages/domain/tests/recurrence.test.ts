import { RecurrenceRuleSchema, nextOccurrence } from '../src';
const rule = RecurrenceRuleSchema.parse({
  frequency: 'daily',
  timeZone: 'America/New_York',
  time: '02:30',
  startDate: '2026-01-01',
});
test('DST gaps shift forward and repeated local times use the earlier offset', () => {
  expect(nextOccurrence(rule, '2026-03-08T06:00:00Z')).toEqual({
    at: '2026-03-08T07:30:00Z',
    key: '2026-03-08T02:30[America/New_York]',
  });
  const repeat = { ...rule, time: '01:30' };
  expect(nextOccurrence(repeat, '2026-11-01T04:00:00Z').at).toBe('2026-11-01T05:30:00Z');
  // The second 01:30 is the same occurrence, so completing the first advances to tomorrow.
  expect(nextOccurrence(repeat, '2026-11-01T05:30:00Z').at).toBe('2026-11-02T06:30:00Z');
});
test('monthly clamping respects leap years, future starts and local weekly dates', () => {
  const monthly = { ...rule, frequency: 'monthly' as const, monthDay: 31 };
  expect(nextOccurrence(monthly, '2028-02-01T00:00:00Z').key).toBe(
    '2028-02-29T02:30[America/New_York]',
  );
  expect(nextOccurrence(monthly, '2027-02-01T00:00:00Z').key).toBe(
    '2027-02-28T02:30[America/New_York]',
  );
  expect(nextOccurrence({ ...rule, startDate: '2030-01-01' }, '2026-01-01T00:00:00Z').key).toBe(
    '2030-01-01T02:30[America/New_York]',
  );
  expect(
    nextOccurrence(
      { ...rule, frequency: 'weekly', weekdays: [1], timeZone: 'Pacific/Auckland', time: '00:30' },
      '2026-10-11T12:00:00Z',
    ).at,
  ).toBe('2026-10-18T11:30:00Z');
});
