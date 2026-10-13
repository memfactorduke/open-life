import {
  apiErrorSchema,
  defaultPreferences,
  distanceFromMeters,
  distanceToMeters,
  meResponseSchema,
  preferencesCommandSchema,
  preferencesRecordSchema,
  preferencesSchema,
  timeZoneSchema,
  weightFromKg,
  weightToKg,
} from '../src';

const preferences = defaultPreferences({ name: 'Jamie', timeZone: 'America/New_York' });

describe('foundation contracts', () => {
  test('validates an owner response and preferences revision', () => {
    expect(
      meResponseSchema.parse({
        user: { id: 'fictional-owner', name: 'Jamie', email: 'jamie@example.com' },
        installationId: 'fictional-installation',
      }).user.name,
    ).toBe('Jamie');
    expect(preferencesRecordSchema.parse({ revision: 0, value: preferences })).toEqual({
      revision: 0,
      value: preferences,
    });
  });

  test('defaults keep measurement units explicit', () => {
    expect(preferences).toEqual({
      displayName: 'Jamie',
      timeZone: 'America/New_York',
      weightUnit: 'kg',
      distanceUnit: 'km',
      theme: 'system',
    });
    expect(timeZoneSchema.safeParse(defaultPreferences().timeZone).success).toBe(true);
  });

  test.each(['', 'Mars/Olympus', '+01:00', ' America/New_York '])(
    'rejects invalid zone %s',
    (timeZone) => {
      expect(preferencesSchema.safeParse({ ...preferences, timeZone }).success).toBe(false);
    },
  );

  test.each(['UTC', 'America/New_York', 'Asia/Kolkata', 'Etc/GMT+1'])(
    'accepts IANA zone %s',
    (timeZone) => {
      expect(timeZoneSchema.parse(timeZone)).toBe(timeZone);
    },
  );

  test('rejects unknown units, blank names, and unrecognized fields', () => {
    expect(preferencesSchema.safeParse({ ...preferences, weightUnit: 'stone' }).success).toBe(
      false,
    );
    expect(preferencesSchema.safeParse({ ...preferences, distanceUnit: 'm' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...preferences, displayName: '  ' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...preferences, unexpected: true }).success).toBe(false);
    expect(() => defaultPreferences({ name: '' })).toThrow();
    expect(
      meResponseSchema.safeParse({
        user: { id: 'fictional-owner', name: ' ', email: 'jamie@example.com' },
        installationId: 'fictional-installation',
      }).success,
    ).toBe(false);
  });

  test('requires an operation UUID and a nonnegative integer revision', () => {
    const command = {
      operationId: '57e286a2-7762-4fba-88c7-2d19b2c673d6',
      expectedRevision: 0,
      value: preferences,
    };
    expect(preferencesCommandSchema.parse(command)).toEqual(command);
    expect(preferencesCommandSchema.safeParse({ ...command, operationId: 'retry' }).success).toBe(
      false,
    );
    for (const expectedRevision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(preferencesCommandSchema.safeParse({ ...command, expectedRevision }).success).toBe(
        false,
      );
    }
  });

  test('preserves structured error details', () => {
    const error = {
      error: {
        code: 'revision_conflict',
        message: 'Reload preferences.',
        details: { revision: 2 },
      },
    };
    expect(apiErrorSchema.parse(error)).toEqual(error);
    expect(apiErrorSchema.parse({ error: { code: 'unauthorized', message: 'Sign in.' } })).toEqual({
      error: { code: 'unauthorized', message: 'Sign in.' },
    });
  });
});

describe('stored measurement conversions', () => {
  test('converts pounds using the exact international pound', () => {
    expect(weightToKg(100, 'lb')).toBeCloseTo(45.359237, 8);
    expect(weightFromKg(45.359237, 'lb')).toBeCloseTo(100, 8);
    expect(weightToKg(80, 'kg')).toBe(80);
    expect(weightFromKg(80, 'kg')).toBe(80);
  });

  test('converts distances without reinterpreting stored meters', () => {
    expect(distanceToMeters(1, 'mi')).toBe(1609.344);
    expect(distanceFromMeters(1609.344, 'mi')).toBe(1);
    expect(distanceToMeters(5, 'km')).toBe(5000);
    expect(distanceFromMeters(5000, 'km')).toBe(5);
    expect(distanceToMeters(0, 'mi')).toBe(0);
  });
});
