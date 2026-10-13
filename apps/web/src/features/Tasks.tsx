import { useEffect, useRef, useState } from 'react';
import {
  TaskListResponseSchema,
  TaskCommandResponseSchema,
  TaskHistoryResponseSchema,
  TaskResponseSchema,
  type Task,
  type TaskCommand,
  type Preferences,
  type Board,
  type Project,
} from '@mems-life/domain';
import { request, RequestError } from '../api';
import './feature-styles.css';
import './productivity.css';
import { z } from 'zod';
import { AgentWorkflow } from './AgentWorkflow';
import { BoardsResponse, ProjectsResponse, Configuration, TaskProductivity } from './Productivity';

const phases = ['planned', 'next', 'active'] as const;
const phaseNames = { planned: 'Planned', next: 'Next', active: 'Active', completed: 'Completed' };
type View = 'open' | 'completed' | 'archived';
type Draft = { title: string; description: string; notes: string };

export function Tasks({
  preferences,
  focusTarget,
}: {
  preferences?: Preferences;
  focusTarget?: { kind?: 'task' | 'session' | 'food'; id?: string; action?: 'create' | 'capture' };
} = {}) {
  const [navigationRequest, setNavigationRequest] = useState<{
    id?: string;
    action?: 'create' | 'capture';
  } | null>(null);
  const seenFocus = useRef<object | undefined>(undefined);
  const [workflowBlocked, setWorkflowBlocked] = useState(false);
  const timeZone = preferences?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [boards, setBoards] = useState<Board[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [configuration, setConfiguration] = useState(false);
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    boardId: '',
    projectId: '',
    tag: '',
    priority: '',
    timing: '',
    responsibility: '',
  });
  const [applied, setApplied] = useState(filters);
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const dragTask = useRef<string | null>(null);
  const QueryResponse = z.object({
    tasks: z.array(TaskListResponseSchema.shape.tasks.element),
    nextCursor: z.string().nullable(),
  });
  const queryUrl = (currentView: View, cursor = '0') => {
    const query = new URLSearchParams({ view: currentView, limit: '100', cursor });
    Object.entries(appliedRef.current).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return `/api/tasks/query?${query}`;
  };
  const loadConfiguration = async () => {
    const [b, p] = await Promise.all([
      request('/api/boards', BoardsResponse),
      request('/api/projects', ProjectsResponse),
    ]);
    setBoards(b.boards);
    setProjects(p.projects);
  };
  useEffect(() => {
    void loadConfiguration().catch((error) => setNotice(error.message));
  }, []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<View>('open');
  const viewRef = useRef(view);
  viewRef.current = view;
  const [phase, setPhase] = useState<(typeof phases)[number]>('planned');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [latest, setLatest] = useState<Task | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [productivityBusy, setProductivityBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [undo, setUndo] = useState<TaskCommand | null>(null);
  const pending = useRef<TaskCommand | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedId = useRef<string | null>(null);
  const reload = async (currentView = viewRef.current) => {
    const result = await request(queryUrl(currentView), QueryResponse);
    if (viewRef.current === currentView) {
      setTasks(result.tasks);
      setNextCursor(result.nextCursor);
      setFailed(false);
    }
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    request(queryUrl(view), QueryResponse)
      .then((result) => {
        if (active) {
          setTasks(result.tasks);
          setNextCursor(result.nextCursor);
          setFailed(false);
        }
      })
      .catch((error) => {
        if (active) {
          setNotice(error.message);
          setFailed(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view, applied]);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  const close = () => {
    if (workflowBlocked) {
      setNotice('Resolve the pending agent or file change before closing this task.');
      return;
    }
    if (productivityBusy) return;
    dialog.current?.close();
    selectedId.current = null;
    setSelected(null);
    setDraft(null);
    setLatest(null);
    setHistory([]);
  };
  const execute = async (command: TaskCommand, retry = false) => {
    if (busy || productivityBusy || (pending.current && !retry)) return;
    pending.current = command;
    setBusy(true);
    setNotice('');
    try {
      const result = await request('/api/tasks/commands', TaskCommandResponseSchema, {
        method: 'POST',
        body: JSON.stringify(command),
      });
      pending.current = null;
      const task = result.task;
      if (command.type === 'task.create') setTitle('');
      if (['task.archive', 'task.delete', 'task.complete'].includes(command.type)) {
        const type =
          command.type === 'task.archive'
            ? 'task.unarchive'
            : command.type === 'task.delete'
              ? 'task.restore'
              : 'task.reopen';
        setUndo({
          type,
          operationId: crypto.randomUUID(),
          taskId: task.id,
          expectedRevision: task.revision,
          ...(type === 'task.reopen'
            ? {
                phase:
                  command.type === 'task.complete'
                    ? tasks.find((item) => item.id === task.id)?.phase === 'completed'
                      ? 'planned'
                      : (tasks.find((item) => item.id === task.id)?.phase ?? 'planned')
                    : 'planned',
              }
            : {}),
        } as TaskCommand);
      } else setUndo(null);
      if (selectedId.current === task.id) {
        setSelected(task);
        setDraft(task.content);
      }
      await reload();
      if (selectedId.current === task.id) await loadHistory(task.id);
      setNotice('Saved.');
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        pending.current = null;
        try {
          const results = await Promise.all(
            (['open', 'completed', 'archived'] as const).map((value) =>
              request(`/api/tasks?view=${value}`, TaskListResponseSchema),
            ),
          );
          const current = results
            .flatMap((value) => value.tasks)
            .find((item) => item.id === command.taskId);
          if (current) {
            setLatest(current);
            if (!selected) {
              selectedId.current = current.id;
              setSelected(current);
              setDraft(current.content);
            }
          }
          setNotice(
            'This task changed elsewhere. Review the saved version before making another change.',
          );
        } catch {
          setNotice('This task changed elsewhere. Reload the board to review its latest version.');
        }
      } else {
        if (error instanceof RequestError && error.status >= 400 && error.status < 500)
          pending.current = null;
        setNotice(error instanceof Error ? error.message : 'The change could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  };
  const action = (task: Task, type: TaskCommand['type'], extra: object = {}) =>
    void execute({
      type,
      operationId: crypto.randomUUID(),
      taskId: task.id,
      expectedRevision: task.revision,
      ...extra,
    } as TaskCommand);
  const loadHistory = async (id: string) => {
    const result = await request(`/api/tasks/${id}/history`, TaskHistoryResponseSchema);
    if (selectedId.current === id)
      setHistory(
        result.events.map(
          (event) =>
            `${event.type.replace('task.', '')} · ${event.actorType} · ${new Date(event.createdAt).toLocaleString(undefined, { timeZone })}`,
        ),
      );
  };
  const show = async (task: Task) => {
    selectedId.current = task.id;
    setSelected(task);
    setDraft(task.content);
    setLatest(null);
    setHistory([]);
    try {
      const current = await request(`/api/tasks/${task.id}`, TaskResponseSchema);
      if (selectedId.current === task.id) {
        if (current.task.revision !== task.revision) setLatest(current.task);
        else setSelected(current.task);
      }
      await loadHistory(task.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'History could not be loaded.');
    }
  };
  async function openFocus(target: { id?: string; action?: 'create' | 'capture' }) {
    if (workflowBlocked || pending.current || busy) return;
    setNavigationRequest(null);
    close();
    if (target.action === 'create') {
      setView('open');
      document.getElementById('capture-title')?.focus();
      return;
    }
    if (!target.id || !z.uuid().safeParse(target.id).success) return;
    try {
      const { task } = await request(
        `/api/tasks/${target.id}`,
        z.object({ task: TaskListResponseSchema.shape.tasks.element }),
      );
      await show(task);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This task could not be opened.');
    }
  }
  useEffect(() => {
    if (!focusTarget || ('kind' in focusTarget && focusTarget.kind && focusTarget.kind !== 'task'))
      return;
    if (seenFocus.current === focusTarget) return;
    seenFocus.current = focusTarget;
    if (focusTarget.id && selected?.id === focusTarget.id) return;
    if (selected || pending.current || busy || workflowBlocked) {
      setNavigationRequest(focusTarget);
      return;
    }
    void openFocus(focusTarget);
  }, [focusTarget]);
  const cards = (items: Task[]) =>
    items.length ? (
      items.map((task) => (
        <article
          className="task-card"
          key={task.id}
          draggable={view === 'open' && !busy && !pending.current}
          onDragStart={(event) => {
            dragTask.current = task.id;
            event.dataTransfer.setData('text/plain', task.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => {
            dragTask.current = null;
          }}
          onDragOver={(event) => {
            if (dragTask.current && dragTask.current !== task.id) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const moving = tasks.find((item) => item.id === dragTask.current);
            dragTask.current = null;
            if (moving && moving.id !== task.id)
              action(moving, 'task.move', { phase: task.phase, beforeTaskId: task.id });
          }}
        >
          <button
            className="task-title"
            disabled={busy || productivityBusy || workflowBlocked || !!pending.current}
            onClick={() => void show(task)}
          >
            {task.content.title}
          </button>
          {task.content.description && <p>{task.content.description}</p>}
          <div className="task-metadata">
            {task.organization.priority !== 'none' && (
              <span className="task-badge">{task.organization.priority}</span>
            )}
            {task.organization.tags.map((tag) => (
              <span className="task-badge" key={tag}>
                #{tag}
              </span>
            ))}
            {task.paused && <span className="task-badge">Paused</span>}
            {task.schedule.dueAt && (
              <span
                className={
                  Date.parse(task.schedule.dueAt) < Date.now() && task.phase !== 'completed'
                    ? 'task-overdue'
                    : ''
                }
              >
                Due{' '}
                {new Date(task.schedule.dueAt).toLocaleString(undefined, {
                  timeZone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            )}
            {task.schedule.seriesId && <span className="task-badge">Repeats</span>}
          </div>
          <div className="card-actions">
            {task.archivedAt ? (
              <button
                className="secondary"
                disabled={busy || productivityBusy || workflowBlocked || !!pending.current}
                onClick={() => action(task, 'task.unarchive')}
              >
                Unarchive
              </button>
            ) : task.phase === 'completed' ? (
              <button
                className="secondary"
                disabled={busy || productivityBusy || workflowBlocked || !!pending.current}
                onClick={() => action(task, 'task.reopen', { phase: 'planned' })}
              >
                Reopen
              </button>
            ) : (
              <>
                <label className="sr-only" htmlFor={`phase-${task.id}`}>
                  Move {task.content.title}
                </label>
                <select
                  id={`phase-${task.id}`}
                  aria-label={`Move ${task.content.title}`}
                  disabled={busy || productivityBusy || workflowBlocked || !!pending.current}
                  value={task.phase}
                  onChange={(event) =>
                    action(task, 'task.move', { phase: event.target.value, beforeTaskId: null })
                  }
                >
                  {phases
                    .filter((value) => task.phase !== 'planned' || value !== 'active')
                    .map((value) => (
                      <option value={value} key={value}>
                        {value === 'next' ? 'Release to Next' : phaseNames[value]}
                      </option>
                    ))}
                </select>
                <button
                  className="secondary"
                  disabled={busy || productivityBusy || workflowBlocked || !!pending.current}
                  onClick={() => action(task, 'task.complete')}
                >
                  Complete
                </button>
                {items.indexOf(task) > 0 && (
                  <button
                    className="secondary"
                    disabled={busy || productivityBusy || workflowBlocked || !!pending.current}
                    onClick={() =>
                      action(task, 'task.move', {
                        phase: task.phase,
                        beforeTaskId: items[items.indexOf(task) - 1]!.id,
                      })
                    }
                  >
                    Move up
                  </button>
                )}
              </>
            )}
          </div>
        </article>
      ))
    ) : (
      <p className="column-empty">Nothing here yet.</p>
    );
  return (
    <section className="feature-area">
      <div className="intro">
        <h2>Make space for the work ahead.</h2>
        <p>Capture a thought in Planned. Choose Next when you are ready to work on it.</p>
      </div>
      <form
        className="quick-capture"
        onSubmit={(event) => {
          event.preventDefault();
          void execute({
            type: 'task.create',
            operationId: crypto.randomUUID(),
            taskId: crypto.randomUUID(),
            expectedRevision: 0,
            content: { title: title.trim(), description: '', notes: '' },
          });
        }}
      >
        <label className="sr-only" htmlFor="capture-title">
          New task
        </label>
        <input
          id="capture-title"
          placeholder="What would you like to do?"
          required
          maxLength={300}
          value={title}
          disabled={busy || productivityBusy || workflowBlocked || !!pending.current}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          disabled={
            busy || productivityBusy || workflowBlocked || !!pending.current || !title.trim()
          }
        >
          Add to Planned
        </button>
      </form>
      <div className="feature-toolbar" aria-label="Task views">
        {(['open', 'completed', 'archived'] as const).map((value) => (
          <button
            className={view === value ? '' : 'secondary'}
            aria-pressed={view === value}
            key={value}
            onClick={() => setView(value)}
          >
            {value === 'open' ? 'Board' : value === 'completed' ? 'Completed' : 'Archive'}
          </button>
        ))}
      </div>
      <form
        className="productivity-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...filters });
        }}
      >
        <label>
          Search tasks
          <input
            type="search"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Title, description or notes"
          />
        </label>
        <label>
          Board filter
          <select
            value={filters.boardId}
            onChange={(event) => {
              const next = { ...filters, boardId: event.target.value };
              setFilters(next);
              setApplied(next);
            }}
          >
            <option value="">All boards</option>
            {boards.map((board) => (
              <option value={board.id} key={board.id}>
                {board.content.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project filter
          <select
            value={filters.projectId}
            onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.content.name}
              </option>
            ))}
          </select>
        </label>
        <button>Find tasks</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const empty = {
              search: '',
              boardId: '',
              projectId: '',
              tag: '',
              priority: '',
              timing: '',
              responsibility: '',
            };
            setFilters(empty);
            setApplied(empty);
          }}
        >
          Clear filters
        </button>
        <details>
          <summary>More filters</summary>
          <div className="productivity-grid">
            <label>
              Tag filter
              <input
                value={filters.tag}
                onChange={(event) => setFilters({ ...filters, tag: event.target.value })}
              />
            </label>
            <label>
              Priority filter
              <select
                value={filters.priority}
                onChange={(event) => setFilters({ ...filters, priority: event.target.value })}
              >
                <option value="">All priorities</option>
                {['none', 'low', 'normal', 'high', 'urgent'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Dates filter
              <select
                value={filters.timing}
                onChange={(event) => setFilters({ ...filters, timing: event.target.value })}
              >
                <option value="">Any date</option>
                <option value="upcoming">Upcoming</option>
                <option value="overdue">Overdue</option>
              </select>
            </label>
            <label>
              Responsibility filter
              <select
                value={filters.responsibility}
                onChange={(event) => setFilters({ ...filters, responsibility: event.target.value })}
              >
                <option value="">Everyone</option>
                <option value="human">Human work</option>
                <option value="agent">Agent work</option>
                <option value="either">Either</option>
              </select>
            </label>
          </div>
        </details>
        <button
          type="button"
          className="secondary"
          disabled={configurationBusy}
          onClick={() => setConfiguration(!configuration)}
        >
          Configure boards & projects
        </button>
      </form>
      {configuration && (
        <Configuration
          boards={boards}
          projects={projects}
          refresh={loadConfiguration}
          onBusyChange={setConfigurationBusy}
          onClose={() => setConfiguration(false)}
        />
      )}
      {notice && (
        <div className="notice feature-notice" role="status">
          <p>{notice}</p>
          {pending.current && (
            <button
              disabled={busy}
              onClick={() => pending.current && void execute(pending.current, true)}
            >
              Retry the same change
            </button>
          )}
          {undo && !pending.current && (
            <button className="secondary" disabled={busy} onClick={() => void execute(undo)}>
              Undo
            </button>
          )}
        </div>
      )}
      {loading ? (
        <p role="status">Opening your tasks…</p>
      ) : failed ? (
        <button onClick={() => void reload().catch((error) => setNotice(error.message))}>
          Reload board
        </button>
      ) : view === 'open' ? (
        <>
          <div className="phase-tabs" aria-label="Visible phase">
            {phases.map((value) => (
              <button
                className={phase === value ? '' : 'secondary'}
                aria-pressed={phase === value}
                onClick={() => setPhase(value)}
                key={value}
              >
                {phaseNames[value]}
              </button>
            ))}
          </div>
          <div className="task-board">
            {(
              boards.find((board) => board.id === applied.boardId)?.content.columns ??
              phases.map((value) => ({ id: value, name: phaseNames[value], phase: value }))
            ).map((column) => (
              <section
                className={`task-column ${phase === column.phase ? 'selected-phase' : ''}`}
                key={column.id}
                aria-label={`${column.name} tasks`}
              >
                <h3>
                  {column.name}
                  <span>
                    {
                      tasks.filter(
                        (task) =>
                          task.phase === column.phase &&
                          (!applied.boardId || task.organization.columnId === column.id),
                      ).length
                    }
                  </span>
                </h3>
                <p className="column-phase">
                  {phaseNames[column.phase]}
                  {column.phase === 'planned'
                    ? ' · dormant'
                    : column.phase === 'next'
                      ? ' · released'
                      : ''}
                </p>
                {cards(
                  tasks
                    .filter(
                      (task) =>
                        task.phase === column.phase &&
                        (!applied.boardId || task.organization.columnId === column.id),
                    )
                    .sort((a, b) => a.order - b.order),
                )}
              </section>
            ))}
          </div>
          <p className="feature-footnote">
            Next is a deliberate choice to start. Moving a task there does not launch an agent in
            this build.
          </p>
        </>
      ) : (
        <div className="task-history-list">{cards(tasks)}</div>
      )}
      {nextCursor && (
        <button
          className="secondary"
          onClick={() =>
            void request(queryUrl(view, nextCursor), QueryResponse)
              .then((result) => {
                setTasks((current) => [
                  ...current,
                  ...result.tasks.filter((task) => !current.some((item) => item.id === task.id)),
                ]);
                setNextCursor(result.nextCursor);
              })
              .catch((error) => setNotice(error.message))
          }
        >
          Load more tasks
        </button>
      )}
      <dialog
        ref={dialog}
        className="feature-dialog"
        onCancel={(event) => {
          if (productivityBusy) event.preventDefault();
          else close();
        }}
        onClose={() => {
          if (!dialog.current?.open) close();
        }}
        aria-labelledby="task-detail-title"
      >
        {selected && draft && (
          <>
            <div className="detail-heading">
              <h2 id="task-detail-title">Task details</h2>
              <button className="secondary" disabled={productivityBusy} onClick={close}>
                Close
              </button>
            </div>
            <div>
              {notice && (
                <p className="notice feature-notice" role="status">
                  {notice}
                </p>
              )}
              {pending.current && (
                <button
                  disabled={busy}
                  onClick={() => pending.current && void execute(pending.current, true)}
                >
                  Retry the same change
                </button>
              )}
            </div>
            {navigationRequest && (
              <section className="revision-review">
                <h3>Open the requested work</h3>
                <p>
                  Save changes in this task first, or discard its unsaved draft before switching. A
                  save with an uncertain response must be resolved first.
                </p>
                <button className="secondary" onClick={() => setNavigationRequest(null)}>
                  Keep editing
                </button>
                <button
                  disabled={
                    busy ||
                    productivityBusy ||
                    workflowBlocked ||
                    !!pending.current ||
                    workflowBlocked
                  }
                  onClick={() => void openFocus(navigationRequest)}
                >
                  Discard this draft and continue
                </button>
              </section>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                action(selected, 'task.edit', { content: draft });
              }}
            >
              <fieldset disabled={busy || productivityBusy || workflowBlocked || !!pending.current}>
                <label>
                  Title
                  <input
                    autoFocus
                    value={draft.title}
                    required
                    maxLength={300}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    maxLength={20000}
                    aria-label="Description"
                    rows={3}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    maxLength={20000}
                    aria-label="Notes"
                    rows={4}
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  />
                </label>
                <button disabled={!!latest || !!selected.archivedAt || !draft.title.trim()}>
                  Save task
                </button>
              </fieldset>
            </form>
            <TaskProductivity
              key={selected.id}
              task={selected}
              boards={boards}
              projects={projects}
              timeZone={timeZone}
              blocked={busy || productivityBusy || workflowBlocked || !!pending.current || !!latest}
              action={action}
              refresh={reload}
              onBusyChange={setProductivityBusy}
              onTask={(task) => {
                setSelected(task);
                void loadHistory(task.id).catch((error) => setNotice(error.message));
              }}
            />
            <AgentWorkflow
              taskId={selected.id}
              onBlockedChange={setWorkflowBlocked}
              onChanged={() => {
                void request(
                  `/api/tasks/${selected.id}`,
                  z.object({ task: TaskListResponseSchema.shape.tasks.element }),
                )
                  .then(({ task }) => {
                    setSelected(task);
                    void reload();
                    void loadHistory(task.id);
                  })
                  .catch((error) => setNotice(error.message));
              }}
            />
            {latest && (
              <section className="revision-review">
                <h3>Review the saved task</h3>
                <p>
                  Your edits are still in the form. Saved revision {latest.revision} has the
                  following content.
                </p>
                <dl>
                  <dt>Title</dt>
                  <dd>{latest.content.title}</dd>
                  <dt>Description</dt>
                  <dd>{latest.content.description || 'None'}</dd>
                  <dt>Notes</dt>
                  <dd>{latest.content.notes || 'None'}</dd>
                </dl>
                <div className="review-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelected(latest);
                      setDraft(latest.content);
                      setLatest(null);
                    }}
                  >
                    Use saved version
                  </button>
                  <button
                    onClick={() => {
                      setSelected(latest);
                      setLatest(null);
                    }}
                  >
                    Keep my reviewed edits
                  </button>
                </div>
              </section>
            )}
            <div className="detail-actions">
              <button
                className="secondary"
                disabled={
                  busy || productivityBusy || workflowBlocked || !!pending.current || !!latest
                }
                onClick={() =>
                  action(selected, selected.archivedAt ? 'task.unarchive' : 'task.archive')
                }
              >
                {selected.archivedAt ? 'Unarchive' : 'Archive'}
              </button>
              <button
                className="secondary"
                disabled={
                  busy || productivityBusy || workflowBlocked || !!pending.current || !!latest
                }
                onClick={() => {
                  action(selected, 'task.delete');
                  close();
                }}
              >
                Delete task
              </button>
            </div>
            <details className="history-drawer">
              <summary>Change history</summary>
              {history.length ? (
                <ol>
                  {history.map((event, index) => (
                    <li key={index}>{event}</li>
                  ))}
                </ol>
              ) : (
                <p>No history loaded.</p>
              )}
            </details>
          </>
        )}
      </dialog>
    </section>
  );
}
