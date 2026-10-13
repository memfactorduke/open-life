import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { TaskContentSchema } from './tasks.js';
export const RecurrenceRuleSchema = z
  .strictObject({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          if (/^[+-]/.test(value)) return false;
          Temporal.Now.zonedDateTimeISO(value);
          return true;
        } catch {
          return false;
        }
      }, 'Use an IANA time zone.'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    startDate: z.iso.date(),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    monthDay: z.number().int().min(1).max(31).default(1),
  })
  .superRefine((rule, ctx) => {
    if (rule.frequency === 'weekly' && rule.weekdays.length === 0)
      ctx.addIssue({ code: 'custom', message: 'Select at least one weekday.' });
  });
export const RecurrenceSeriesSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  content: TaskContentSchema,
  rule: RecurrenceRuleSchema,
  cancelledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const base = {
  operationId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
export const RecurrenceCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('series.create'),
    expectedRevision: z.literal(0),
    content: TaskContentSchema,
    rule: RecurrenceRuleSchema,
  }),
  z.strictObject({
    ...base,
    type: z.literal('series.edit'),
    content: TaskContentSchema,
    rule: RecurrenceRuleSchema,
  }),
  z.strictObject({ ...base, type: z.literal('series.cancel') }),
  z.strictObject({ ...base, type: z.literal('series.generate') }),
  z.strictObject({
    ...base,
    type: z.literal('series.skip'),
    taskId: z.uuid(),
    expectedTaskRevision: z.number().int().positive(),
  }),
]);
export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;
export type RecurrenceSeries = z.infer<typeof RecurrenceSeriesSchema>;
export type RecurrenceCommand = z.infer<typeof RecurrenceCommandSchema>;
// Temporal compatible disambiguation: gaps move forward by the gap; repeated times use the earlier offset.
// Completion generates the first strictly future wall-clock occurrence, never fabricated missed history.
export function nextOccurrence(rule: RecurrenceRule, after: string): { at: string; key: string } {
  const instant = Temporal.Instant.from(after);
  const local = instant.toZonedDateTimeISO(rule.timeZone);
  let date = local.toPlainDate();
  const start = Temporal.PlainDate.from(rule.startDate);
  if (Temporal.PlainDate.compare(date, start) < 0) date = start;
  for (let count = 0; count < 3700; count++, date = date.add({ days: 1 })) {
    if (rule.frequency === 'weekly' && !rule.weekdays.includes(date.dayOfWeek)) continue;
    if (rule.frequency === 'monthly' && date.day !== Math.min(rule.monthDay, date.daysInMonth))
      continue;
    const [hour, minute] = rule.time.split(':').map(Number);
    const candidate = date
      .toPlainDateTime({ hour, minute })
      .toZonedDateTime(rule.timeZone, { disambiguation: 'compatible' });
    if (Temporal.Instant.compare(candidate.toInstant(), instant) > 0)
      return {
        at: candidate.toInstant().toString(),
        key: `${date.toString()}T${rule.time}[${rule.timeZone}]`,
      };
  }
  throw new Error('No recurrence date within ten years.');
}
