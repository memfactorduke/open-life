import {
  ExerciseContentSchema,
  MeasurementsSchema,
  RoutineCommandSchema,
  RoutineContentSchema,
  RoutineSchema,
} from '../src';

const routineId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const exerciseId = '33333333-3333-4333-8333-333333333333';
const setId = '44444444-4444-4444-8444-444444444444';
const plan = {
  name: 'Strength day',
  notes: '',
  items: [
    {
      id: itemId,
      exerciseId,
      snapshot: { name: 'Squat', mode: 'weighted' as const, supportsLoad: true },
      notes: '',
      targets: [
        {
          id: setId,
          kind: 'working' as const,
          measurements: { mode: 'weighted' as const, reps: 5, loadKg: 60 },
          notes: '',
        },
      ],
    },
  ],
};

test('keeps an explicit measurement mode and distinguishes missing data from zero', () => {
  expect(MeasurementsSchema.parse({ mode: 'weighted', reps: null, loadKg: 0 })).toEqual({
    mode: 'weighted',
    reps: null,
    loadKg: 0,
  });
  expect(MeasurementsSchema.parse({ mode: 'bodyweight', reps: 12, addedLoadKg: null })).toEqual({
    mode: 'bodyweight',
    reps: 12,
    addedLoadKg: null,
  });
  expect(MeasurementsSchema.parse({ mode: 'timed', durationSeconds: 30, loadKg: null })).toEqual({
    mode: 'timed',
    durationSeconds: 30,
    loadKg: null,
  });
  expect(
    MeasurementsSchema.parse({
      mode: 'distance',
      distanceMeters: 1609.344,
      durationSeconds: 480,
      loadKg: null,
    }),
  ).toEqual({ mode: 'distance', distanceMeters: 1609.344, durationSeconds: 480, loadKg: null });
});

test('rejects irrelevant fields, noncanonical units, invalid modes and invalid physical quantities', () => {
  for (const invalid of [
    { mode: 'timed', durationSeconds: 30, loadKg: null, reps: 1 },
    { mode: 'weighted', reps: 5, loadKg: 60, unit: 'lb' },
    { mode: 'distance', distanceKm: 2, durationSeconds: null, loadKg: null },
    { mode: 'running', distanceMeters: 100, durationSeconds: 30, loadKg: null },
    { mode: 'weighted', reps: 2.5, loadKg: 30 },
    ...[-1, NaN, Infinity].map((loadKg) => ({ mode: 'weighted', reps: 5, loadKg })),
  ])
    expect(MeasurementsSchema.safeParse(invalid).success).toBe(false);
});

test('parses exercise content and ordered routine targets without dropping notes', () => {
  expect(
    ExerciseContentSchema.parse({
      name: '  Squat  ',
      mode: 'weighted',
      supportsLoad: true,
      notes: 'Use rack',
    }),
  ).toEqual({ name: 'Squat', mode: 'weighted', supportsLoad: true, notes: 'Use rack' });
  expect(RoutineContentSchema.parse(plan)).toEqual(plan);
  expect(
    RoutineContentSchema.parse({ name: 'Empty session preparation', notes: '', items: [] }),
  ).toEqual({ name: 'Empty session preparation', notes: '', items: [] });
});

test('requires snapshot mode agreement and rejects even zero external load when unsupported', () => {
  const target = plan.items[0]!.targets[0]!;
  expect(
    RoutineContentSchema.safeParse({
      ...plan,
      items: [
        {
          ...plan.items[0],
          targets: [
            { ...target, measurements: { mode: 'timed', durationSeconds: 30, loadKg: null } },
          ],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    RoutineContentSchema.safeParse({
      ...plan,
      items: [
        {
          ...plan.items[0],
          snapshot: { name: 'Squat', mode: 'weighted', supportsLoad: false },
          targets: [{ ...target, measurements: { mode: 'weighted', reps: 5, loadKg: 0 } }],
        },
      ],
    }).success,
  ).toBe(false);
});

test('requires unique item and target identities across the whole routine', () => {
  const item = plan.items[0]!;
  expect(RoutineContentSchema.safeParse({ ...plan, items: [item, item] }).success).toBe(false);
  expect(
    RoutineContentSchema.safeParse({ ...plan, items: [item, { ...item, id: exerciseId }] }).success,
  ).toBe(false);
  expect(
    RoutineContentSchema.safeParse({
      ...plan,
      items: [{ ...item, targets: [{ ...item.targets[0], id: itemId }] }],
    }).success,
  ).toBe(false);
  expect(
    RoutineSchema.safeParse({
      ...plan,
      items: [item, item],
      id: routineId,
      revision: 1,
      archivedAt: null,
      createdAt: '2026-10-12T12:00:00Z',
      updatedAt: '2026-10-12T12:00:00Z',
    }).success,
  ).toBe(false);
});

test('bounds collections and requires fresh identity for routine duplication', () => {
  expect(
    RoutineContentSchema.safeParse({ ...plan, items: Array(101).fill(plan.items[0]) }).success,
  ).toBe(false);
  const duplicate = {
    type: 'routine.duplicate',
    operationId: setId,
    routineId,
    expectedRevision: 1,
    newId: exerciseId,
  };
  expect(RoutineCommandSchema.parse(duplicate)).toEqual(duplicate);
  expect(RoutineCommandSchema.safeParse({ ...duplicate, newId: routineId }).success).toBe(false);
  expect(
    RoutineCommandSchema.safeParse({
      type: 'routine.create',
      operationId: setId,
      routineId,
      expectedRevision: 1,
      content: plan,
    }).success,
  ).toBe(false);
});
