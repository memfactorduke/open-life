import { Temporal } from '@js-temporal/polyfill';
import { formatFoodDay } from '../src/food-time';

test.each([
  ['Pacific/Kiritimati', '2026-10-13T10:30:00Z', '2026-10-14', 'Wednesday, October 14'],
  ['Etc/GMT+12', '2026-10-14T10:30:00Z', '2026-10-13', 'Tuesday, October 13'],
  ['America/New_York', '2026-03-08T07:30:00Z', '2026-03-08', 'Sunday, March 8'],
  ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-01', 'Sunday, November 1'],
  ['America/New_York', '2026-11-01T06:30:00Z', '2026-11-01', 'Sunday, November 1'],
])('retains the resolved day in %s across boundaries and DST', (zone, at, day, expected) => {
  const ownerDay = Temporal.Instant.from(at).toZonedDateTimeISO(zone).toPlainDate().toString();
  expect(ownerDay).toBe(day);
  expect(formatFoodDay(ownerDay, 'en-US')).toBe(expected);
});

test('uses native Intl instead of the incompatible Temporal formatter', () => {
  const formatter = jest
    .spyOn(Temporal.PlainDate.prototype, 'toLocaleString')
    .mockImplementation(() => {
      throw new Error('Missing internal slot calendar-id');
    });
  try {
    expect(formatFoodDay('2026-10-14', 'en-US')).toBe('Wednesday, October 14');
    expect(formatter).not.toHaveBeenCalled();
  } finally {
    formatter.mockRestore();
  }
});

test('respects the chosen locale', () => {
  expect(formatFoodDay('2026-10-14', 'fr-FR')).toBe('mercredi 14 octobre');
});

test.each([
  '',
  '2026-02-30',
  '2026-13-01',
  '2026-00-01',
  '2026-01-00',
  '2026-1-02',
  '2026-10-14T00:00:00Z',
  'nonsense',
])('rejects invalid ISO days instead of formatting Invalid Date: %s', (day) => {
  expect(() => formatFoodDay(day)).toThrow('Choose a valid diary day.');
});

test('accepts a leap day without Date constructor year coercion', () => {
  expect(formatFoodDay('2028-02-29', 'en-US')).toBe('Tuesday, February 29');
  expect(formatFoodDay('0099-01-01', 'en-US')).toContain('January 1');
});
