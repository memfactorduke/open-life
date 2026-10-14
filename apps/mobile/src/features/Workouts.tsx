import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ExerciseCommandSchema,
  RoutineCommandSchema,
  ExerciseListResponseSchema,
  ExerciseCommandResponseSchema,
  RoutineListResponseSchema,
  RoutineCommandResponseSchema,
  RoutineContentSchema,
  weightFromKg,
  weightToKg,
  distanceFromMeters,
  distanceToMeters,
  type Exercise,
  type Routine,
  type RoutineContent,
  type Preferences,
} from '@mems-life/domain';
import type { InstallationClient } from '../client';
import { Action, Body, Card, Choice, Disclosure, Field, Heading, ListRow, usePalette } from '../ui';
import { messageOf, numericInput, useCommand } from './helpers';

type Item = RoutineContent['items'][number];
type Target = Item['targets'][number];
const modes = [
  { value: 'weighted', label: 'Weighted reps' },
  { value: 'bodyweight', label: 'Bodyweight reps' },
  { value: 'timed', label: 'Time' },
  { value: 'distance', label: 'Distance' },
] as const;

function targetSummary(item: RoutineContent['items'][number], preferences: Preferences) {
  if (!item.targets.length) return 'No targets';
  const labels = item.targets.map(({ measurements: m, kind }) => {
    const parts: string[] = [];
    if ('reps' in m && m.reps !== null) parts.push(`${m.reps} reps`);
    const load = 'addedLoadKg' in m ? m.addedLoadKg : 'loadKg' in m ? m.loadKg : null;
    if (load !== null)
      parts.push(
        `${Number(weightFromKg(load, preferences.weightUnit).toFixed(2))} ${preferences.weightUnit}`,
      );
    if ('durationSeconds' in m && m.durationSeconds !== null) parts.push(`${m.durationSeconds}s`);
    if ('distanceMeters' in m && m.distanceMeters !== null)
      parts.push(
        `${Number(distanceFromMeters(m.distanceMeters, preferences.distanceUnit).toFixed(2))} ${preferences.distanceUnit}`,
      );
    return `${kind === 'warmup' ? 'Warm-up · ' : ''}${parts.join(' · ') || 'Blank target'}`;
  });
  return labels.every((label) => label === labels[0])
    ? `${labels.length} × ${labels[0]}`
    : labels.join(' / ');
}

export function Workouts({
  client,
  preferences,
  onStartRoutine,
}: {
  client: InstallationClient;
  preferences: Preferences;
  onStartRoutine?: (routineId: string) => void;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [area, setArea] = useState<'routines' | 'exercises'>('routines');
  const [librarySearch, setLibrarySearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [routine, setRoutine] = useState<Routine | null | undefined>(undefined);
  const [exercise, setExercise] = useState<Exercise | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const loadSequence = useRef(0);
  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const [e, archivedE, r, archivedR] = await Promise.all([
        client.request('/api/exercises'),
        client.request('/api/exercises?view=archived'),
        client.request('/api/routines'),
        client.request('/api/routines?view=archived'),
      ]);
      const nextExercises = [
        ...ExerciseListResponseSchema.parse(e).exercises,
        ...ExerciseListResponseSchema.parse(archivedE).exercises,
      ];
      const nextRoutines = [
        ...RoutineListResponseSchema.parse(r).routines,
        ...RoutineListResponseSchema.parse(archivedR).routines,
      ];
      if (sequence === loadSequence.current) {
        setExercises(nextExercises);
        setRoutines(nextRoutines);
        setError('');
      }
    } catch (failure) {
      if (sequence === loadSequence.current) setError(messageOf(failure));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [client]);
  return (
    <View style={layout.stack}>
      <Choice
        label="Manage workouts"
        value={area}
        onChange={(value) => {
          setArea(value);
          setLibrarySearch('');
        }}
        options={[
          { value: 'routines', label: 'Routines' },
          { value: 'exercises', label: 'Exercises' },
        ]}
      />
      <Choice
        label="Catalog view"
        value={showArchived ? 'archived' : 'current'}
        onChange={(value) => setShowArchived(value === 'archived')}
        options={[
          { value: 'current', label: 'Current' },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      <Action
        title={area === 'routines' ? 'Create routine' : 'Create exercise'}
        onPress={() => (area === 'routines' ? setRoutine(null) : setExercise(null))}
      />
      <Field label={`Search ${area}`} value={librarySearch} onChangeText={setLibrarySearch} />
      {!!error && <Body error>{error}</Body>}
      <Action
        title="Refresh workouts"
        variant="quiet"
        compact
        busy={loading}
        onPress={() => void load()}
      />
      {area === 'routines'
        ? routines
            .filter(
              (r) =>
                Boolean(r.archivedAt) === showArchived &&
                r.name.toLowerCase().includes(librarySearch.toLowerCase()),
            )
            .map((r) => (
              <View key={r.id}>
                <ListRow title={r.name} detail={`${r.items.length} exercises`} />
                <View style={layout.rowActions}>
                  {!r.archivedAt && onStartRoutine && (
                    <Action
                      title={`Start ${r.name}`}
                      compact
                      onPress={() => onStartRoutine(r.id)}
                    />
                  )}
                  <Action
                    title={`Edit routine ${r.name}`}
                    variant="quiet"
                    compact
                    onPress={() => setRoutine(r)}
                  />
                </View>
              </View>
            ))
        : exercises
            .filter(
              (e) =>
                Boolean(e.archivedAt) === showArchived &&
                e.name.toLowerCase().includes(librarySearch.toLowerCase()),
            )
            .map((e) => (
              <View key={e.id}>
                <ListRow title={e.name} detail={modes.find((m) => m.value === e.mode)?.label} />
                <Action
                  title={`Open exercise ${e.name}`}
                  variant="quiet"
                  compact
                  onPress={() => setExercise(e)}
                />
              </View>
            ))}
      {!!librarySearch &&
        !(area === 'routines' ? routines : exercises).some(
          (item) =>
            Boolean(item.archivedAt) === showArchived &&
            item.name.toLowerCase().includes(librarySearch.toLowerCase()),
        ) && <Body>No matching {area}.</Body>}
      {area === 'routines' && !routines.some((r) => Boolean(r.archivedAt) === showArchived) && (
        <Body>No routines here yet. Build a plan with exercises, targets and notes.</Body>
      )}
      {routine !== undefined && (
        <RoutineEditor
          routine={routine}
          exercises={exercises}
          client={client}
          preferences={preferences}
          onSaved={() => void load()}
          onClose={() => setRoutine(undefined)}
        />
      )}
      {exercise !== undefined && (
        <ExerciseEditor
          exercise={exercise}
          client={client}
          onSaved={() => void load()}
          onClose={() => setExercise(undefined)}
        />
      )}
    </View>
  );
}

function Sheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  const palette = usePalette();
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      {/* A modal has its own native root; its safe-area view needs a local provider. */}
      <SafeAreaProvider>
        <SafeAreaView style={[layout.modal, { backgroundColor: palette.background }]}>
          <KeyboardAvoidingView
            style={layout.modal}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={layout.sheet}>
              <Heading>{title}</Heading>
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function ExerciseEditor({
  exercise,
  client,
  onSaved,
  onClose,
}: {
  exercise: Exercise | null;
  client: InstallationClient;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(exercise);
  const [reviewing, setReviewing] = useState(false);
  async function reviewLatest() {
    try {
      const saved = ExerciseListResponseSchema.parse(
        await client.request('/api/exercises'),
      ).exercises.find((value) => value.id === current?.id);
      if (!saved) throw new Error('Exercise was not found.');
      setCurrent(saved);
      setReviewing(true);
    } catch (error) {
      command.setError(messageOf(error));
    }
  }
  const [name, setName] = useState(exercise?.name ?? '');
  const [notes, setNotes] = useState(exercise?.notes ?? '');
  const [mode, setMode] = useState<Exercise['mode']>(exercise?.mode ?? 'weighted');
  const [supportsLoad, setSupportsLoad] = useState(exercise?.supportsLoad ?? true);
  const command = useCommand(client);
  const locked = command.busy || command.pending;
  async function save(type: string) {
    const result = await command.send(
      '/api/exercises/commands',
      {
        type,
        exerciseId: current?.id ?? Crypto.randomUUID(),
        expectedRevision: current?.revision ?? 0,
        ...(type === 'exercise.create' || type === 'exercise.edit'
          ? {
              content: {
                name: name.trim(),
                notes,
                mode,
                supportsLoad: mode === 'weighted' ? true : supportsLoad,
              },
            }
          : {}),
      },
      ExerciseCommandResponseSchema.parse,
      ExerciseCommandSchema.parse,
    );
    if (result) {
      setCurrent(result.exercise);
      onSaved();
    }
  }
  return (
    <Sheet
      title={current ? 'Exercise details' : 'New exercise'}
      onClose={() => {
        if (!locked) onClose();
      }}
    >
      <Field label="Exercise name" value={name} onChangeText={setName} editable={!locked} />
      <Choice
        label="Measurement mode"
        value={mode}
        options={modes}
        disabled={locked}
        onChange={(value) => {
          setMode(value);
          setSupportsLoad(value === 'weighted');
        }}
      />
      {mode !== 'weighted' && (
        <Choice
          label="Allow external load"
          value={supportsLoad ? 'yes' : 'no'}
          options={[
            { value: 'no', label: 'No load' },
            { value: 'yes', label: 'Optional load' },
          ]}
          disabled={locked}
          onChange={(v) => setSupportsLoad(v === 'yes')}
        />
      )}
      <Field
        label="Exercise notes"
        multiline
        value={notes}
        onChangeText={setNotes}
        editable={!locked}
      />
      {!!command.error && <Body error>{command.error}</Body>}
      {current && !command.pending && (
        <Action
          title="Review latest saved exercise"
          secondary
          disabled={command.busy}
          onPress={() => void reviewLatest()}
        />
      )}
      {reviewing && (
        <Card>
          <Body>
            Latest saved exercise: {current?.name}, {current?.mode}
          </Body>
          <Body>Latest saved notes: {current?.notes || 'None'}</Body>
          <Body>
            Your edits above are retained. Saving replaces the saved exercise with your edits.
          </Body>
        </Card>
      )}
      <Action
        title={command.pending ? 'Retry unchanged request' : 'Save exercise'}
        busy={command.busy}
        disabled={!name.trim()}
        onPress={() => void save(current ? 'exercise.edit' : 'exercise.create')}
      />
      {current && !command.pending && (
        <Action
          title={current.archivedAt ? 'Unarchive exercise' : 'Archive exercise'}
          secondary
          busy={command.busy}
          onPress={() => void save(current.archivedAt ? 'exercise.unarchive' : 'exercise.archive')}
        />
      )}
      <Action title="Close exercise" secondary disabled={locked} onPress={onClose} />
    </Sheet>
  );
}

function newTarget(item: Item): Target {
  const mode = item.snapshot.mode;
  const measurements =
    mode === 'weighted'
      ? { mode, reps: null, loadKg: null }
      : mode === 'bodyweight'
        ? { mode, reps: null, addedLoadKg: null }
        : mode === 'timed'
          ? { mode, durationSeconds: null, loadKg: null }
          : { mode, distanceMeters: null, durationSeconds: null, loadKg: null };
  return { id: Crypto.randomUUID(), kind: 'working', measurements, notes: '' };
}

function RoutineEditor({
  routine,
  exercises,
  client,
  preferences,
  onSaved,
  onClose,
}: {
  routine: Routine | null;
  exercises: Exercise[];
  client: InstallationClient;
  preferences: Preferences;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(routine);
  const [reviewing, setReviewing] = useState(false);
  async function reviewLatest() {
    try {
      const saved = RoutineListResponseSchema.parse(
        await client.request('/api/routines'),
      ).routines.find((value) => value.id === current?.id);
      if (!saved) throw new Error('Routine was not found.');
      setCurrent(saved);
      setReviewing(true);
    } catch (error) {
      command.setError(messageOf(error));
    }
  }
  const [draft, setDraft] = useState<RoutineContent>(
    routine
      ? { name: routine.name, notes: routine.notes, items: routine.items }
      : { name: '', notes: '', items: [] },
  );
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [more, setMore] = useState(false);
  const [invalidTargets, setInvalidTargets] = useState<Set<string>>(new Set());
  const command = useCommand(client);
  const locked = command.busy || command.pending;
  function updateItem(id: string, update: (item: Item) => Item) {
    setDraft((value) => ({
      ...value,
      items: value.items.map((item) => (item.id === id ? update(item) : item)),
    }));
  }
  async function save(type: string) {
    try {
      const content = RoutineContentSchema.parse({ ...draft, name: draft.name.trim() });
      const result = await command.send(
        '/api/routines/commands',
        {
          type,
          routineId: current?.id ?? Crypto.randomUUID(),
          expectedRevision: current?.revision ?? 0,
          ...(type === 'routine.create' || type === 'routine.edit' ? { content } : {}),
          ...(type === 'routine.duplicate' ? { newId: Crypto.randomUUID() } : {}),
        },
        RoutineCommandResponseSchema.parse,
        RoutineCommandSchema.parse,
      );
      if (result) {
        setCurrent(result.routine);
        setDraft({
          name: result.routine.name,
          notes: result.routine.notes,
          items: result.routine.items,
        });
        onSaved();
      }
    } catch (error) {
      command.setError(messageOf(error));
    }
  }
  return (
    <Sheet
      title={current ? 'Edit routine' : 'New routine'}
      onClose={() => {
        if (!locked) onClose();
      }}
    >
      <Field
        label="Routine name"
        value={draft.name}
        editable={!locked}
        onChangeText={(name) => setDraft((value) => ({ ...value, name }))}
      />
      <Field
        label="Routine notes"
        value={draft.notes}
        multiline
        editable={!locked}
        onChangeText={(notes) => setDraft((value) => ({ ...value, notes }))}
      />
      {draft.items.map((item, index) => (
        <Card key={item.id}>
          <Disclosure title={`${index + 1}. ${item.snapshot.name}`}>
            <Field
              label={`Notes for ${item.snapshot.name}`}
              value={item.notes}
              multiline
              editable={!locked}
              onChangeText={(notes) => updateItem(item.id, (value) => ({ ...value, notes }))}
            />
            {item.targets.map((target, setIndex) => (
              <TargetEditor
                key={target.id}
                target={target}
                index={setIndex}
                item={item}
                preferences={preferences}
                disabled={locked}
                onError={command.setError}
                onInvalid={(invalid) =>
                  setInvalidTargets((previous) => {
                    const next = new Set(previous);
                    if (invalid) next.add(target.id);
                    else next.delete(target.id);
                    return next;
                  })
                }
                onChange={(next) =>
                  updateItem(item.id, (value) => ({
                    ...value,
                    targets: value.targets.map((t) => (t.id === target.id ? next : t)),
                  }))
                }
                onMoveEarlier={
                  setIndex > 0
                    ? () =>
                        updateItem(item.id, (value) => {
                          const targets = [...value.targets];
                          [targets[setIndex - 1], targets[setIndex]] = [
                            targets[setIndex]!,
                            targets[setIndex - 1]!,
                          ];
                          return { ...value, targets };
                        })
                    : undefined
                }
                onRemove={() =>
                  updateItem(item.id, (value) => ({
                    ...value,
                    targets: value.targets.filter((t) => t.id !== target.id),
                  }))
                }
              />
            ))}
            <Action
              title={`Add target set to ${item.snapshot.name}`}
              secondary
              disabled={locked}
              onPress={() =>
                updateItem(item.id, (value) => ({
                  ...value,
                  targets: [...value.targets, newTarget(value)],
                }))
              }
            />
            <Disclosure title={`More options for ${item.snapshot.name}`}>
              {index > 0 && (
                <Action
                  title={`Move ${item.snapshot.name} earlier`}
                  secondary
                  disabled={locked}
                  onPress={() =>
                    setDraft((value) => {
                      const items = [...value.items];
                      [items[index - 1], items[index]] = [items[index]!, items[index - 1]!];
                      return { ...value, items };
                    })
                  }
                />
              )}
              <Action
                title={`Remove ${item.snapshot.name} from routine`}
                secondary
                disabled={locked}
                onPress={() =>
                  setDraft((value) => ({
                    ...value,
                    items: value.items.filter((i) => i.id !== item.id),
                  }))
                }
              />
            </Disclosure>
          </Disclosure>
          <Body>{targetSummary(item, preferences)}</Body>
        </Card>
      ))}
      <Action
        title="Add exercise"
        secondary
        disabled={locked || draft.items.length >= 100}
        onPress={() => setPicker(!picker)}
      />
      {picker && (
        <>
          <Field
            label="Find exercise to add"
            value={search}
            editable={!locked}
            onChangeText={setSearch}
          />
          {exercises
            .filter((e) => !e.archivedAt && e.name.toLowerCase().includes(search.toLowerCase()))
            .map((exercise) => (
              <Action
                key={exercise.id}
                title={`Add ${exercise.name}`}
                secondary
                disabled={locked}
                onPress={() => {
                  setPicker(false);
                  setSearch('');
                  setDraft((value) => {
                    const item: Item = {
                      id: Crypto.randomUUID(),
                      exerciseId: exercise.id,
                      snapshot: {
                        name: exercise.name,
                        mode: exercise.mode,
                        supportsLoad: exercise.supportsLoad,
                      },
                      targets: [],
                      notes: '',
                    };
                    return {
                      ...value,
                      items: [...value.items, { ...item, targets: [newTarget(item)] }],
                    };
                  });
                }}
              />
            ))}
          <Action title="Cancel exercise picker" secondary onPress={() => setPicker(false)} />
        </>
      )}
      {!!command.error && <Body error>{command.error}</Body>}
      {current && !command.pending && (
        <Action
          title="Review latest saved routine"
          secondary
          disabled={command.busy}
          onPress={() => void reviewLatest()}
        />
      )}
      {reviewing && (
        <Card>
          <Body>Latest saved routine: {current?.name}</Body>
          <Body>Latest saved notes: {current?.notes || 'None'}</Body>
          {current?.items.map((item) => (
            <Body key={item.id}>
              {item.snapshot.name}: {item.targets.length} target sets. {item.notes}
            </Body>
          ))}
          <Body>Your edits above are retained. Saving replaces this plan with your edits.</Body>
        </Card>
      )}
      <Action
        title={command.pending ? 'Retry unchanged request' : 'Save routine'}
        busy={command.busy}
        disabled={!draft.name.trim() || invalidTargets.size > 0}
        onPress={() => void save(current ? 'routine.edit' : 'routine.create')}
      />
      {current && !command.pending && (
        <>
          <Action title="More routine options" secondary onPress={() => setMore(!more)} />
          {more && (
            <>
              <Action
                title="Duplicate saved routine"
                secondary
                busy={command.busy}
                onPress={() => void save('routine.duplicate')}
              />
              <Action
                title={current.archivedAt ? 'Unarchive routine' : 'Archive routine'}
                secondary
                busy={command.busy}
                onPress={() =>
                  void save(current.archivedAt ? 'routine.unarchive' : 'routine.archive')
                }
              />
            </>
          )}
        </>
      )}
      <Action title="Close routine" secondary disabled={locked} onPress={onClose} />
    </Sheet>
  );
}

function TargetEditor({
  target,
  index,
  item,
  preferences,
  disabled,
  onChange,
  onError,
  onInvalid,
  onRemove,
  onMoveEarlier,
}: {
  target: Target;
  index: number;
  item: Item;
  preferences: Preferences;
  disabled: boolean;
  onChange: (target: Target) => void;
  onError: (message: string) => void;
  onInvalid: (invalid: boolean) => void;
  onRemove: () => void;
  onMoveEarlier?: () => void;
}) {
  const m = target.measurements;
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const invalid = React.useRef(new Set<string>());
  useEffect(() => {
    setInputs({});
  }, [preferences.weightUnit, preferences.distanceUnit]);
  useEffect(() => () => onInvalid(false), []);
  function field(
    key: string,
    label: string,
    quantity: number | null,
    convert: (value: number) => number = (v) => v,
    display: (value: number) => number = (v) => v,
    integer = false,
  ) {
    const value =
      inputs[key] ?? (quantity === null ? '' : String(Number(display(quantity).toFixed(4))));
    return (
      <Field
        key={key}
        label={`${label} for set ${index + 1}`}
        keyboardType="decimal-pad"
        editable={!disabled}
        value={value}
        onChangeText={(text) => {
          setInputs((values) => ({ ...values, [key]: text }));
          try {
            const n = numericInput(text, label, integer);
            invalid.current.delete(key);
            onInvalid(invalid.current.size > 0);
            onChange({
              ...target,
              measurements: { ...m, [key]: n === null ? null : convert(n) },
            } as Target);
            onError('');
          } catch (error) {
            invalid.current.add(key);
            onInvalid(true);
            onError(messageOf(error));
          }
        }}
      />
    );
  }
  return (
    <View style={layout.stack}>
      <Choice
        label={`Set ${index + 1} type`}
        value={target.kind}
        disabled={disabled}
        options={[
          { value: 'warmup', label: 'Warm-up' },
          { value: 'working', label: 'Working' },
        ]}
        onChange={(kind) => onChange({ ...target, kind })}
      />
      {(m.mode === 'weighted' || m.mode === 'bodyweight') &&
        field('reps', 'Repetitions', m.reps, undefined, undefined, true)}
      {m.mode === 'weighted' &&
        field(
          'loadKg',
          `Load (${preferences.weightUnit})`,
          m.loadKg,
          (v) => weightToKg(v, preferences.weightUnit),
          (v) => weightFromKg(v, preferences.weightUnit),
        )}
      {m.mode === 'bodyweight' &&
        item.snapshot.supportsLoad &&
        field(
          'addedLoadKg',
          `Added load (${preferences.weightUnit})`,
          m.addedLoadKg,
          (v) => weightToKg(v, preferences.weightUnit),
          (v) => weightFromKg(v, preferences.weightUnit),
        )}
      {(m.mode === 'timed' || m.mode === 'distance') &&
        field('durationSeconds', 'Duration (seconds)', m.durationSeconds)}
      {m.mode === 'distance' &&
        field(
          'distanceMeters',
          `Distance (${preferences.distanceUnit})`,
          m.distanceMeters,
          (v) => distanceToMeters(v, preferences.distanceUnit),
          (v) => distanceFromMeters(v, preferences.distanceUnit),
        )}
      {(m.mode === 'timed' || m.mode === 'distance') &&
        item.snapshot.supportsLoad &&
        field(
          'loadKg',
          `Load (${preferences.weightUnit})`,
          m.loadKg,
          (v) => weightToKg(v, preferences.weightUnit),
          (v) => weightFromKg(v, preferences.weightUnit),
        )}
      <Field
        label={`Notes for set ${index + 1}`}
        value={target.notes}
        multiline
        editable={!disabled}
        onChangeText={(notes) => onChange({ ...target, notes })}
      />
      {onMoveEarlier && (
        <Action
          title={`Move set ${index + 1} earlier`}
          secondary
          disabled={disabled}
          onPress={onMoveEarlier}
        />
      )}
      <Action title={`Remove set ${index + 1}`} secondary disabled={disabled} onPress={onRemove} />
    </View>
  );
}
const layout = StyleSheet.create({
  stack: { gap: 16 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modal: { flex: 1 },
  sheet: { padding: 24, gap: 18 },
});
