import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  BoardSchema,
  ProjectSchema,
  RecurrenceSeriesSchema,
  TaskSchema,
  TaskStepSchema,
  type Board,
  type Project,
  type RecurrenceSeries,
  type Task,
  type TaskCommand,
  type TaskStep,
  type RecurrenceRule,
} from '@mems-life/domain';
import { request, RequestError } from '../api';

export const BoardsResponse = z.object({ boards: z.array(BoardSchema) });
export const ProjectsResponse = z.object({ projects: z.array(ProjectSchema) });
export const SeriesResponse = z.object({ series: z.array(RecurrenceSeriesSchema) });
const StepsResponse = z.object({
  task: TaskSchema,
  entries: z.array(
    z.object({ step: TaskStepSchema, ready: z.boolean(), waitingReason: z.string().nullable() }),
  ),
  nextActions: z.array(z.string()),
  canComplete: z.boolean(),
});
const CommandResponse = z.object({ operationId: z.string(), task: TaskSchema.optional() });
type WireCommand = { type: string; operationId: string; [key: string]: unknown };

// An ambiguous network result keeps the original operation ID and exact payload.
function useCommand(refresh: () => Promise<void>) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<unknown>(null);
  const pending = useRef<{ path: string; command: WireCommand } | null>(null);
  const send = async (path: string, command: WireCommand, retry = false): Promise<boolean> => {
    if (busy || review !== null || (pending.current && !retry)) return false;
    pending.current = { path, command };
    setBusy(true);
    setMessage('');
    setReview(null);
    try {
      await request(path, CommandResponse, { method: 'POST', body: JSON.stringify(command) });
      pending.current = null;
      await refresh();
      setMessage('Saved.');
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.status >= 400 && error.status < 500) {
        pending.current = null;
        if (error.status === 409) {
          try {
            const endpoint = path.replace('/commands', '');
            const snapshot = await request(
              endpoint.includes('/steps')
                ? `/api/tasks/${command.taskId}/steps`
                : endpoint.includes('/tasks')
                  ? '/api/tasks/query?view=all'
                  : endpoint,
              z.unknown(),
            );
            setReview(snapshot);
          } catch {
            setReview('Saved values could not be loaded. Reload before changing the revision.');
          }
        }
      }
      setMessage(error instanceof Error ? error.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    send,
    busy,
    blocked: busy || !!pending.current || review !== null,
    feedback: (
      <>
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        {pending.current && (
          <button
            disabled={busy}
            onClick={() => {
              const saved = pending.current;
              if (saved) void send(saved.path, saved.command, true);
            }}
          >
            Retry the same change
          </button>
        )}
        {review !== null && (
          <details className="revision-review" open>
            <summary>Review current saved values</summary>
            <p>
              Your form is preserved. Review the saved values before using their current revision.
            </p>
            <pre>{JSON.stringify(review, null, 2)}</pre>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await refresh();
                  setReview(null);
                  setMessage(
                    'Saved values reviewed. Your edits are ready to save against the current revision.',
                  );
                } catch (error) {
                  setMessage((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              I reviewed the saved values; keep my edits
            </button>
          </details>
        )}
      </>
    ),
  };
}
export function localDateTime(instant: string | null, zone: string) {
  if (!instant) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function dateTimeInstant(value: string, zone: string) {
  if (!value) return null;
  const wall = Date.parse(`${value}:00Z`);
  let candidate = wall;
  for (let i = 0; i < 4; i++) {
    const rendered = localDateTime(new Date(candidate).toISOString(), zone);
    const delta = wall - Date.parse(`${rendered}:00Z`);
    candidate += delta;
    if (!delta) break;
  }
  if (localDateTime(new Date(candidate).toISOString(), zone) !== value)
    throw new Error(
      'This time falls in a daylight-saving clock change. Choose a valid local time.',
    );
  return new Date(candidate).toISOString();
}
export function Configuration({
  boards,
  projects,
  refresh,
  onClose,
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
  boards: Board[];
  projects: Project[];
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'board' | 'project'>('board');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const initialColumns = () =>
    ['planned', 'next', 'active'].map((phase) => ({
      id: crypto.randomUUID(),
      name: phase[0]!.toUpperCase() + phase.slice(1),
      phase: phase as 'planned' | 'next' | 'active',
    }));
  const [columns, setColumns] = useState<Board['content']['columns']>(initialColumns);
  const command = useCommand(refresh);
  useEffect(() => {
    onBusyChange(command.blocked);
    return () => onBusyChange(false);
  }, [command.blocked, onBusyChange]);
  const choose = (value: string) => {
    setId(value);
    const record = (kind === 'board' ? boards : projects).find((r) => r.id === value);
    setName(record?.content.name ?? '');
    setDescription(record && 'description' in record.content ? record.content.description : '');
    setColumns(record && 'columns' in record.content ? record.content.columns : initialColumns());
  };
  return (
    <div className="configuration-panel">
      <div className="detail-heading">
        <h3>Boards & projects</h3>
        <button className="secondary" disabled={command.blocked} onClick={onClose}>
          Close configuration
        </button>
      </div>
      <p>Column names describe your workflow. Each column keeps an explicit lifecycle phase.</p>
      {command.feedback}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const record = (kind === 'board' ? boards : projects).find((r) => r.id === id);
          const savedId = id || crypto.randomUUID();
          if (
            await command.send(`/api/${kind}s/commands`, {
              type: `${kind}.${id ? 'edit' : 'create'}`,
              operationId: crypto.randomUUID(),
              id: savedId,
              expectedRevision: record?.revision ?? 0,
              content: kind === 'board' ? { name, columns } : { name, description },
            })
          )
            setId(savedId);
        }}
      >
        <fieldset disabled={command.blocked}>
          <div className="productivity-grid">
            <label>
              Configuration type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as 'board' | 'project');
                  setId('');
                  setName('');
                  setColumns(initialColumns());
                }}
              >
                <option value="board">Board</option>
                <option value="project">Project</option>
              </select>
            </label>
            <label>
              Edit configuration
              <select value={id} onChange={(e) => choose(e.target.value)}>
                <option value="">Create new</option>
                {(kind === 'board' ? boards : projects).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.content.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {kind === 'project' ? (
            <label>
              Project description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          ) : (
            <>
              <div className="column-config">
                {columns.map((column, index) => (
                  <div className="column-config-row" key={column.id}>
                    <label>
                      Column {index + 1}
                      <input
                        required
                        maxLength={100}
                        value={column.name}
                        onChange={(e) =>
                          setColumns(
                            columns.map((c) =>
                              c.id === column.id ? { ...c, name: e.target.value } : c,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Lifecycle phase
                      <select
                        value={column.phase}
                        onChange={(e) =>
                          setColumns(
                            columns.map((c) =>
                              c.id === column.id
                                ? { ...c, phase: e.target.value as typeof c.phase }
                                : c,
                            ),
                          )
                        }
                      >
                        <option value="planned">Planned (dormant)</option>
                        <option value="next">Next (released)</option>
                        <option value="active">Active</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      disabled={columns.length <= 3}
                      onClick={() => setColumns(columns.filter((c) => c.id !== column.id))}
                    >
                      Remove column {index + 1}
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setColumns([
                    ...columns,
                    { id: crypto.randomUUID(), name: 'New column', phase: 'planned' },
                  ])
                }
              >
                Add column
              </button>
            </>
          )}
          <button>Save {kind}</button>
        </fieldset>
      </form>
    </div>
  );
}

export function TaskProductivity({
  task,
  boards,
  projects,
  timeZone,
  onTask,
  refresh,
  action,
  blocked,
  onBusyChange,
}: {
  task: Task;
  boards: Board[];
  projects: Project[];
  timeZone: string;
  onTask: (task: Task) => void;
  refresh: () => Promise<void>;
  action: (task: Task, type: TaskCommand['type'], extra?: object) => void;
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [organization, setOrganization] = useState(task.organization);
  const [tags, setTags] = useState(task.organization.tags.join(', '));
  const [due, setDue] = useState(localDateTime(task.schedule.dueAt, timeZone));
  const [scheduled, setScheduled] = useState(localDateTime(task.schedule.scheduledAt, timeZone));
  const [dateError, setDateError] = useState('');
  const [steps, setSteps] = useState<z.infer<typeof StepsResponse> | null>(null);
  const [series, setSeries] = useState<RecurrenceSeries[]>([]);
  const [stepDraft, setStepDraft] = useState<TaskStep['content']>({
    title: '',
    instructions: '',
    responsibility: 'human',
    required: true,
    dependencies: [],
    order: 0,
  });
  const [editing, setEditing] = useState<TaskStep | null>(null);
  const [assignment, setAssignment] = useState('');
  const [rule, setRule] = useState<RecurrenceRule>({
    frequency: 'daily',
    timeZone,
    time: '09:00',
    startDate: localDateTime(new Date().toISOString(), timeZone).slice(0, 10),
    weekdays: [1],
    monthDay: 1,
  });
  const reload = async () => {
    const [s, r] = await Promise.all([
      request(`/api/tasks/${task.id}/steps`, StepsResponse),
      request('/api/recurrence', SeriesResponse),
    ]);
    setSteps(s);
    setSeries(r.series);
    setEditing((current) =>
      current ? (s.entries.find((entry) => entry.step.id === current.id)?.step ?? null) : null,
    );
    onTask(s.task);
    await refresh();
  };
  const ruleLoaded = useRef(false);
  const command = useCommand(reload);
  useEffect(() => {
    onBusyChange(command.blocked);
    return () => onBusyChange(false);
  }, [command.blocked, onBusyChange]);
  useEffect(() => {
    let active = true;
    Promise.all([
      request(`/api/tasks/${task.id}/steps`, StepsResponse),
      request('/api/recurrence', SeriesResponse),
    ])
      .then(([s, r]) => {
        if (active) {
          setSteps(s);
          if (s.task.revision !== task.revision) onTask(s.task);
          setSeries(r.series);
          const existing = r.series.find((x) => x.id === task.schedule.seriesId);
          if (existing && !ruleLoaded.current) {
            setRule(existing.rule);
            ruleLoaded.current = true;
          }
        }
      })
      .catch((e) => {
        if (active) setDateError(e.message);
      });
    return () => {
      active = false;
    };
  }, [task.id, task.revision]);
  const [createdSeriesId, setCreatedSeriesId] = useState<string | null>(null);
  const currentSeries = series.find((s) => s.id === (task.schedule.seriesId ?? createdSeriesId));
  const locked = blocked || command.blocked || !!task.archivedAt || task.phase === 'completed';
  const stepCommand = (step: TaskStep, type: string, extra: object = {}) =>
    void command.send('/api/steps/commands', {
      type,
      operationId: crypto.randomUUID(),
      id: step.id,
      taskId: task.id,
      expectedRevision: step.revision,
      expectedTaskRevision: task.revision,
      ...extra,
    });
  return (
    <div className="task-productivity">
      {command.feedback}
      <details open>
        <summary>Organization & dates</summary>
        <fieldset disabled={locked}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(task, 'task.organize', {
                organization: {
                  ...organization,
                  tags: tags
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                },
              });
            }}
          >
            <div className="productivity-grid">
              <label>
                Task project
                <select
                  value={organization.projectId ?? ''}
                  onChange={(e) =>
                    setOrganization({ ...organization, projectId: e.target.value || null })
                  }
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.content.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Task priority
                <select
                  value={organization.priority}
                  onChange={(e) =>
                    setOrganization({
                      ...organization,
                      priority: e.target.value as typeof organization.priority,
                    })
                  }
                >
                  {['none', 'low', 'normal', 'high', 'urgent'].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Task board
                <select
                  value={organization.boardId ?? ''}
                  onChange={(e) => {
                    const board = boards.find((b) => b.id === e.target.value);
                    setOrganization({
                      ...organization,
                      boardId: board?.id ?? null,
                      columnId:
                        board?.content.columns.find((c) => c.phase === task.phase)?.id ?? null,
                    });
                  }}
                >
                  <option value="">Default board</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.content.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Task column
                <select
                  value={organization.columnId ?? ''}
                  onChange={(e) =>
                    setOrganization({ ...organization, columnId: e.target.value || null })
                  }
                >
                  <option value="">No column</option>
                  {boards
                    .find((b) => b.id === organization.boardId)
                    ?.content.columns.filter((c) => c.phase === task.phase)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              Tags (comma separated)
              <input value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <button>Save organization</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                setDateError('');
                action(task, 'task.schedule', {
                  dueAt: dateTimeInstant(due, timeZone),
                  scheduledAt: dateTimeInstant(scheduled, timeZone),
                });
              } catch (error) {
                setDateError((error as Error).message);
              }
            }}
          >
            <p>Dates use {timeZone}.</p>
            <div className="productivity-grid">
              <label>
                Due date
                <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <label>
                Scheduled date
                <input
                  type="datetime-local"
                  value={scheduled}
                  onChange={(e) => setScheduled(e.target.value)}
                />
              </label>
            </div>
            <button>Save dates</button>
          </form>
          <div className="detail-actions">
            <button
              className="secondary"
              onClick={() => action(task, 'task.pause', { paused: !task.paused })}
            >
              {task.paused ? 'Resume work' : 'Pause work'}
            </button>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={task.finalReviewRequired}
                onChange={(e) =>
                  action(task, 'task.review', { required: e.target.checked, satisfied: false })
                }
              />
              Require final review
            </label>
            {task.finalReviewRequired && (
              <button
                className="secondary"
                onClick={() =>
                  action(task, 'task.review', {
                    required: true,
                    satisfied: !task.finalReviewSatisfied,
                  })
                }
              >
                {task.finalReviewSatisfied ? 'Reopen final review' : 'Mark final review satisfied'}
              </button>
            )}
          </div>
        </fieldset>
      </details>
      {dateError && (
        <p role="status" className="notice">
          {dateError}
        </p>
      )}
      <details className="steps-panel" open>
        <summary>Steps · one shared outcome</summary>
        <p>
          {task.phase === 'planned'
            ? 'This task is Planned. Release it to Next before any step can start.'
            : task.paused
              ? 'Work is paused. Resume when ready.'
              : steps?.canComplete
                ? 'Required work is satisfied. You can complete the outcome.'
                : 'Finish required steps and any final review before completing the outcome.'}
        </p>
        {steps?.entries.map(({ step, ready, waitingReason }) => (
          <article className="step-card" key={step.id}>
            <div className="detail-heading">
              <strong>{step.content.title}</strong>
              <span className="task-badge">
                {step.content.responsibility} · {step.content.required ? 'Required' : 'Optional'}
              </span>
            </div>
            {step.content.instructions && <p>{step.content.instructions}</p>}
            <p className="step-readiness">
              {step.status === 'completed'
                ? 'Completed'
                : step.status === 'skipped'
                  ? 'Skipped'
                  : ready
                    ? 'Ready to start'
                    : waitingReason
                      ? ({
                          not_released: 'Waiting for release to Next',
                          paused: 'Waiting while parent is paused',
                          dependencies: 'Waiting for prerequisites',
                          parent_closed: 'Parent is closed',
                        }[waitingReason] ?? waitingReason)
                      : 'Active'}
              {step.assignedTo ? ` · Assigned to ${step.assignedTo}` : ''}
            </p>
            {step.content.dependencies.length > 0 && (
              <p>
                After:{' '}
                {step.content.dependencies
                  .map(
                    (id) => steps.entries.find((e) => e.step.id === id)?.step.content.title ?? id,
                  )
                  .join(', ')}
              </p>
            )}
            <div className="card-actions">
              <select
                aria-label={`Status of ${step.content.title}`}
                value={step.status}
                disabled={locked}
                onChange={(e) => stepCommand(step, 'step.status', { status: e.target.value })}
              >
                <option value="pending">Pending</option>
                <option value="active" disabled={!!waitingReason}>
                  Active
                </option>
                <option value="completed" disabled={!!waitingReason}>
                  Completed
                </option>
                {!step.content.required && <option value="skipped">Skipped</option>}
              </select>
              <button
                className="secondary"
                disabled={locked}
                onClick={() => {
                  setEditing(step);
                  setStepDraft(step.content);
                  setAssignment(step.assignedTo ?? '');
                }}
              >
                Edit step
              </button>
              <button
                className="secondary"
                disabled={locked}
                onClick={() => stepCommand(step, 'step.delete')}
              >
                Delete step
              </button>
            </div>
          </article>
        ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await command.send('/api/steps/commands', {
                type: editing ? 'step.edit' : 'step.create',
                operationId: crypto.randomUUID(),
                id: editing?.id ?? crypto.randomUUID(),
                taskId: task.id,
                expectedRevision: editing?.revision ?? 0,
                expectedTaskRevision: task.revision,
                content: stepDraft,
              })
            ) {
              setEditing(null);
              setStepDraft({
                title: '',
                instructions: '',
                responsibility: 'human',
                required: true,
                dependencies: [],
                order: steps?.entries.length ?? 0,
              });
            }
          }}
        >
          <fieldset disabled={locked}>
            <h4>{editing ? 'Edit step' : 'Add a step'}</h4>
            <label>
              Step title
              <input
                required
                maxLength={500}
                value={stepDraft.title}
                onChange={(e) => setStepDraft({ ...stepDraft, title: e.target.value })}
              />
            </label>
            <label>
              Step instructions
              <textarea
                value={stepDraft.instructions}
                onChange={(e) => setStepDraft({ ...stepDraft, instructions: e.target.value })}
              />
            </label>
            <div className="productivity-grid">
              <label>
                Responsibility
                <select
                  value={stepDraft.responsibility}
                  onChange={(e) =>
                    setStepDraft({
                      ...stepDraft,
                      responsibility: e.target.value as typeof stepDraft.responsibility,
                    })
                  }
                >
                  <option value="human">Human</option>
                  <option value="agent">Agent</option>
                  <option value="either">Either</option>
                </select>
              </label>
              <label>
                Step order
                <input
                  type="number"
                  min={0}
                  value={stepDraft.order}
                  onChange={(e) => setStepDraft({ ...stepDraft, order: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={stepDraft.required}
                onChange={(e) => setStepDraft({ ...stepDraft, required: e.target.checked })}
              />
              Required for parent completion
            </label>
            <fieldset>
              <legend>Prerequisites (parallel steps need no dependency)</legend>
              {steps?.entries
                .filter((e) => e.step.id !== editing?.id)
                .map(({ step }) => (
                  <label className="inline-check" key={step.id}>
                    <input
                      type="checkbox"
                      checked={stepDraft.dependencies.includes(step.id)}
                      onChange={(e) =>
                        setStepDraft({
                          ...stepDraft,
                          dependencies: e.target.checked
                            ? [...stepDraft.dependencies, step.id]
                            : stepDraft.dependencies.filter((id) => id !== step.id),
                        })
                      }
                    />
                    {step.content.title}
                  </label>
                ))}
            </fieldset>
            <button>{editing ? 'Save step' : 'Add step'}</button>
            {editing && (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditing(null);
                    setStepDraft({
                      title: '',
                      instructions: '',
                      responsibility: 'human',
                      required: true,
                      dependencies: [],
                      order: steps?.entries.length ?? 0,
                    });
                  }}
                >
                  Cancel step edit
                </button>
                <label>
                  Assignment
                  <input value={assignment} onChange={(e) => setAssignment(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    stepCommand(editing, 'step.assign', { assignedTo: assignment.trim() || null })
                  }
                >
                  Save assignment
                </button>
              </>
            )}
          </fieldset>
        </form>
      </details>
      <details>
        <summary>Repeat & occurrence history</summary>
        <p>
          A repeat creates a new Planned occurrence using this task’s text. The original task
          remains its own record. Changes here affect future work; completed history stays intact.
        </p>
        {currentSeries?.cancelledAt ? (
          <p>This series is cancelled. Its occurrence history is retained.</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const savedId = currentSeries?.id ?? crypto.randomUUID();
              if (
                await command.send('/api/recurrence/commands', {
                  type: currentSeries ? 'series.edit' : 'series.create',
                  operationId: crypto.randomUUID(),
                  id: savedId,
                  expectedRevision: currentSeries?.revision ?? 0,
                  content: task.content,
                  rule,
                })
              )
                setCreatedSeriesId(savedId);
            }}
          >
            <fieldset disabled={locked}>
              <div className="productivity-grid">
                <label>
                  Repeat frequency
                  <select
                    value={rule.frequency}
                    onChange={(e) =>
                      setRule({ ...rule, frequency: e.target.value as RecurrenceRule['frequency'] })
                    }
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Selected weekdays</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label>
                  Repeat time
                  <input
                    type="time"
                    required
                    value={rule.time}
                    onChange={(e) => setRule({ ...rule, time: e.target.value })}
                  />
                </label>
                <label>
                  Repeat start date
                  <input
                    type="date"
                    required
                    value={rule.startDate}
                    onChange={(e) => setRule({ ...rule, startDate: e.target.value })}
                  />
                </label>
                <label>
                  Repeat time zone
                  <input
                    required
                    value={rule.timeZone}
                    onChange={(e) => setRule({ ...rule, timeZone: e.target.value })}
                  />
                </label>
              </div>
              {rule.frequency === 'weekly' && (
                <div className="weekday-controls">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
                    <label className="inline-check" key={day}>
                      <input
                        type="checkbox"
                        checked={rule.weekdays.includes(index + 1)}
                        onChange={(e) =>
                          setRule({
                            ...rule,
                            weekdays: e.target.checked
                              ? [...rule.weekdays, index + 1]
                              : rule.weekdays.filter((n) => n !== index + 1),
                          })
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
              )}
              {rule.frequency === 'monthly' && (
                <label>
                  Day of month
                  <input
                    type="number"
                    min={1}
                    max={31}
                    required
                    value={rule.monthDay}
                    onChange={(e) => setRule({ ...rule, monthDay: Number(e.target.value) })}
                  />
                </label>
              )}
              <p>
                Missing monthly days use the last valid day. Clock changes move nonexistent times
                forward and use the earlier repeated time. Late completion creates the next future
                occurrence.
              </p>
              <button>{currentSeries ? 'Save future recurrence' : 'Create repeat series'}</button>
              {currentSeries && (
                <div className="detail-actions">
                  {task.schedule.seriesId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void command.send('/api/recurrence/commands', {
                          type: 'series.skip',
                          operationId: crypto.randomUUID(),
                          id: currentSeries.id,
                          expectedRevision: currentSeries.revision,
                          taskId: task.id,
                          expectedTaskRevision: task.revision,
                        })
                      }
                    >
                      Skip this occurrence
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void command.send('/api/recurrence/commands', {
                        type: 'series.cancel',
                        operationId: crypto.randomUUID(),
                        id: currentSeries.id,
                        expectedRevision: currentSeries.revision,
                      })
                    }
                  >
                    Cancel future repeats
                  </button>
                </div>
              )}
            </fieldset>
          </form>
        )}
      </details>
    </div>
  );
}
