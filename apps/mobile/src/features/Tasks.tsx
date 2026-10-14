import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  TaskResponseSchema,
  TaskCommandSchema,
  TaskListResponseSchema,
  TaskHistoryResponseSchema,
  type Task,
  type Preferences,
} from '@mems-life/domain';
import * as Crypto from 'expo-crypto';
import { parseTaskAcknowledgement, useOfflineRevision } from '../offline-client';
import type { InstallationClient } from '../client';
import { Action, Body, Card, Choice, Field, Heading, usePalette, Disclosure, ListRow } from '../ui';
import { AgentWorkflow } from './AgentWorkflow';
import { messageOf, useCommand } from './helpers';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { type Board, type Project } from '@mems-life/domain';
import {
  BoardsResponse,
  ProjectsResponse,
  Configuration,
  Recurrence,
  Steps,
  DateFields,
  localParts,
  localInstant,
} from './Productivity';

const phases = [
  { value: 'planned', label: 'Planned' },
  { value: 'next', label: 'Next' },
  { value: 'active', label: 'Active' },
] as const;
type TaskView = 'open' | 'completed' | 'archived';

export function Tasks({
  client,
  preferences,
  focusTarget,
}: {
  client: InstallationClient;
  preferences?: Preferences;
  focusTarget?: { kind?: 'task' | 'session' | 'food'; id?: string; action?: 'create' | 'capture' };
}) {
  const [navigationRequest, setNavigationRequest] = useState<{
    id?: string;
    action?: 'create' | 'capture';
  } | null>(null);
  const seenFocus = React.useRef<object | undefined>(undefined);
  const [detailBlocked, setDetailBlocked] = useState(false),
    [captureRequested, setCaptureRequested] = useState(0);
  const zone = preferences?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const [containerWidth, setContainerWidth] = useState(0);
  const wide = containerWidth >= 900;
  const [boards, setBoards] = useState<Board[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filters, setFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [board, setBoard] = useState('all');
  const [project, setProject] = useState('all');
  const [tag, setTag] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [timing, setTiming] = useState('all');
  const [responsibility, setResponsibility] = useState('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<TaskView>('open');
  const [phase, setPhase] = useState<'planned' | 'next' | 'active'>('planned');
  const [column, setColumn] = useState('');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const [opened, setOpened] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const offlineRevision = useOfflineRevision(client);
  const command = useCommand(client);
  async function openFocus(target: { id?: string; action?: 'create' | 'capture' }) {
    setNavigationRequest(null);
    setSelected(null);
    if (target.action === 'create') {
      setView('open');
      setCaptureRequested((v) => v + 1);
      return;
    }
    if (!target.id || !TaskResponseSchema.shape.task.shape.id.safeParse(target.id).success) return;
    try {
      const task = TaskResponseSchema.parse(await client.request(`/api/tasks/${target.id}`)).task;
      setOpened((current) =>
        current.some((t) => t.id === task.id) ? current : [...current, task],
      );
      setSelected(task);
    } catch (error) {
      command.setError(messageOf(error));
    }
  }
  useEffect(() => {
    if (!focusTarget || ('kind' in focusTarget && focusTarget.kind && focusTarget.kind !== 'task'))
      return;
    if (seenFocus.current === focusTarget) return;
    seenFocus.current = focusTarget;
    if (focusTarget.id && selected?.id === focusTarget.id) return;
    if (selected || command.pending || command.busy || detailBlocked) {
      setNavigationRequest(focusTarget);
      return;
    }
    void openFocus(focusTarget);
  }, [focusTarget]);
  const loadSequence = React.useRef(0);
  async function load(cursor?: string) {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ view });
      if (search.trim()) query.set('search', search.trim());
      if (board !== 'all') query.set('boardId', board);
      if (project !== 'all') query.set('projectId', project);
      if (tag.trim()) query.set('tag', tag.trim());
      if (priorityFilter !== 'all') query.set('priority', priorityFilter);
      if (timing !== 'all') query.set('timing', timing);
      if (responsibility !== 'all') query.set('responsibility', responsibility);
      if (cursor) query.set('cursor', cursor);
      const response = (await client.request(`/api/tasks/query?${query.toString()}`)) as {
        tasks: unknown[];
        nextCursor?: string | null;
      };
      const values = TaskListResponseSchema.parse({ tasks: response.tasks }).tasks;
      if (sequence !== loadSequence.current) return;
      setTasks((previous) =>
        cursor
          ? [
              ...previous,
              ...values.filter((task) => !previous.some((saved) => saved.id === task.id)),
            ]
          : values,
      );
      setNextCursor(response.nextCursor ?? null);
    } catch (error) {
      if (sequence === loadSequence.current) command.setError(messageOf(error));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [client, view, board, project, timing, responsibility, priorityFilter, offlineRevision]);
  async function loadConfiguration() {
    try {
      const [b, p] = await Promise.all([
        client.request('/api/boards'),
        client.request('/api/projects'),
      ]);
      setBoards(BoardsResponse.parse(b).boards);
      setProjects(ProjectsResponse.parse(p).projects);
    } catch (error) {
      command.setError(messageOf(error));
    }
  }
  useEffect(() => {
    void loadConfiguration();
  }, [client]);
  async function mutate(body: Record<string, unknown>) {
    const result = await command.send(
      '/api/tasks/commands',
      body,
      parseTaskAcknowledgement,
      TaskCommandSchema.parse,
    );
    if (result) {
      if (body.type === 'task.create') setTitle('');
      await load();
    }
  }
  const selectedBoard = boards.find((b) => b.id === board);
  const orderedTasks = [...tasks].sort((a, b) => a.order - b.order);
  const boardGroups = selectedBoard
    ? selectedBoard.content.columns.map((c) => ({
        id: c.id,
        label: c.name,
        tasks: orderedTasks.filter((t) => t.organization.columnId === c.id),
      }))
    : phases.map((p) => ({
        id: p.value,
        label: p.label,
        tasks: orderedTasks.filter((t) => t.phase === p.value),
      }));
  // Valid unassigned tasks have no board and are found in All boards. Keep any
  // stale or unmatched records returned for a selected board reachable as well.
  if (selectedBoard) {
    const unmatched = orderedTasks.filter(
      (t) => !selectedBoard.content.columns.some((c) => c.id === t.organization.columnId),
    );
    if (unmatched.length)
      boardGroups.push({ id: 'unassigned', label: 'Unassigned', tasks: unmatched });
  }
  const selectedColumn = boardGroups.some((g) => g.id === column)
    ? column
    : (boardGroups[0]?.id ?? '');
  const groups =
    view !== 'open'
      ? [{ id: 'history', label: '', tasks: orderedTasks }]
      : wide
        ? boardGroups
        : boardGroups.filter((g) => g.id === (selectedBoard ? selectedColumn : phase));
  const visible = groups.flatMap((group) => group.tasks);
  return (
    <View
      style={layout.stack}
      testID="tasks-container"
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      {view === 'open' && (
        <>
          <Card>
            <Field
              label="New task"
              key={captureRequested}
              autoFocus={captureRequested > 0}
              value={title}
              onChangeText={setTitle}
              editable={!command.busy && !command.pending}
              placeholder="What needs doing?"
              onSubmitEditing={() => {
                if (title.trim())
                  void mutate({
                    type: 'task.create',
                    taskId: Crypto.randomUUID(),
                    expectedRevision: 0,
                    content: { title: title.trim(), description: '', notes: '' },
                  });
              }}
            />
            <Action
              title={command.pending ? 'Retry task capture' : 'Add to Planned'}
              busy={command.busy}
              disabled={!title.trim() && !command.pending}
              onPress={() =>
                void mutate({
                  type: 'task.create',
                  taskId: Crypto.randomUUID(),
                  expectedRevision: 0,
                  content: { title: title.trim(), description: '', notes: '' },
                })
              }
            />
          </Card>
          {!wide &&
            (selectedBoard ? (
              <Choice
                label="Board column"
                value={selectedColumn}
                onChange={setColumn}
                options={boardGroups.map((g) => ({ value: g.id, label: g.label }))}
              />
            ) : (
              <Choice label="Phase" value={phase} onChange={setPhase} options={phases} />
            ))}
        </>
      )}
      <Action
        title={filters ? 'Hide search and filters' : 'Find and filter work'}
        secondary
        onPress={() => setFilters(!filters)}
      />
      <View style={{ display: filters ? 'flex' : 'none', gap: 18 }}>
        <Field
          label="Search tasks"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
          placeholder="Search title, description or notes"
        />
        <Action title="Search" secondary onPress={() => void load()} />
        <Choice
          label="Board filter"
          value={board}
          onChange={setBoard}
          options={[
            { value: 'all', label: 'All boards' },
            ...boards.map((b) => ({ value: b.id, label: b.content.name })),
          ]}
        />
        <Choice
          label="Project filter"
          value={project}
          onChange={setProject}
          options={[
            { value: 'all', label: 'All projects' },
            ...projects.map((p) => ({ value: p.id, label: p.content.name })),
          ]}
        />
        <Field
          label="Tag filter"
          value={tag}
          onChangeText={setTag}
          onSubmitEditing={() => void load()}
        />
        <Choice
          label="Priority filter"
          value={priorityFilter}
          onChange={setPriorityFilter}
          options={[
            { value: 'all', label: 'Any priority' },
            ...['none', 'low', 'normal', 'high', 'urgent'].map((value) => ({
              value,
              label: value,
            })),
          ]}
        />
        <Choice
          label="Dates view"
          value={timing}
          onChange={setTiming}
          options={[
            { value: 'all', label: 'Any date' },
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'overdue', label: 'Overdue' },
          ]}
        />
        <Choice
          label="Work view"
          value={responsibility}
          onChange={setResponsibility}
          options={[
            { value: 'all', label: 'All work' },
            { value: 'human', label: 'Human work' },
            { value: 'agent', label: 'Agent work' },
          ]}
        />
      </View>
      {!!command.error && <Body error>{command.error}</Body>}
      {command.pending && view !== 'open' && (
        <Action
          title="Retry unchanged request"
          busy={command.busy}
          onPress={() => void mutate({})}
        />
      )}
      <Action title="Refresh tasks" secondary onPress={() => void load()} busy={loading} />
      {!loading && !visible.length && (
        <Body>
          {view === 'open'
            ? `No tasks in this ${selectedBoard ? 'column' : 'phase'}. Capture one above or move a task here.`
            : 'No tasks in this history view yet.'}
        </Body>
      )}
      <View
        style={
          wide && selected ? { flexDirection: 'row', gap: 24, alignItems: 'flex-start' } : undefined
        }
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={wide && !selected ? layout.columns : layout.stack}>
            {groups.map((group) => (
              <View
                key={group.id}
                testID={`task-group-${group.id}`}
                style={
                  wide && !selected
                    ? { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 18 }
                    : layout.stack
                }
              >
                {wide && !!group.label && <Heading compact>{group.label}</Heading>}
                {group.tasks.map((task, index) => (
                  <View key={task.id} style={{ gap: 8 }}>
                    <ListRow
                      title={task.content.title}
                      detail={`${task.phase}${task.paused ? ' · Paused' : ''}${task.schedule.dueAt ? ` · Due ${new Date(task.schedule.dueAt).toLocaleDateString(undefined, { timeZone: zone })}` : ''}`}
                      onPress={() => {
                        setOpened((previous) =>
                          previous.some((t) => t.id === task.id) ? previous : [...previous, task],
                        );
                        setSelected(task);
                      }}
                    />
                    {view === 'open' && index > 0 && (
                      <Action
                        title={`Move ${task.content.title} up`}
                        secondary
                        busy={command.busy}
                        disabled={command.pending}
                        onPress={() =>
                          void mutate({
                            type: 'task.move',
                            taskId: task.id,
                            expectedRevision: task.revision,
                            phase: task.phase,
                            beforeTaskId: group.tasks[index - 1]!.id,
                          })
                        }
                      />
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
        <View style={wide && selected ? { flex: 1, minWidth: 0 } : undefined}>
          {opened.map((openedTask) => (
            <TaskDetail
              key={openedTask.id}
              task={openedTask}
              embedded={wide}
              visible={selected?.id === openedTask.id}
              navigationRequested={!!navigationRequest}
              onKeepEditing={() => setNavigationRequest(null)}
              onContinueNavigation={() => {
                if (navigationRequest) void openFocus(navigationRequest);
              }}
              onBlockedChange={setDetailBlocked}
              client={client}
              zone={zone}
              boards={boards}
              projects={projects}
              onClose={() => setSelected(null)}
              onSaved={() => void load()}
            />
          ))}
        </View>
      </View>
      <Disclosure title="More">
        <Choice
          label="Task view"
          value={view}
          onChange={setView}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'completed', label: 'Completed' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <Disclosure title="Manage boards and projects">
          <Configuration
            client={client}
            boards={boards}
            projects={projects}
            onSaved={() => {
              void loadConfiguration();
              void load();
            }}
          />
        </Disclosure>
        <Disclosure title="Manage recurring responsibilities">
          <Recurrence client={client} zone={zone} onSaved={() => void load()} />
        </Disclosure>
      </Disclosure>
      {nextCursor && (
        <Action
          title="Load more tasks"
          secondary
          busy={loading}
          onPress={() => void load(nextCursor)}
        />
      )}
    </View>
  );
}

function TaskDetail({
  task,
  embedded = false,
  client,
  onClose,
  onSaved,
  zone,
  boards,
  projects,
  visible,
  navigationRequested,
  onKeepEditing,
  onContinueNavigation,
  onBlockedChange,
}: {
  task: Task;
  embedded?: boolean;
  visible: boolean;
  navigationRequested: boolean;
  onKeepEditing: () => void;
  onContinueNavigation: () => void;
  onBlockedChange: (blocked: boolean) => void;
  zone: string;
  boards: Board[];
  projects: Project[];
  client: InstallationClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [workflowBlocked, setWorkflowBlocked] = useState(false);
  const [stepsBlocked, setStepsBlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [agentManagement, setAgentManagement] = useState(false);
  const [stepState, setStepState] = useState({ canComplete: false, hasAgent: false, nextStep: '' });
  const palette = usePalette();
  const insets = React.useContext(SafeAreaInsetsContext) ?? {
    top: 24,
    bottom: 24,
    left: 0,
    right: 0,
  };
  const [containerWidth, setContainerWidth] = useState(0);
  const wide = containerWidth >= 900;
  const [current, setCurrent] = useState(task);
  const [title, setTitle] = useState(task.content.title);
  const [description, setDescription] = useState(task.content.description);
  const [notes, setNotes] = useState(task.content.notes);
  const [organization, setOrganization] = useState(task.organization);
  const [tags, setTags] = useState(task.organization.tags.join(', '));
  const [due, setDue] = useState(localParts(task.schedule.dueAt, zone));
  const [scheduled, setScheduled] = useState(localParts(task.schedule.scheduledAt, zone));
  const [history, setHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const command = useCommand(client);
  const offlineRevision = useOfflineRevision(client);
  const [draftReady, setDraftReady] = useState(!client.offline);
  useEffect(() => {
    let active = true;
    if (!client.offline) {
      setDraftReady(true);
      return;
    }
    void client.offline.store
      .getDraft<{
        title: string;
        description: string;
        notes: string;
        organization: Task['organization'];
        tags: string;
        due: ReturnType<typeof localParts>;
        scheduled: ReturnType<typeof localParts>;
      }>(`task-editor:${task.id}`)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          setTitle(saved.title);
          setDescription(saved.description);
          setNotes(saved.notes);
          setOrganization(saved.organization);
          setTags(saved.tags);
          setDue(saved.due);
          setScheduled(saved.scheduled);
        }
        setDraftReady(true);
      })
      .catch((e) => command.setError(messageOf(e)));
    return () => {
      active = false;
    };
  }, [client, task.id]);
  useEffect(() => {
    if (!draftReady || !client.offline) return;
    void client.offline.store
      .setDraft(`task-editor:${task.id}`, {
        title,
        description,
        notes,
        organization,
        tags,
        due,
        scheduled,
      })
      .catch((e) => command.setError(`Draft storage failed: ${messageOf(e)}`));
  }, [client, draftReady, task.id, title, description, notes, organization, tags, due, scheduled]);
  useEffect(() => {
    if (client.offline)
      void client.offline.store
        .records('task')
        .then((records) => {
          const record = records.find((r) => r.id === task.id);
          if (record) setCurrent(TaskResponseSchema.parse({ task: record.value }).task);
        })
        .catch((e) => command.setError(messageOf(e)));
  }, [client, task.id, offlineRevision]);
  async function loadHistory(cursor?: string) {
    try {
      const data = TaskHistoryResponseSchema.parse(
        await client.request(
          `/api/tasks/${task.id}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        ),
      );
      const entries = data.events.map(
        (event) =>
          `${event.type.replace('task.', '')} · ${event.actorType} ${event.actorId} · ${new Date(event.createdAt).toLocaleString()}`,
      );
      setHistory((previous) => (cursor ? [...previous, ...entries] : entries));
      setHistoryCursor(data.nextCursor);
    } catch (error) {
      command.setError(messageOf(error));
    }
  }
  useEffect(() => {
    void loadHistory();
  }, []);
  async function act(type: string, extra: Record<string, unknown> = {}) {
    const result = await command.send(
      '/api/tasks/commands',
      { type, taskId: current.id, expectedRevision: current.revision, ...extra },
      parseTaskAcknowledgement,
      TaskCommandSchema.parse,
    );
    if (result) {
      setCurrent(result.task);
      onSaved();
      void loadHistory();
    }
  }
  async function reviewLatest() {
    try {
      setCurrent(TaskResponseSchema.parse(await client.request(`/api/tasks/${task.id}`)).task);
      setReviewing(true);
    } catch (error) {
      command.setError(messageOf(error));
    }
  }
  const locked = command.busy || command.pending || workflowBlocked || stepsBlocked || !draftReady;
  useEffect(() => {
    if (visible) onBlockedChange(locked);
  }, [visible, locked, onBlockedChange]);
  const DetailContainer = embedded ? View : Modal;
  return (
    <DetailContainer
      style={embedded ? { display: visible ? 'flex' : 'none', maxHeight: 780 } : undefined}
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        if (!locked) onClose();
        else command.setError('Resolve the pending task, agent or file change before closing.');
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          embedded ? { minHeight: 500, maxHeight: 780 } : layout.modal,
          { backgroundColor: palette.background },
        ]}
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
      >
        <View
          style={{
            paddingTop: embedded ? 0 : insets.top,
            paddingHorizontal: 20,
            backgroundColor: palette.background,
          }}
        >
          <Action
            title="Close task details"
            variant="quiet"
            compact
            disabled={locked}
            onPress={onClose}
          />
        </View>
        <ScrollView
          contentContainerStyle={[
            layout.modalContent,
            {
              paddingTop: embedded ? 16 : 24,
              paddingBottom: insets.bottom + 24,
              maxWidth: wide ? 1000 : undefined,
              width: '100%',
              alignSelf: 'center',
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Heading eyebrow={current.phase}>{current.content.title}</Heading>
          <View style={{ display: editing ? 'none' : 'flex', gap: 18 }}>
            {!!stepState.nextStep && <Body>Next required step: {stepState.nextStep}</Body>}
            {!!current.content.description && <Body>{current.content.description}</Body>}
            {!!current.content.notes && <Body>{current.content.notes}</Body>}
            {!current.deletedAt &&
              !current.archivedAt &&
              current.phase !== 'completed' &&
              (current.phase === 'planned' ||
                current.paused ||
                (current.finalReviewRequired && !current.finalReviewSatisfied) ||
                stepState.canComplete) && (
                <>
                  <Action
                    title={
                      current.phase === 'planned'
                        ? 'Release to Next'
                        : current.paused
                          ? 'Continue work'
                          : current.finalReviewRequired && !current.finalReviewSatisfied
                            ? 'Confirm final review'
                            : 'Complete task'
                    }
                    disabled={
                      locked ||
                      (current.phase !== 'planned' &&
                        !current.paused &&
                        !(current.finalReviewRequired && !current.finalReviewSatisfied) &&
                        !stepState.canComplete)
                    }
                    onPress={() =>
                      current.phase === 'planned'
                        ? void act('task.move', { phase: 'next', beforeTaskId: null })
                        : current.paused
                          ? void act('task.pause', { paused: false })
                          : current.finalReviewRequired && !current.finalReviewSatisfied
                            ? void act('task.review', { required: true, satisfied: true })
                            : void act('task.complete')
                    }
                  />
                  {current.phase === 'planned' && stepState.hasAgent && (
                    <Body>
                      Releasing allows eligible agent steps to start. Human steps wait for you.
                    </Body>
                  )}
                </>
              )}
          </View>
          <Action
            title={editing ? 'Done editing' : 'Edit task'}
            variant="quiet"
            onPress={() => setEditing(!editing)}
          />
          {navigationRequested && (
            <Card>
              <Heading>Open the requested work</Heading>
              <Body>
                Save changes first, or keep this draft while opening the requested work. Resolve any
                uncertain save before switching.
              </Body>
              <Action title="Keep editing" secondary onPress={onKeepEditing} />
              <Action
                title="Keep draft and continue"
                disabled={locked}
                onPress={onContinueNavigation}
              />
            </Card>
          )}
          <View style={{ display: editing ? 'flex' : 'none', gap: 18 }}>
            <Field label="Title" value={title} onChangeText={setTitle} editable={!locked} />
            <Field
              label="Description"
              value={description}
              onChangeText={setDescription}
              multiline
              editable={!locked}
            />
            <Field
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              editable={!locked}
            />
            <Action
              title={reviewing ? 'Save reviewed task' : 'Save task'}
              disabled={!title.trim() || locked || !!current.archivedAt || !!current.deletedAt}
              busy={command.busy}
              onPress={() =>
                void act('task.edit', { content: { title: title.trim(), description, notes } })
              }
            />
          </View>
          {!!command.error && <Body error>{command.error}</Body>}
          {command.pending && (
            <Action
              title="Retry unchanged request"
              busy={command.busy}
              onPress={() => void act('task.edit')}
            />
          )}
          <Disclosure title="Options">
            <View style={{ gap: 18 }}>
              <Choice
                label="Task board"
                value={organization.boardId ?? 'none'}
                disabled={locked}
                onChange={(boardId) =>
                  setOrganization({
                    ...organization,
                    boardId: boardId === 'none' ? null : boardId,
                    columnId: null,
                  })
                }
                options={[
                  { value: 'none', label: 'No board' },
                  ...boards.map((b) => ({ value: b.id, label: b.content.name })),
                ]}
              />
              {organization.boardId && (
                <Choice
                  label="Task column"
                  value={organization.columnId ?? 'none'}
                  disabled={locked}
                  onChange={(columnId) =>
                    setOrganization({
                      ...organization,
                      columnId: columnId === 'none' ? null : columnId,
                    })
                  }
                  options={[
                    { value: 'none', label: 'No column' },
                    ...(boards.find((b) => b.id === organization.boardId)?.content.columns ?? [])
                      .filter((c) => c.phase === current.phase)
                      .map((c) => ({ value: c.id, label: `${c.name} (${c.phase})` })),
                  ]}
                />
              )}
              <Body>
                Only columns matching the current phase are offered. Release to Next deliberately
                before placing work in a Next column.
              </Body>
              <Choice
                label="Task project"
                value={organization.projectId ?? 'none'}
                disabled={locked}
                onChange={(projectId) =>
                  setOrganization({
                    ...organization,
                    projectId: projectId === 'none' ? null : projectId,
                  })
                }
                options={[
                  { value: 'none', label: 'No project' },
                  ...projects.map((p) => ({ value: p.id, label: p.content.name })),
                ]}
              />
              <Field
                label="Tags (comma separated)"
                value={tags}
                onChangeText={setTags}
                editable={!locked}
              />
              <Choice
                label="Priority"
                value={organization.priority}
                disabled={locked}
                onChange={(priority) => setOrganization({ ...organization, priority })}
                options={['none', 'low', 'normal', 'high', 'urgent'].map((value) => ({
                  value: value as Task['organization']['priority'],
                  label: value,
                }))}
              />
              <Action
                title="Save organization"
                disabled={locked}
                onPress={() =>
                  void act('task.organize', {
                    organization: {
                      ...organization,
                      tags: tags
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
              <DateFields label="Due" value={due} onChange={setDue} zone={zone} disabled={locked} />
              <DateFields
                label="Scheduled"
                value={scheduled}
                onChange={setScheduled}
                zone={zone}
                disabled={locked}
              />
              <Action
                title="Save dates"
                disabled={locked}
                onPress={() => {
                  try {
                    void act('task.schedule', {
                      dueAt: localInstant(due.date, due.time, zone),
                      scheduledAt: localInstant(scheduled.date, scheduled.time, zone),
                    });
                  } catch (error) {
                    command.setError(messageOf(error));
                  }
                }}
              />
            </View>
          </Disclosure>
          {(stepState.hasAgent || agentManagement) && (
            <AgentWorkflow
              client={client}
              taskId={current.id}
              configurationInitiallyOpen={agentManagement}
              onBlockedChange={setWorkflowBlocked}
              onChanged={() => {
                void client
                  .request(`/api/tasks/${current.id}`)
                  .then((value) => {
                    setCurrent(TaskResponseSchema.parse(value).task);
                    onSaved();
                    void loadHistory();
                  })
                  .catch((error) => command.setError(messageOf(error)));
              }}
            />
          )}
          <Steps
            task={current}
            client={client}
            onStepState={setStepState}
            blocked={command.busy || command.pending || workflowBlocked}
            onBlockedChange={setStepsBlocked}
            onTask={(updated) => {
              setCurrent(updated);
              onSaved();
            }}
          />
          <Disclosure title="More task options">
            {!stepState.hasAgent && (
              <>
                <Action
                  title={agentManagement ? 'Hide agent management' : 'Manage agent work'}
                  variant="quiet"
                  disabled={workflowBlocked}
                  onPress={() => setAgentManagement(!agentManagement)}
                />
              </>
            )}

            {!command.pending && (
              <Action
                title="Review latest saved task"
                secondary
                disabled={command.busy}
                onPress={() => void reviewLatest()}
              />
            )}
            {reviewing && (
              <Card>
                <Body>Latest saved title: {current.content.title}</Body>
                <Body>Latest saved description: {current.content.description || 'None'}</Body>
                <Body>Latest saved notes: {current.content.notes || 'None'}</Body>
                <Body>
                  Latest saved board:{' '}
                  {boards.find((b) => b.id === current.organization.boardId)?.content.name ??
                    'None'}
                  ; project:{' '}
                  {projects.find((p) => p.id === current.organization.projectId)?.content.name ??
                    'None'}
                  ; tags: {current.organization.tags.join(', ') || 'None'}; priority:{' '}
                  {current.organization.priority}
                </Body>
                <Body>
                  Latest due: {current.schedule.dueAt ?? 'None'}; scheduled:{' '}
                  {current.schedule.scheduledAt ?? 'None'}
                </Body>
                <Body>
                  Your edits above are retained. Saving replaces this content with your edits.
                </Body>
              </Card>
            )}
            {!command.pending && (
              <>
                {!current.deletedAt && !current.archivedAt && current.phase !== 'completed' && (
                  <>
                    <Action
                      title={current.paused ? 'Resume released work' : 'Pause work'}
                      secondary
                      disabled={locked}
                      onPress={() => void act('task.pause', { paused: !current.paused })}
                    />
                    <Choice
                      label="Move to phase"
                      value={current.phase}
                      options={
                        current.phase === 'planned'
                          ? phases.filter((p) => p.value === 'planned')
                          : phases
                      }
                      disabled={locked}
                      onChange={(phase) => void act('task.move', { phase, beforeTaskId: null })}
                    />
                  </>
                )}
                {current.phase === 'completed' && !current.deletedAt && !current.archivedAt && (
                  <Action
                    title="Reopen in Planned"
                    secondary
                    busy={command.busy}
                    onPress={() => void act('task.reopen', { phase: 'planned' })}
                  />
                )}
                {!current.deletedAt && (
                  <Action
                    title={current.archivedAt ? 'Unarchive task' : 'Archive task'}
                    secondary
                    busy={command.busy}
                    onPress={() => void act(current.archivedAt ? 'task.unarchive' : 'task.archive')}
                  />
                )}
                {current.deletedAt ? (
                  <Action
                    title="Undo deletion"
                    secondary
                    busy={command.busy}
                    onPress={() => void act('task.restore')}
                  />
                ) : (
                  <Action
                    title="Delete task"
                    secondary
                    busy={command.busy}
                    onPress={() =>
                      Alert.alert(
                        'Delete this task?',
                        'Its history is retained. You can undo deletion here.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => void act('task.delete'),
                          },
                        ],
                      )
                    }
                  />
                )}
              </>
            )}

            <Choice
              label="Final review"
              value={current.finalReviewRequired ? 'required' : 'none'}
              disabled={locked}
              options={[
                { value: 'none', label: 'No final review' },
                { value: 'required', label: 'Require final review' },
              ]}
              onChange={(value) =>
                void act('task.review', { required: value === 'required', satisfied: false })
              }
            />
            {current.finalReviewRequired && current.finalReviewSatisfied && (
              <Action
                title={
                  current.finalReviewSatisfied ? 'Reopen final review' : 'Confirm final review'
                }
                disabled={locked}
                onPress={() =>
                  void act('task.review', {
                    required: true,
                    satisfied: !current.finalReviewSatisfied,
                  })
                }
              />
            )}
            {current.schedule.seriesId && (
              <Recurrence
                client={client}
                zone={zone}
                occurrence={current}
                onSaved={() => {
                  void reviewLatest();
                  onSaved();
                }}
              />
            )}
            <Heading>History</Heading>
            {history.length ? (
              history.map((entry, index) => <Body key={index}>{entry}</Body>)
            ) : (
              <Body>No history loaded yet.</Body>
            )}
            {historyCursor && (
              <Action
                title="Load older history"
                secondary
                onPress={() => void loadHistory(historyCursor)}
              />
            )}
          </Disclosure>
        </ScrollView>
      </KeyboardAvoidingView>
    </DetailContainer>
  );
}
const layout = StyleSheet.create({
  stack: { gap: 18 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  modal: { flex: 1 },
  modalContent: { padding: 24, paddingTop: 60, paddingBottom: 60, gap: 18 },
});
