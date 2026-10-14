import {
  FoodCommandSchema,
  FoodUploadSchema,
  FoodTimezoneSchema,
  FoodEntrySchema,
  latestFoodEntries,
} from '../src/food';
test('food preserves named time zones rather than accepting fixed UTC offsets', () => {
  expect(FoodTimezoneSchema.safeParse('+01:00').success).toBe(false);
  expect(FoodTimezoneSchema.parse('America/New_York')).toBe('America/New_York');
});
test('food rejects invalid timezone and unbounded uploads', () => {
  expect(
    FoodCommandSchema.safeParse({
      type: 'food.create',
      operationId: '11111111-1111-4111-8111-111111111111',
      entryId: '22222222-2222-4222-8222-222222222222',
      expectedRevision: 0,
      content: {
        text: 'Dinner',
        occurredAt: '2026-10-10T01:30:00Z',
        timezone: 'Imaginary/Nowhere',
      },
    }).success,
  ).toBe(false);
  expect(
    FoodUploadSchema.safeParse({
      operationId: '11111111-1111-4111-8111-111111111111',
      expectedRevision: 1,
      size: 8388609,
      sha256: 'a'.repeat(64),
      contentType: 'image/jpeg',
    }).success,
  ).toBe(false);
});

test('latest diary preview orders by the actual meal time, breaks ties by ID, excludes deleted entries and preserves input', () => {
  const make = (id: number, occurredAt: string, deletedAt: string | null = null) =>
    FoodEntrySchema.parse({
      id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      revision: 1,
      content: { text: `Fictional meal ${id}`, occurredAt, timezone: 'UTC' },
      photoIds: [],
      createdAt: '2026-10-12T20:00:00Z',
      updatedAt: '2026-10-12T20:00:00Z',
      deletedAt,
    });
  const entries = Object.freeze([
    make(4, '2026-10-12T07:00:00Z'),
    make(8, '2026-10-12T19:00:00Z'),
    make(6, '2026-10-12T15:00:00Z'),
    make(5, '2026-10-12T15:00:00Z'),
    make(9, '2026-10-12T20:00:00Z', '2026-10-12T21:00:00Z'),
  ]);
  const original = entries.map((entry) => entry.id);
  const result = latestFoodEntries(entries);
  expect(result.map((entry) => entry.content.text)).toEqual([
    'Fictional meal 8',
    'Fictional meal 5',
    'Fictional meal 6',
  ]);
  expect(latestFoodEntries([...entries].reverse())).toEqual(result);
  expect(entries.map((entry) => entry.id)).toEqual(original);
});
