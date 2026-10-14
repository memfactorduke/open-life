import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AttentionResponseSchema,
  latestFoodEntries,
  type AttentionItem,
  type AttentionResponse,
  type Preferences,
} from '@mems-life/domain';
import { request } from '../api';
import './today.css';

export type TodayTarget =
  | { kind: 'task'; id?: string; action?: 'create' }
  | { kind: 'session'; id?: string; routineId?: string; action?: 'create' }
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
  agent_failed: 'Review the failed attempt.',
  reconcile_agent_outcome: 'Check the outcome before retrying.',
  review_result: 'Review the agent result.',
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
  const ready = data?.items.filter((item) => item.kind !== 'waiting') ?? [];
  const waiting = data?.items.filter((item) => item.kind === 'waiting') ?? [];
  const attentionRow = (item: AttentionItem) => (
    <li key={item.id}>
      <button
        aria-label={`${labels[item.kind]}: ${item.step?.content.title ?? item.task.content.title}`}
        onClick={() => onOpen({ kind: 'task', id: item.task.id })}
      >
        <span className="today-row-content">
          <strong>{item.step?.content.title ?? item.task.content.title}</strong>
          {item.step && <span className="today-muted">{item.task.content.title}</span>}
          {item.waitingReason && <span className="today-muted">{attentionReason(item)}</span>}
        </span>
        <span className={`today-status ${item.kind}`}>{labels[item.kind]}</span>
      </button>
    </li>
  );
  return (
    <section className="today" aria-labelledby="today-heading">
      <header className="today-heading">
        <div>
          <h1 id="today-heading">Today</h1>
          {data && (
            <p className="today-date">
              {new Intl.DateTimeFormat('en', {
                timeZone: data.timezone,
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              }).format(new Date(data.now))}
            </p>
          )}
        </div>
        <button className="today-quiet" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh Today'}
        </button>
      </header>
      {error && (
        <div role="alert" className="today-error">
          <p>{error}</p>
          {data && <p>Showing the last confirmed view. It may have changed.</p>}
          <button onClick={() => void refresh()} disabled={loading}>
            Retry Today
          </button>
        </div>
      )}
      {loading && !data && <p role="status">Loading your day…</p>}
      {data?.activeSession && (
        <section className="today-workout" aria-label="Active workout">
          <div>
            <strong>{data.activeSession.name}</strong>
            <p className="today-muted">
              {data.activeSession.items.reduce(
                (count, exercise) =>
                  count + exercise.results.filter((result) => !result.removedAt).length,
                0,
              )}{' '}
              sets recorded
            </p>
          </div>
          <button
            className="primary"
            onClick={() => onOpen({ kind: 'session', id: data.activeSession!.id })}
          >
            Resume workout
          </button>
        </section>
      )}
      <nav className="today-capture" aria-label="Quick capture">
        <button onClick={() => onOpen({ kind: 'task', action: 'create' })}>Capture a task</button>
        <button onClick={() => onOpen({ kind: 'food', action: 'capture' })}>Log food</button>
        {!data?.activeSession && (
          <button onClick={() => onOpen({ kind: 'session' })}>Start workout</button>
        )}
      </nav>
      {data && (
        <div className="today-grid">
          <section className="today-focus" aria-labelledby="focus-heading">
            <h2 id="focus-heading">Needs you{ready.length ? ` · ${ready.length}` : ''}</h2>
            {ready.length ? (
              <ul className="today-list">{ready.map(attentionRow)}</ul>
            ) : (
              <p className="today-muted">Nothing needs your attention.</p>
            )}
            {!!waiting.length && (
              <details className="today-waiting">
                <summary>Waiting · {waiting.length}</summary>
                <ul className="today-list">{waiting.map(attentionRow)}</ul>
              </details>
            )}
          </section>
          <section className="today-food-panel" aria-labelledby="food-heading">
            <header className="today-section-heading">
              <h2 id="food-heading">Food today · {data.food.count}</h2>
              <button
                className="today-quiet"
                onClick={() => onOpen({ kind: 'food', action: 'capture' })}
              >
                Add food entry
              </button>
            </header>
            {!data.food.count && <p className="today-muted">No entries yet.</p>}
            <ul className="today-food">
              {latestFoodEntries(data.food.entries).map((entry) => (
                <li key={entry.id}>
                  <button onClick={() => onOpen({ kind: 'food', id: entry.id })}>
                    <strong>{entry.content.text.trim() || 'Photo entry'}</strong>
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
            {data.food.count > 3 && (
              <button className="today-quiet" onClick={() => onOpen({ kind: 'food' })}>
                View food diary
              </button>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
