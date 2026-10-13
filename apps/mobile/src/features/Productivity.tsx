import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import * as Crypto from 'expo-crypto';
import {
  BoardSchema,
  ProjectSchema,
  BoardCommandSchema,
  ProjectCommandSchema,
  RecurrenceSeriesSchema,
  RecurrenceCommandSchema,
  StepCommandSchema,
  TaskStepSchema,
  TaskSchema,
  type Board,
  type Project,
  type Task,
  type RecurrenceSeries,
  type TaskStep,
} from '@mems-life/domain';
import type { InstallationClient } from '../client';
import { Action, Body, Card, Choice, Field, Heading } from '../ui';
import { messageOf, useCommand } from './helpers';
import { DateTimeField } from '../DateTimeField';

export const BoardsResponse = z.object({ boards: z.array(BoardSchema) });
export const ProjectsResponse = z.object({ projects: z.array(ProjectSchema) });
const SeriesResponse = z.object({ series: z.array(RecurrenceSeriesSchema) });
const StepResponse = z.object({
  task: TaskSchema,
  entries: z.array(
    z.object({ step: TaskStepSchema, ready: z.boolean(), waitingReason: z.string().nullable() }),
  ),
  nextActions: z.array(z.string()),
  canComplete: z.boolean(),
});
const operationResponse =
  <T,>(schema: z.ZodType<T>) =>
  (value: unknown) =>
    schema.parse(value);
const phaseOptions = [
  { value: 'planned', label: 'Planned' },
  { value: 'next', label: 'Next' },
  { value: 'active', label: 'Active' },
] as const;

export function localInstant(date: string, time: string, zone: string): string | null {
  if (!date.trim() && !time.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('Enter a date as YYYY-MM-DD and a time as HH:MM, or clear both.');
  return Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(zone, { disambiguation: 'compatible' })
    .toInstant()
    .toString();
}
export function localParts(at: string | null, zone: string) {
  if (!at) return { date: '', time: '' };
  const local = Temporal.Instant.from(at).toZonedDateTimeISO(zone);
  return { date: local.toPlainDate().toString(), time: local.toPlainTime().toString().slice(0, 5) };
}
export function DateFields({
  label,
  value,
  onChange,
  zone,
  disabled,
}: {
  label: string;
  value: { date: string; time: string };
  onChange: (value: { date: string; time: string }) => void;
  zone: string;
  disabled: boolean;
}) {
  let instant: string | null = null;
  let invalid = false;
  try {
    instant = localInstant(value.date, value.time, zone);
  } catch {
    invalid = true;
  }
  return (
    <View style={{ gap: 10 }}>
      <DateTimeField
        label={label}
        value={instant}
        timezone={zone}
        disabled={disabled}
        onChange={(at) => onChange(localParts(at, zone))}
      />
      {invalid && (
        <>
          <Body error>
            Your unfinished date and time are retained. Correct them below or choose a new date.
          </Body>
          <Field
            label={`${label} date`}
            value={value.date}
            onChangeText={(date) => onChange({ ...value, date })}
            editable={!disabled}
            placeholder="YYYY-MM-DD"
          />
          <Field
            label={`${label} time`}
            value={value.time}
            onChangeText={(time) => onChange({ ...value, time })}
            editable={!disabled}
            placeholder="HH:MM"
          />
        </>
      )}
      <Body>
        Times use {zone}. At a daylight-saving gap the time moves forward; a repeated time uses the
        earlier offset.
      </Body>
    </View>
  );
}

export function Configuration({
  client,
  boards,
  projects,
  onSaved,
}: {
  client: InstallationClient;
  boards: Board[];
  projects: Project[];
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<'board' | 'project'>('board');
  const [selected, setSelected] = useState('new');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<Board['content']['columns']>([]);
  const [reviewed, setReviewed] = useState(false);
  const [baseRevision, setBaseRevision] = useState(0);
  const [latest, setLatest] = useState('');
  const command = useCommand(client);
  const locked = command.busy || command.pending;
  function choose(id: string, type = kind) {
    setSelected(id);
    setReviewed(false);
    setLatest('');
    const record = (type === 'board' ? boards : projects).find((r) => r.id === id);
    setBaseRevision(record?.revision ?? 0);
    setName(record?.content.name ?? '');
    setDescription(type === 'project' && record ? (record as Project).content.description : '');
    setColumns(
      type === 'board' && record
        ? (record as Board).content.columns
        : phaseOptions.map((p) => ({ id: Crypto.randomUUID(), name: p.label, phase: p.value })),
    );
  }
  useEffect(() => {
    choose('new');
  }, []);
  async function save() {
    const creating = selected === 'new';
    const body = {
      type: `${kind}.${creating ? 'create' : 'edit'}`,
      id: creating ? Crypto.randomUUID() : selected,
      expectedRevision: baseRevision,
      content: kind === 'board' ? { name, columns } : { name, description },
    };
    const result = await command.send(
      `/api/${kind === 'board' ? 'boards' : 'projects'}/commands`,
      body,
      operationResponse(z.object({ record: kind === 'board' ? BoardSchema : ProjectSchema })),
      kind === 'board' ? BoardCommandSchema.parse : ProjectCommandSchema.parse,
    );
    if (result) {
      setSelected(result.record.id);
      setBaseRevision(result.record.revision);
      setReviewed(false);
      onSaved();
    }
  }
  async function review() {
    try {
      const response =
        kind === 'board'
          ? BoardsResponse.parse(await client.request('/api/boards')).boards
          : ProjectsResponse.parse(await client.request('/api/projects')).projects;
      const saved = response.find((r) => r.id === selected);
      if (!saved) throw new Error('The selected configuration is no longer available.');
      setLatest(
        kind === 'board'
          ? `${saved.content.name}; columns: ${(saved as Board).content.columns.map((c) => `${c.name} (${c.phase})`).join(', ')}`
          : `${saved.content.name}; ${(saved as Project).content.description || 'No description'}`,
      );
      setBaseRevision(saved.revision);
      setReviewed(true);
    } catch (e) {
      command.setError(messageOf(e));
    }
  }
  return (
    <Card>
      <Heading>Boards and projects</Heading>
      <Body>
        Column labels organize work. Changing a label or mapping never releases a task; choose
        Release to Next in task details.
      </Body>
      <Choice
        label="Configure"
        value={kind}
        disabled={locked}
        options={[
          { value: 'board', label: 'Boards' },
          { value: 'project', label: 'Projects' },
        ]}
        onChange={(v) => {
          setKind(v);
          choose('new', v);
        }}
      />
      <Choice
        label="Configuration record"
        value={selected}
        disabled={locked}
        options={[
          { value: 'new', label: `New ${kind}` },
          ...(kind === 'board' ? boards : projects).map((r) => ({
            value: r.id,
            label: r.content.name,
          })),
        ]}
        onChange={choose}
      />
      <Field label="Configuration name" value={name} onChangeText={setName} editable={!locked} />
      {kind === 'project' ? (
        <Field
          label="Project description"
          value={description}
          onChangeText={setDescription}
          editable={!locked}
          multiline
        />
      ) : (
        columns.map((c, i) => (
          <View key={c.id} style={{ gap: 8 }}>
            <Field
              label={`Column ${i + 1} name`}
              value={c.name}
              editable={!locked}
              onChangeText={(name) =>
                setColumns(columns.map((x) => (x.id === c.id ? { ...x, name } : x)))
              }
            />
            <Choice
              label={`Column ${i + 1} phase`}
              value={c.phase}
              options={phaseOptions}
              disabled={locked}
              onChange={(phase) =>
                setColumns(columns.map((x) => (x.id === c.id ? { ...x, phase } : x)))
              }
            />
            <Action
              title={`Remove column ${i + 1}`}
              secondary
              disabled={locked || columns.length <= 3}
              onPress={() => setColumns(columns.filter((x) => x.id !== c.id))}
            />
          </View>
        ))
      )}
      {kind === 'board' && (
        <Action
          title="Add column"
          secondary
          disabled={locked || columns.length >= 30}
          onPress={() =>
            setColumns([
              ...columns,
              { id: Crypto.randomUUID(), name: 'New column', phase: 'planned' },
            ])
          }
        />
      )}
      {!!command.error && <Body error>{command.error}</Body>}
      {latest && (
        <Body>
          Latest saved configuration: {latest}. Your fields remain above. Saving after review
          replaces those saved values.
        </Body>
      )}
      {!command.pending && selected !== 'new' && (
        <Action
          title="Review latest configuration"
          secondary
          disabled={locked}
          onPress={() => void review()}
        />
      )}
      <Action
        title={
          command.pending
            ? 'Retry unchanged configuration'
            : reviewed
              ? 'Save reviewed configuration'
              : 'Save configuration'
        }
        busy={command.busy}
        disabled={!name.trim() && !command.pending}
        onPress={() => void save()}
      />
    </Card>
  );
}

export function Steps({
  task,
  client,
  onTask,
}: {
  task: Task;
  client: InstallationClient;
  onTask: (task: Task) => void;
}) {
  const [data, setData] = useState<z.infer<typeof StepResponse> | null>(null);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<TaskStep | null>(null);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [responsibility, setResponsibility] = useState<'human' | 'agent' | 'either'>('human');
  const [required, setRequired] = useState('required');
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [assignment, setAssignment] = useState('');
  const [filter, setFilter] = useState('all');
  const [reviewed, setReviewed] = useState(false);
  const command = useCommand(client);
  const locked = command.busy || command.pending;
  async function load(review = false) {
    try {
      const result = StepResponse.parse(await client.request(`/api/tasks/${task.id}/steps`));
      setData(result);
      onTask(result.task);
      if (review) {
        const latest = result.entries.find((e) => e.step.id === selected?.id)?.step;
        if (latest) setSelected(latest);
        setReviewed(true);
      }
    } catch (e) {
      command.setError(messageOf(e));
    }
  }
  useEffect(() => {
    void load();
  }, [task.id]);
  function edit(step: TaskStep | null) {
    setEditing(true);
    setSelected(step);
    setTitle(step?.content.title ?? '');
    setInstructions(step?.content.instructions ?? '');
    setResponsibility(step?.content.responsibility ?? 'human');
    setRequired(step?.content.required === false ? 'optional' : 'required');
    setDependencies(step?.content.dependencies ?? []);
    setAssignment(step?.assignedTo ?? '');
    setReviewed(false);
  }
  async function act(type: string, extra: Record<string, unknown>, step = selected) {
    const result = await command.send(
      '/api/steps/commands',
      {
        type,
        taskId: task.id,
        id: step?.id ?? Crypto.randomUUID(),
        expectedRevision: step?.revision ?? 0,
        expectedTaskRevision: task.revision,
        ...extra,
      },
      operationResponse(StepResponse),
      StepCommandSchema.parse,
    );
    if (result) {
      setData(result);
      onTask(result.task);
      const updated = result.entries.find((e) => e.step.id === selected?.id)?.step;
      if (updated) setSelected(updated);
      else if (type === 'step.create' || type === 'step.delete') edit(null);
      setReviewed(false);
    }
  }
  const reasons: Record<string, string> = {
    not_released: 'Waiting for deliberate release to Next',
    paused: 'Parent task is paused',
    dependencies: 'Waiting for prerequisites',
    parent_closed: 'Parent task is closed',
  };
  return (
    <Card>
      <Heading>Steps and next actions</Heading>
      <Body>
        Required steps and any final review govern completion of the parent. Assignment is separate
        from readiness. Agents execute work through external clients.
      </Body>
      <Choice
        label="Responsibility view"
        value={filter}
        disabled={locked}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All steps' },
          { value: 'human', label: 'Needs a person' },
          { value: 'agent', label: 'Agent work' },
        ]}
      />
      {data?.entries
        .filter(
          (e) =>
            filter === 'all' ||
            e.step.content.responsibility === filter ||
            e.step.content.responsibility === 'either',
        )
        .map(({ step, ready, waitingReason }) => (
          <View key={step.id} style={{ gap: 8 }}>
            <Body>
              {step.content.title} · {step.content.responsibility} ·{' '}
              {step.content.required ? 'Required' : 'Optional'} · {step.status}
            </Body>
            <Body>
              {ready
                ? 'Next action: ready'
                : waitingReason
                  ? (reasons[waitingReason] ?? waitingReason)
                  : 'No pending action'}{' '}
              · Assigned: {step.assignedTo ?? 'Unassigned'}
            </Body>
            <Action
              title={`Edit step ${step.content.title}`}
              secondary
              disabled={locked}
              onPress={() => edit(step)}
            />
            <Action
              title={`Complete step ${step.content.title}`}
              disabled={locked || Boolean(waitingReason) || step.status === 'completed'}
              onPress={() => void act('step.status', { status: 'completed' }, step)}
            />
            {!step.content.required && step.status !== 'skipped' && (
              <Action
                title={`Skip optional step ${step.content.title}`}
                secondary
                disabled={locked}
                onPress={() => void act('step.status', { status: 'skipped' }, step)}
              />
            )}
            {step.status === 'completed' && (
              <Action
                title={`Reopen step ${step.content.title}`}
                secondary
                disabled={locked}
                onPress={() => void act('step.status', { status: 'pending' }, step)}
              />
            )}
          </View>
        ))}
      {data && (
        <Body>
          {data.canComplete
            ? 'Requirements satisfied; complete the parent deliberately.'
            : 'Parent completion is waiting for required steps or final review.'}
        </Body>
      )}
      <Action
        title={editing ? 'Hide step editor' : 'Create a step'}
        secondary
        disabled={locked}
        onPress={() => setEditing(!editing)}
      />
      <View style={{ display: editing ? 'flex' : 'none', gap: 18 }}>
        <Field label="Step title" value={title} onChangeText={setTitle} editable={!locked} />
        <Field
          label="Step instructions"
          value={instructions}
          onChangeText={setInstructions}
          editable={!locked}
          multiline
        />
        <Choice
          label="Step responsibility"
          value={responsibility}
          onChange={setResponsibility}
          disabled={locked}
          options={[
            { value: 'human', label: 'Human' },
            { value: 'agent', label: 'Agent' },
            { value: 'either', label: 'Either' },
          ]}
        />
        <Choice
          label="Completion requirement"
          value={required}
          onChange={setRequired}
          disabled={locked}
          options={[
            { value: 'required', label: 'Required' },
            { value: 'optional', label: 'Optional' },
          ]}
        />
        <Body>
          Prerequisites: choose steps that must finish first. The server rejects cycles and invalid
          dependencies.
        </Body>
        {data?.entries
          .filter((e) => e.step.id !== selected?.id)
          .map(({ step }) => (
            <Action
              key={step.id}
              title={`${dependencies.includes(step.id) ? 'Remove prerequisite' : 'Require'}: ${step.content.title}`}
              secondary
              disabled={locked}
              onPress={() =>
                setDependencies(
                  dependencies.includes(step.id)
                    ? dependencies.filter((id) => id !== step.id)
                    : [...dependencies, step.id],
                )
              }
            />
          ))}
        {!!command.error && <Body error>{command.error}</Body>}
        {reviewed && (
          <Body>
            Latest saved step: {selected?.content.title ?? 'New step'} ·{' '}
            {selected?.content.instructions} · {selected?.content.responsibility} ·{' '}
            {selected?.content.required ? 'Required' : 'Optional'} · prerequisites{' '}
            {selected?.content.dependencies
              .map(
                (id) =>
                  data?.entries.find((e) => e.step.id === id)?.step.content.title ??
                  'Unavailable prerequisite',
              )
              .join(', ') || 'None'}
            . Your fields remain above; saving replaces these saved values.
          </Body>
        )}
        <Action
          title={
            command.pending
              ? 'Retry unchanged step request'
              : selected
                ? reviewed
                  ? 'Save reviewed step'
                  : 'Save step'
                : 'Add step'
          }
          busy={command.busy}
          disabled={!title.trim() && !command.pending}
          onPress={() =>
            void act(selected ? 'step.edit' : 'step.create', {
              content: {
                title,
                instructions,
                responsibility,
                required: required === 'required',
                dependencies,
                order: selected?.content.order ?? data?.entries.length ?? 0,
              },
            })
          }
        />
        {selected && !command.pending && (
          <>
            <Field
              label="Assigned participant"
              value={assignment}
              onChangeText={setAssignment}
              editable={!locked}
            />
            <Action
              title="Save assignment"
              secondary
              disabled={locked}
              onPress={() => void act('step.assign', { assignedTo: assignment.trim() || null })}
            />
            <Action
              title="Review latest steps"
              secondary
              disabled={locked}
              onPress={() => void load(true)}
            />
            <Action
              title="Delete selected step"
              secondary
              disabled={locked}
              onPress={() => void act('step.delete', {})}
            />
            <Action title="New step" secondary disabled={locked} onPress={() => edit(null)} />
          </>
        )}
      </View>
    </Card>
  );
}

export function Recurrence({
  client,
  zone,
  occurrence,
  onSaved,
}: {
  client: InstallationClient;
  zone: string;
  occurrence?: Task;
  onSaved: () => void;
}) {
  const [series, setSeries] = useState<RecurrenceSeries[]>([]);
  const [selected, setSelected] = useState('new');
  const [baseRevision, setBaseRevision] = useState(0);
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [timeZone, setTimeZone] = useState(zone);
  const [time, setTime] = useState('09:00');
  const [startDate, setStartDate] = useState(Temporal.Now.plainDateISO(zone).toString());
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthDay, setMonthDay] = useState('1');
  const [reviewed, setReviewed] = useState(false);
  const command = useCommand(client);
  const locked = command.busy || command.pending;
  const current = series.find((s) => s.id === selected);
  async function load(review = false) {
    try {
      const result = SeriesResponse.parse(await client.request('/api/recurrence'));
      setSeries(result.series);
      if (review) {
        const latest = result.series.find((s) => s.id === selected);
        if (latest) setBaseRevision(latest.revision);
        setReviewed(true);
      }
    } catch (e) {
      command.setError(messageOf(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function choose(id: string) {
    setSelected(id);
    const s = series.find((s) => s.id === id);
    setBaseRevision(s?.revision ?? 0);
    setTitle(s?.content.title ?? '');
    setFrequency(s?.rule.frequency ?? 'daily');
    setTimeZone(s?.rule.timeZone ?? zone);
    setTime(s?.rule.time ?? '09:00');
    setStartDate(s?.rule.startDate ?? Temporal.Now.plainDateISO(zone).toString());
    setWeekdays(s?.rule.weekdays ?? [1]);
    setMonthDay(String(s?.rule.monthDay ?? 1));
    setReviewed(false);
  }
  async function act(type: string) {
    const extra =
      type === 'series.create' || type === 'series.edit'
        ? {
            content: {
              title,
              description: current?.content.description ?? '',
              notes: current?.content.notes ?? '',
            },
            rule: { frequency, timeZone, time, startDate, weekdays, monthDay: Number(monthDay) },
          }
        : type === 'series.skip'
          ? { taskId: occurrence!.id, expectedTaskRevision: occurrence!.revision }
          : {};
    const result = await command.send(
      '/api/recurrence/commands',
      {
        type,
        id: selected === 'new' ? Crypto.randomUUID() : selected,
        expectedRevision: baseRevision,
        ...extra,
      },
      operationResponse(z.object({ series: RecurrenceSeriesSchema })),
      RecurrenceCommandSchema.parse,
    );
    if (result) {
      setSelected(result.series.id);
      setBaseRevision(result.series.revision);
      setReviewed(false);
      await load();
      onSaved();
    }
  }
  return (
    <Card>
      <Heading>Recurring responsibilities</Heading>
      <Body>
        A series is separate from each task occurrence. Future edits and cancellation preserve
        earlier occurrences. Late completion creates the next future occurrence; missing monthly
        days use the last day. Skipping affects only one occurrence.
      </Body>
      <Choice
        label="Recurrence series"
        value={selected}
        disabled={locked}
        onChange={choose}
        options={[
          { value: 'new', label: 'New series' },
          ...series.map((s) => ({
            value: s.id,
            label: `${s.content.title}${s.cancelledAt ? ' (cancelled)' : ''}`,
          })),
        ]}
      />
      <Field label="Series title" value={title} onChangeText={setTitle} editable={!locked} />
      <Choice
        label="Repeat"
        value={frequency}
        onChange={setFrequency}
        disabled={locked}
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekdays' },
          { value: 'monthly', label: 'Monthly' },
        ]}
      />
      <Field
        label="Series start date"
        value={startDate}
        onChangeText={setStartDate}
        editable={!locked}
        placeholder="YYYY-MM-DD"
      />
      <Field
        label="Series local time"
        value={time}
        onChangeText={setTime}
        editable={!locked}
        placeholder="HH:MM"
      />
      <Field
        label="Series time zone"
        value={timeZone}
        onChangeText={setTimeZone}
        editable={!locked}
        autoCapitalize="none"
        placeholder="America/New_York"
      />
      <Body>
        This local clock time stays in {timeZone} when daylight saving changes. A missing clock time
        shifts forward; a repeated time uses the earlier offset.
      </Body>
      {frequency === 'monthly' && (
        <Field
          label="Day of month"
          keyboardType="number-pad"
          value={monthDay}
          onChangeText={setMonthDay}
          editable={!locked}
        />
      )}
      {frequency === 'weekly' &&
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
          (label, i) => (
            <Action
              key={label}
              title={`${weekdays.includes(i + 1) ? 'Remove' : 'Add'} ${label}`}
              secondary
              disabled={locked}
              onPress={() =>
                setWeekdays(
                  weekdays.includes(i + 1)
                    ? weekdays.filter((d) => d !== i + 1)
                    : [...weekdays, i + 1],
                )
              }
            />
          ),
        )}
      {!!command.error && <Body error>{command.error}</Body>}
      {reviewed && (
        <Body>
          Latest saved series: {current?.content.title} · {current?.rule.frequency} ·{' '}
          {current?.rule.time} {current?.rule.timeZone} · starts {current?.rule.startDate} ·
          weekdays {current?.rule.weekdays.join(', ')} · month day {current?.rule.monthDay}. Your
          edits above are retained.
        </Body>
      )}
      <Action
        title={
          command.pending
            ? 'Retry unchanged recurrence request'
            : selected === 'new'
              ? 'Create recurrence series'
              : reviewed
                ? 'Save reviewed future recurrence'
                : 'Save future recurrence'
        }
        busy={command.busy}
        disabled={Boolean(current?.cancelledAt) || (!title.trim() && !command.pending)}
        onPress={() => void act(selected === 'new' ? 'series.create' : 'series.edit')}
      />
      {current && !current.cancelledAt && !command.pending && (
        <>
          <Action
            title="Review latest recurrence"
            secondary
            disabled={locked}
            onPress={() => void load(true)}
          />
          <Action
            title="Generate next outstanding occurrence"
            secondary
            disabled={locked}
            onPress={() => void act('series.generate')}
          />
          <Action
            title="Cancel future recurrence"
            secondary
            disabled={locked}
            onPress={() => void act('series.cancel')}
          />
          {occurrence?.schedule.seriesId === current.id &&
            !occurrence.schedule.skippedAt &&
            occurrence.phase !== 'completed' && (
              <Action
                title="Skip only this occurrence"
                secondary
                disabled={locked}
                onPress={() => void act('series.skip')}
              />
            )}
        </>
      )}
    </Card>
  );
}
