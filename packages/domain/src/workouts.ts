import { z } from 'zod';

const uuid = z.uuid();
const instant = z.iso.datetime();
const notes = z.string().max(20_000);
const name = z.string().trim().min(1).max(500);
const quantity = z.number().finite().nonnegative().nullable();
const repetitions = z.number().int().nonnegative().nullable();
export const ExerciseModeSchema = z.enum(['weighted', 'bodyweight', 'timed', 'distance']);
export const MeasurementsSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('weighted'), reps: repetitions, loadKg: quantity }),
  z.strictObject({ mode: z.literal('bodyweight'), reps: repetitions, addedLoadKg: quantity }),
  z.strictObject({ mode: z.literal('timed'), durationSeconds: quantity, loadKg: quantity }),
  z.strictObject({
    mode: z.literal('distance'),
    distanceMeters: quantity,
    durationSeconds: quantity,
    loadKg: quantity,
  }),
]);
export const ExerciseContentSchema = z.strictObject({
  name,
  mode: ExerciseModeSchema,
  supportsLoad: z.boolean(),
  notes,
});
export const ExerciseSchema = z.strictObject({
  ...ExerciseContentSchema.shape,
  id: uuid,
  revision: z.number().int().positive(),
  origin: z.enum(['builtin', 'custom']),
  archivedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
});
export const ExerciseSnapshotSchema = z.strictObject({
  name,
  mode: ExerciseModeSchema,
  supportsLoad: z.boolean(),
});
export const RoutineTargetSchema = z.strictObject({
  id: uuid,
  kind: z.enum(['warmup', 'working']),
  measurements: MeasurementsSchema,
  notes,
});
export const RoutineItemSchema = z
  .strictObject({
    id: uuid,
    exerciseId: uuid,
    snapshot: ExerciseSnapshotSchema,
    targets: z.array(RoutineTargetSchema).max(100),
    notes,
  })
  .superRefine((item, context) => {
    item.targets.forEach((target, index) => {
      if (target.measurements.mode !== item.snapshot.mode)
        context.addIssue({
          code: 'custom',
          path: ['targets', index, 'measurements', 'mode'],
          message: 'Targets must use the exercise measurement mode.',
        });
      const load =
        target.measurements.mode === 'bodyweight'
          ? target.measurements.addedLoadKg
          : target.measurements.loadKg;
      if (!item.snapshot.supportsLoad && load !== null)
        context.addIssue({
          code: 'custom',
          path: ['targets', index, 'measurements'],
          message: 'This exercise does not support external load.',
        });
    });
  });
export const RoutineContentSchema = z
  .strictObject({ name, notes, items: z.array(RoutineItemSchema).max(100) })
  .superRefine((routine, context) => {
    const ids = new Set<string>();
    routine.items.forEach((item, itemIndex) => {
      if (ids.has(item.id))
        context.addIssue({
          code: 'custom',
          path: ['items', itemIndex, 'id'],
          message: 'Routine item and target IDs must be unique.',
        });
      ids.add(item.id);
      item.targets.forEach((target, targetIndex) => {
        if (ids.has(target.id))
          context.addIssue({
            code: 'custom',
            path: ['items', itemIndex, 'targets', targetIndex, 'id'],
            message: 'Routine item and target IDs must be unique.',
          });
        ids.add(target.id);
      });
    });
  });
export const RoutineSchema = RoutineContentSchema.safeExtend({
  id: uuid,
  revision: z.number().int().positive(),
  archivedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
});
const exerciseCommandBase = {
  operationId: uuid,
  exerciseId: uuid,
  expectedRevision: z.number().int().nonnegative(),
};
export const ExerciseCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...exerciseCommandBase,
    type: z.literal('exercise.create'),
    expectedRevision: z.literal(0),
    content: ExerciseContentSchema,
  }),
  z.strictObject({
    ...exerciseCommandBase,
    type: z.literal('exercise.edit'),
    content: ExerciseContentSchema,
  }),
  z.strictObject({ ...exerciseCommandBase, type: z.literal('exercise.archive') }),
  z.strictObject({ ...exerciseCommandBase, type: z.literal('exercise.unarchive') }),
]);
const routineCommandBase = {
  operationId: uuid,
  routineId: uuid,
  expectedRevision: z.number().int().nonnegative(),
};
export const RoutineCommandSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      ...routineCommandBase,
      type: z.literal('routine.create'),
      expectedRevision: z.literal(0),
      content: RoutineContentSchema,
    }),
    z.strictObject({
      ...routineCommandBase,
      type: z.literal('routine.edit'),
      content: RoutineContentSchema,
    }),
    z.strictObject({ ...routineCommandBase, type: z.literal('routine.duplicate'), newId: uuid }),
    z.strictObject({ ...routineCommandBase, type: z.literal('routine.archive') }),
    z.strictObject({ ...routineCommandBase, type: z.literal('routine.unarchive') }),
  ])
  .superRefine((command, context) => {
    if (command.type === 'routine.duplicate' && command.newId === command.routineId)
      context.addIssue({
        code: 'custom',
        path: ['newId'],
        message: 'A duplicate needs a new routine identity.',
      });
  });
export const ExerciseListSchema = z.strictObject({ exercises: z.array(ExerciseSchema) });
export const ExerciseResponseSchema = z.strictObject({ exercise: ExerciseSchema });
export const ExerciseCommandResponseSchema = z.strictObject({
  operationId: uuid,
  exercise: ExerciseSchema,
  feedPosition: z.string().regex(/^\d+$/),
});
export const RoutineListSchema = z.strictObject({ routines: z.array(RoutineSchema) });
export const RoutineResponseSchema = z.strictObject({ routine: RoutineSchema });
export const RoutineCommandResponseSchema = z.strictObject({
  operationId: uuid,
  routine: RoutineSchema,
  feedPosition: z.string().regex(/^\d+$/),
});
export type ExerciseMode = z.infer<typeof ExerciseModeSchema>;
export type Measurements = z.infer<typeof MeasurementsSchema>;
export type ExerciseContent = z.infer<typeof ExerciseContentSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type ExerciseSnapshot = z.infer<typeof ExerciseSnapshotSchema>;
export type ExerciseCommand = z.infer<typeof ExerciseCommandSchema>;
export type ExerciseCommandResponse = z.infer<typeof ExerciseCommandResponseSchema>;
export type ExerciseList = z.infer<typeof ExerciseListSchema>;
export type ExerciseResponse = z.infer<typeof ExerciseResponseSchema>;
export type RoutineTarget = z.infer<typeof RoutineTargetSchema>;
export type RoutineItem = z.infer<typeof RoutineItemSchema>;
export type RoutineContent = z.infer<typeof RoutineContentSchema>;
export type Routine = z.infer<typeof RoutineSchema>;
export type RoutineCommand = z.infer<typeof RoutineCommandSchema>;
export type RoutineCommandResponse = z.infer<typeof RoutineCommandResponseSchema>;
export type RoutineList = z.infer<typeof RoutineListSchema>;
export type RoutineResponse = z.infer<typeof RoutineResponseSchema>;
export const exerciseSchema = ExerciseSchema;
export const exerciseContentSchema = ExerciseContentSchema;
export const exerciseCommandSchema = ExerciseCommandSchema;
export const routineSchema = RoutineSchema;
export const routineContentSchema = RoutineContentSchema;
export const routineCommandSchema = RoutineCommandSchema;

export const ExerciseListResponseSchema = ExerciseListSchema;
export const RoutineListResponseSchema = RoutineListSchema;
