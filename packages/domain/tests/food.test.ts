import { FoodCommandSchema, FoodUploadSchema } from '../src/food';
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
