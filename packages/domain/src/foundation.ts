import { z } from 'zod';

const nonemptyTextSchema = z.string().trim().min(1);

export const timeZoneSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      if (!/^[A-Za-z][A-Za-z0-9_+\/-]*$/.test(value)) return false;
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Use a valid IANA time zone.' },
  );

export const weightUnitSchema = z.enum(['kg', 'lb']);
export const distanceUnitSchema = z.enum(['km', 'mi']);
export const themeSchema = z.enum(['system', 'light', 'dark']);

export const principalSchema = z.strictObject({
  user: z.strictObject({
    id: nonemptyTextSchema,
    name: nonemptyTextSchema,
    email: z.email(),
  }),
  installationId: nonemptyTextSchema,
});

export const meResponseSchema = principalSchema;

export const preferencesSchema = z.strictObject({
  displayName: nonemptyTextSchema,
  timeZone: timeZoneSchema,
  weightUnit: weightUnitSchema,
  distanceUnit: distanceUnitSchema,
  theme: themeSchema,
});

export const preferencesRecordSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  value: preferencesSchema,
});

export const preferencesCommandSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  value: preferencesSchema,
});

export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: nonemptyTextSchema,
    message: nonemptyTextSchema,
    details: z.unknown().optional(),
  }),
});

export const MeSchema = meResponseSchema;
export const PreferencesSchema = preferencesSchema;
export const PreferencesRecordSchema = preferencesRecordSchema;
export const PreferencesCommandSchema = preferencesCommandSchema;
export const ApiErrorSchema = apiErrorSchema;

export type Principal = z.infer<typeof principalSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesRecord = z.infer<typeof preferencesRecordSchema>;
export type PreferencesCommand = z.infer<typeof preferencesCommandSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type WeightUnit = z.infer<typeof weightUnitSchema>;
export type DistanceUnit = z.infer<typeof distanceUnitSchema>;
export type Theme = z.infer<typeof themeSchema>;

export function defaultPreferences(
  options: { name?: string; timeZone?: string } = {},
): Preferences {
  return preferencesSchema.parse({
    displayName: options.name ?? 'Owner',
    timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    weightUnit: 'kg',
    distanceUnit: 'km',
    theme: 'system',
  });
}

export const foundationApi = {
  me: { method: 'GET', path: '/api/me', response: meResponseSchema },
  preferences: { method: 'GET', path: '/api/preferences', response: preferencesRecordSchema },
  updatePreferences: {
    method: 'PUT',
    path: '/api/preferences',
    request: preferencesCommandSchema,
    response: preferencesRecordSchema,
  },
} as const;
