import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AttentionResponseSchema,
  type AttentionItem,
  type AttentionResponse,
  type Preferences,
} from '@mems-life/domain';
import { request } from '../api';
import './today.css';

export type TodayTarget =
  | { kind: 'task'; id?: string; action?: 'create' }
  | { kind: 'session'; id?: string; action?: 'create' }
  | { kind: 'food'; id?: string; action?: 'capture' };
const labels: Record<AttentionItem['kind'], string> = {
  due: 'Due now',
  next: 'Next action',
  waiting: 'Waiting',
  handoff: 'Ready for you',
  failure: 'Agent needs help',
  'outcome-unknown': 'Outcome needs checking',
  review: 'Review needed',
};
const reasons: Record<string, string> = {
  not_released: 'This work has not been released.',
  paused: 'This work is paused.',
  agent: 'Waiting for an agent.',
  dependencies: 'Waiting for earlier steps.',
  dependency: 'Waiting for an earlier step.',
  agent_failed: 'The latest agent attempt failed. Open the task to review what happened.',
  reconcile_agent_outcome: 'The agent outcome is uncertain. Check the task before retrying.',
  review_result: 'An agent result is ready for your review.',
  final_review: 'The finished work needs your final review.',
};
export function attentionReason(item: AttentionItem) {
  return item.waitingReason
    ? (reasons[item.waitingReason] ?? item.waitingReason.replace(/_/g, ' '))
    : item.step
      ? 'This step is ready for you.'
      : 'Open this task to continue.';
}

export function Today({
  preferences,
  onOpen,
  active = true,
}: {
  preferences: Preferences;
  onOpen: (target: TodayTarget) => void;
  active?: boolean;
}) {
  const [data, setData] = useState<AttentionResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const value = await request('/api/attention', AttentionResponseSchema);
      if (current === generation.current) {
        setData(value);
        setError('');
      }
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : 'Today could not be refreshed.');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const foreground = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', foreground);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('online', foreground);
    };
  }, [active, refresh]);
  const item = data?.items.find((i) => i.id === selected) ?? data?.items[0];
  const ready = data?.items.filter((i) => i.kind !== 'waiting') ?? [];
  const nextAction = ready[0];
  return (
    <section className="today" aria-labelledby="today-heading">
      <header className="today-heading">
        <div>
          <p className="eyebrow">Your daily focus</p>
          <h1 id="today-heading">Today</h1>
          <p className="today-greeting" title={`Hello, ${preferences.displayName}.`}>
            Hello, {preferences.displayName}.
          </p>
          <p className="today-date">
            {data
              ? new Intl.DateTimeFormat('en', {
                  timeZone: data.timezone,
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                }).format(new Date(data.now))
              : 'A little space to see what comes next.'}
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh Today'}
        </button>
      </header>
      {error && (
        <div role="alert" className="today-error">
          <p>{error}</p>
          {data && (
            <p>
              Showing the last confirmed view from{' '}
              {new Intl.DateTimeFormat('en', {
                timeZone: data.timezone,
                hour: 'numeric',
                minute: '2-digit',
              }).format(new Date(data.now))}
              . It may have changed.
            </p>
          )}
          <button onClick={() => void refresh()} disabled={loading}>
            Retry Today
          </button>
        </div>
      )}
      {loading && !data && <p role="status">Loading your day…</p>}
      <nav className="today-capture" aria-label="Quick capture">
        <button className="primary" onClick={() => onOpen({ kind: 'task', action: 'create' })}>
          Capture a task
        </button>
        <button onClick={() => onOpen({ kind: 'food', action: 'capture' })}>Log food</button>
        {data?.activeSession && (
          <button onClick={() => onOpen({ kind: 'session', id: data.activeSession!.id })}>
            Resume workout
          </button>
        )}
      </nav>
      {nextAction && (
        <div className="today-next">
          <span className="today-tag">{labels[nextAction.kind]}</span>
          <strong>{nextAction.step?.content.title ?? nextAction.task.content.title}</strong>
          <button
            className="primary"
            onClick={() => onOpen({ kind: 'task', id: nextAction.task.id })}
          >
            Continue task
          </button>
        </div>
      )}
      {data && (
        <div className="today-grid">
          <section className="today-panel today-focus" aria-labelledby="focus-heading">
            <h2 id="focus-heading">What needs you</h2>
            {data.items.length === 0 ? (
              <div className="today-empty">
                <h3>A clear place to start</h3>
                <p>Capture a task, log a meal, or open Workouts to plan your next session.</p>
              </div>
            ) : (
              <>
                <p className="today-muted">
                  {ready.length} {ready.length === 1 ? 'action needs' : 'actions need'} your
                  attention · {data.items.length - ready.length} waiting
                </p>
                <div className="today-list-detail">
                  <ul className="today-list">
                    {data.items.map((i) => (
                      <li key={i.id}>
                        <button
                          className={item?.id === i.id ? 'selected' : ''}
                          aria-pressed={item?.id === i.id}
                          onClick={() => setSelected(i.id)}
                        >
                          <span className={`today-tag ${i.kind}`}>{labels[i.kind]}</span>
                          <strong>{i.step?.content.title ?? i.task.content.title}</strong>
                          {i.step && <span className="today-muted">{i.task.content.title}</span>}
                          <span className="today-muted">{attentionReason(i)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {item && (
                    <div className="today-detail">
                      <span className="today-tag">{labels[item.kind]}</span>
                      <h3>{item.step?.content.title ?? item.task.content.title}</h3>
                      <p>{attentionReason(item)}</p>
                      {item.task.schedule.dueAt && (
                        <p className="today-muted">
                          Due{' '}
                          {new Intl.DateTimeFormat('en', {
                            timeZone: preferences.timeZone,
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          }).format(new Date(item.task.schedule.dueAt))}
                        </p>
                      )}
                      <button
                        className="primary"
                        onClick={() => onOpen({ kind: 'task', id: item.task.id })}
                      >
                        Open task
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
          <aside className="today-side">
            <section className="today-panel">
              <p className="eyebrow">Training</p>
              <h2>{data.activeSession ? 'Workout in progress' : 'Room for movement'}</h2>
              {data.activeSession ? (
                <>
                  <p>{data.activeSession.name}</p>
                  <p className="today-muted">
                    {data.activeSession.items.reduce(
                      (count, exercise) => count + exercise.results.length,
                      0,
                    )}{' '}
                    sets recorded
                  </p>
                  <button
                    className="primary"
                    onClick={() => onOpen({ kind: 'session', id: data.activeSession!.id })}
                  >
                    Resume {data.activeSession.name}
                  </button>
                </>
              ) : (
                <>
                  <p className="today-muted">No active workout.</p>
                  <button onClick={() => onOpen({ kind: 'session' })}>Open Workouts</button>
                </>
              )}
            </section>
            <section className="today-panel">
              <p className="eyebrow">Food diary</p>
              <h2>Food today</h2>
              <p className="today-muted">
                {data.food.count === 0
                  ? 'Your diary is ready for your first entry.'
                  : `${data.food.count} ${data.food.count === 1 ? 'entry' : 'entries'} recorded`}
              </p>
              <ul className="today-food">
                {data.food.entries.map((entry) => (
                  <li key={entry.id}>
                    <button onClick={() => onOpen({ kind: 'food', id: entry.id })}>
                      {entry.content.text.trim() || 'Photo entry'}
                      <span className="today-muted">
                        {new Intl.DateTimeFormat('en', {
                          timeZone: data.timezone,
                          hour: 'numeric',
                          minute: '2-digit',
                        }).format(new Date(entry.content.occurredAt))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button onClick={() => onOpen({ kind: 'food', action: 'capture' })}>
                Add a food entry
              </button>
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}
