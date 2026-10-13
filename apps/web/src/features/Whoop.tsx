import { useEffect, useRef, useState } from 'react';
import {
  WhoopStateSchema,
  WhoopCommandResponseSchema,
  type WhoopState,
  type WhoopCommand,
  WhoopCommandSchema,
  SessionListSchema,
  type WorkoutSession,
} from '@mems-life/domain';
import { request, RequestError } from '../api';
import './whoop.css';
export function Whoop() {
  const [state, setState] = useState<WhoopState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<WhoopCommand | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<Record<string, string>>({});
  async function load() {
    try {
      setState(await request('/api/whoop', WhoopStateSchema));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WHOOP could not load.');
    }
  }
  useEffect(() => {
    void load();
    void request('/api/sessions?limit=100', SessionListSchema)
      .then((r) => setSessions(r.sessions))
      .catch(() => {});
  }, []);
  async function act(
    type: 'whoop.connect' | 'whoop.refresh' | 'whoop.disconnect' | 'whoop.delete-cache',
    retry = false,
  ) {
    if (!state || busy || (pending.current && !retry)) return;
    const command =
      pending.current ??
      WhoopCommandSchema.parse({
        type,
        ...(type === 'whoop.connect' ? { channel: 'web' } : {}),
        operationId: crypto.randomUUID(),
        expectedRevision: state.revision,
      });
    pending.current = command;
    setBusy(true);
    try {
      const result = await request('/api/whoop/commands', WhoopCommandResponseSchema, {
        method: 'POST',
        body: JSON.stringify(command),
      });
      pending.current = null;
      setState(result.state);
      setError(
        result.revocation === 'failed'
          ? 'Disconnected here. Remote revocation failed; remove access in WHOOP settings.'
          : '',
      );
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500) pending.current = null;
      setError(e instanceof Error ? e.message : 'WHOOP change failed.');
    } finally {
      setBusy(false);
    }
  }
  async function observationChange(
    body:
      | { type: 'whoop.link'; providerId: string; sessionId: string | null }
      | {
          type: 'whoop.refresh-observation';
          providerId: string;
          resource: WhoopState['observations'][number]['resource'];
        },
  ) {
    if (!state || busy || pending.current) return;
    pending.current = {
      ...body,
      operationId: crypto.randomUUID(),
      expectedRevision: state.revision,
    };
    await act('whoop.refresh', true);
  }
  return (
    <section className="whoop">
      <header>
        <p>Optional training context</p>
        <h1>WHOOP</h1>
        <p>Local sets and notes stay authoritative. WHOOP provides read-only observations.</p>
      </header>
      {error && <p role="alert">{error}</p>}
      {!state ? (
        <button onClick={() => void load()}>Reload WHOOP</button>
      ) : (
        <>
          <p className="whoop-status">
            {state.status}
            {state.stale ? ' · observations are stale' : ''}
          </p>
          <p>
            {state.providerAccountId
              ? `Provider account ${state.providerAccountId}`
              : 'No account connected.'}
          </p>
          <p>
            Last successful refresh:{' '}
            {state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleString() : 'Never'}
          </p>
          {state.error && <p role="status">{state.error}</p>}
          {!state.configured ? (
            <p>
              The installation operator must privately configure developer credentials and an HTTPS
              callback. The rest of the app remains usable.
            </p>
          ) : (
            <div className="whoop-actions">
              <button
                disabled={busy || !!pending.current}
                onClick={() => void act('whoop.connect')}
              >
                {state.status === 'connected' ? 'Replace account' : 'Connect or reconnect'}
              </button>
              {state.status === 'connected' && (
                <button
                  disabled={
                    busy ||
                    !!pending.current ||
                    (!!state.nextRefreshAt && new Date(state.nextRefreshAt) > new Date())
                  }
                  onClick={() => void act('whoop.refresh')}
                >
                  Refresh observations
                </button>
              )}
              {state.status !== 'disconnected' && (
                <button
                  disabled={busy || !!pending.current}
                  onClick={() => void act('whoop.disconnect')}
                >
                  Disconnect · retain observations
                </button>
              )}
              {state.observations.length > 0 && (
                <button
                  disabled={busy || !!pending.current}
                  onClick={() => {
                    if (window.confirm('Delete cached WHOOP observations? Local workouts remain.'))
                      void act('whoop.delete-cache');
                  }}
                >
                  Delete cached observations
                </button>
              )}
            </div>
          )}
          {pending.current && (
            <button disabled={busy} onClick={() => void act('whoop.refresh', true)}>
              Retry pending change
            </button>
          )}
          <p>
            Consent reads profile, workouts, cycles, recovery and sleep. Initial context is limited
            to the previous 24 hours and current cycle. Refresh is limited to once an hour.
          </p>
          {state.nextRefreshAt && (
            <p>Next refresh available: {new Date(state.nextRefreshAt).toLocaleString()}</p>
          )}
          <div className="whoop-observations">
            {state.observations.map((o) => (
              <article key={`${o.accountId}:${o.resource}:${o.providerId}`}>
                <h2>
                  {o.resource} · {o.providerId}
                </h2>
                <p>
                  WHOOP account {o.providerAccountId} ·{' '}
                  {o.currentAccount
                    ? 'Current connection'
                    : 'Retained disconnected or previous account'}
                </p>
                <p>
                  {o.start ?? 'Interval unavailable'} → {o.end ?? 'Ongoing or unavailable'} ·{' '}
                  {o.timezoneOffset ?? 'Time zone unavailable'}
                </p>
                <p>{o.available ? o.scoreState : 'Provider observation unavailable'}</p>
                {o.available && o.score ? (
                  <dl>
                    {Object.entries(o.score)
                      .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt>{k.replaceAll('_', ' ')}</dt>
                          <dd>{String(v)}</dd>
                        </div>
                      ))}
                  </dl>
                ) : (
                  <p>Score unavailable; missing values are not zero.</p>
                )}
                <p>
                  Retrieved {new Date(o.retrievedAt).toLocaleString()} · provider updated{' '}
                  {o.providerUpdatedAt}
                </p>
                {o.linkedSessionId && <p>Explicitly linked to local session {o.linkedSessionId}</p>}
                {o.currentAccount && (
                  <>
                    <button
                      disabled={busy || !!pending.current}
                      onClick={() =>
                        void observationChange({
                          type: 'whoop.refresh-observation',
                          resource: o.resource,
                          providerId: o.providerId,
                        })
                      }
                    >
                      Recheck this observation, including older context
                    </button>
                    {o.resource === 'workout' && o.available && (
                      <>
                        <label>
                          Choose a local session to link explicitly
                          <select
                            value={selectedSessions[o.providerId] ?? ''}
                            onChange={(e) =>
                              setSelectedSessions({
                                ...selectedSessions,
                                [o.providerId]: e.target.value,
                              })
                            }
                          >
                            <option value="">Select session</option>
                            {sessions.map((session) => (
                              <option key={session.id} value={session.id}>
                                {session.name} · {new Date(session.startedAt).toLocaleString()}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          disabled={busy || !!pending.current || !selectedSessions[o.providerId]}
                          onClick={() =>
                            void observationChange({
                              type: 'whoop.link',
                              providerId: o.providerId,
                              sessionId: selectedSessions[o.providerId]!,
                            })
                          }
                        >
                          Link selected session
                        </button>
                        {o.linkedSessionId && (
                          <button
                            disabled={busy || !!pending.current}
                            onClick={() =>
                              void observationChange({
                                type: 'whoop.link',
                                providerId: o.providerId,
                                sessionId: null,
                              })
                            }
                          >
                            Unlink session
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
