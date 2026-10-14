/** Format an already owner-zone-resolved ISO diary day without applying another zone shift.
 * Native Intl accepts Date values on Hermes; Temporal.toLocaleString does not on some iOS builds.
 */
export function formatFoodDay(day: string, locales?: Intl.LocalesArgument): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('Choose a valid diary day.');
  const date = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day)
    throw new RangeError('Choose a valid diary day.');
  return new Intl.DateTimeFormat(locales, {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
