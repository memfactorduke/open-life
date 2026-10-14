import { useEffect, useRef, useState } from 'react';
import {
  AgentGrantCreateSchema,
  AgentGrantListSchema,
  AgentGrantIssueResponseSchema,
  AgentGrantRevokeResponseSchema,
  type AgentScope,
} from '@mems-life/domain';
import type { z } from 'zod';
import { request, RequestError } from '../api';
import './agent-access.css';

type Grant = z.infer<typeof AgentGrantListSchema>['grants'][number];
const groups: { title: string; options: { scope: AgentScope; label: string }[] }[] = [
  {
    title: 'Tasks',
    options: [
      { scope: 'tasks:read', label: 'Read tasks and history' },
      { scope: 'tasks:write', label: 'Change tasks, boards and steps' },
    ],
  },
  {
    title: 'Workouts',
    options: [
      { scope: 'workouts:read', label: 'Read workouts and history' },
      { scope: 'workouts:plan', label: 'Plan exercises and routines' },
      { scope: 'workouts:record', label: 'Record reported or imported workouts' },
    ],
  },
  {
    title: 'Food',
    options: [
      { scope: 'food:read', label: 'Read the food diary and photos' },
      { scope: 'food:write', label: 'Record reported or imported food' },
      { scope: 'food:attach', label: 'Attach food photos' },
    ],
  },
  {
    title: 'WHOOP',
    options: [{ scope: 'whoop:read', label: 'Read connected WHOOP observations' }],
  },
];
const scopeLabel = (scope: AgentScope) =>
  groups.flatMap((g) => g.options).find((o) => o.scope === scope)?.label ?? scope;
const defaultExpiry = () => {
  const date = new Date(Date.now() + 7 * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const purposes: { value: string; label: string; scopes: AgentScope[] }[] = [
  { value: 'read', label: 'Read only', scopes: ['tasks:read'] },
  { value: 'tasks', label: 'Task assistant', scopes: ['tasks:read', 'tasks:write'] },
  { value: 'workouts', label: 'Workout planner', scopes: ['workouts:read', 'workouts:plan'] },
  { value: 'custom', label: 'Custom', scopes: [] },
];
export function AgentAccess({ active = true }: { active?: boolean }) {
  const [grants, setGrants] = useState<Grant[]>([]),
    [label, setLabel] = useState(''),
    [creating, setCreating] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [purpose, setPurpose] = useState('read'),
    [duration, setDuration] = useState('7'),
    [manual, setManual] = useState(false),
    [scopes, setScopes] = useState<AgentScope[]>(['tasks:read']),
    [expiry, setExpiry] = useState(defaultExpiry),
    [secret, setSecret] = useState<string | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [loaded, setLoaded] = useState(false);
  const revealedGrantId = useRef<string | null>(null);
  const working = useRef(false),
    generation = useRef(0),
    revokeOperations = useRef(new Map<string, string>());
  async function load() {
    try {
      const result = await request('/api/agent-grants', AgentGrantListSchema);
      setGrants(result.grants);
      setLoaded(true);
    } catch (e) {
      setLoaded(false);
      setError(e instanceof Error ? e.message : 'Agent access could not load.');
    }
  }
  useEffect(() => {
    void load();
    const clear = () => {
      generation.current++;
      setSecret(null);
      setNotice('');
    };
    const hide = () => {
      if (document.visibilityState !== 'visible') clear();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', clear);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', clear);
    };
  }, []);
  useEffect(() => {
    if (!active) {
      generation.current++;
      setSecret(null);
      setCreating(false);
      setManual(false);
      setNotice('');
    }
  }, [active]);
  async function issue(event: React.FormEvent) {
    event.preventDefault();
    if (working.current || uncertain || secret) return;
    if (duration === 'custom' && !Number.isFinite(new Date(expiry).getTime())) {
      setError('Choose a valid access end date.');
      return;
    }
    const parsed = AgentGrantCreateSchema.safeParse({
      operationId: crypto.randomUUID(),
      label,
      scopes,
      expiresAt:
        duration === 'custom'
          ? new Date(expiry).toISOString()
          : new Date(Date.now() + Number(duration) * 86400000).toISOString(),
    });
    if (
      !parsed.success ||
      new Date(parsed.data.expiresAt).getTime() <= Date.now() ||
      new Date(parsed.data.expiresAt).getTime() > Date.now() + 366 * 86400000
    ) {
      setError(
        'Enter a name, choose at least one permission, and set an expiry within the next year.',
      );
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const current = generation.current;
    try {
      const result = await request('/api/agent-grants', AgentGrantIssueResponseSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      if (current === generation.current) {
        revealedGrantId.current = result.grant.id;
        setSecret(result.secret);
      } else {
        setUncertain(true);
        setError(
          'The key was hidden before delivery. Review the grants below, revoke this grant and create a replacement.',
        );
      }
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500 && e.status !== 409)
        setError(e.message);
      else {
        setUncertain(true);
        setError(
          'The key could not be retrieved. A grant may have been created. Review the grants below, revoke the unused grant, then create a replacement. The same request cannot retrieve its key.',
        );
      }
    } finally {
      await load();
      working.current = false;
      setBusy(false);
    }
  }
  async function revoke(grant: Grant) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    const operationId = revokeOperations.current.get(grant.id) ?? crypto.randomUUID();
    revokeOperations.current.set(grant.id, operationId);
    try {
      await request('/api/agent-grants/revoke', AgentGrantRevokeResponseSchema, {
        method: 'POST',
        body: JSON.stringify({ operationId, grantId: grant.id }),
      });
      if (revealedGrantId.current === grant.id) setSecret(null);
      setShowHistory(true);
      setNotice(`Access revoked for ${grant.label}. Its history is retained.`);
      revokeOperations.current.delete(grant.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Revocation could not be confirmed. Reload grants or retry revocation.',
      );
    } finally {
      await load();
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="agent-access" aria-labelledby="agent-access-heading">
      <header>
        <p className="eyebrow">Connections</p>
        <h2 id="agent-access-heading">Agent access</h2>
        <p>Choose what an agent can read or change.</p>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {(!creating || uncertain) && (
        <>
          <div className="agent-actions">
            <h3>Issued access</h3>
            <button className="secondary" type="button" disabled={busy} onClick={() => void load()}>
              Reload grants
            </button>
          </div>
          {loaded && grants.length === 0 && <p>No agent access has been issued.</p>}
          <div className="agent-grants">
            {[...grants]
              .filter(
                (grant) =>
                  showHistory ||
                  (!grant.revokedAt && new Date(grant.expiresAt).getTime() > Date.now()),
              )
              .sort(
                (a, b) =>
                  Number(!!a.revokedAt || new Date(a.expiresAt).getTime() <= Date.now()) -
                  Number(!!b.revokedAt || new Date(b.expiresAt).getTime() <= Date.now()),
              )
              .map((grant) => {
                const status = grant.revokedAt
                  ? 'Revoked'
                  : new Date(grant.expiresAt).getTime() <= Date.now()
                    ? 'Expired'
                    : 'Active';
                return (
                  <article key={grant.id}>
                    <h4>{grant.label}</h4>
                    <p>
                      {status} · expires {new Date(grant.expiresAt).toLocaleString()}
                    </p>
                    <ul>
                      {grant.scopes.map((scope) => (
                        <li key={scope}>{scopeLabel(scope)}</li>
                      ))}
                    </ul>
                    {!grant.revokedAt && <p>Revoking ends this agent’s access.</p>}
                    {grant.revokedAt ? (
                      <p>Revoked {new Date(grant.revokedAt).toLocaleString()} · history retained</p>
                    ) : (
                      <button
                        className="secondary agent-revoke"
                        type="button"
                        disabled={busy}
                        onClick={() => void revoke(grant)}
                      >
                        Revoke {grant.label}
                      </button>
                    )}
                  </article>
                );
              })}
          </div>
        </>
      )}
      {(!creating || uncertain) &&
        grants.some(
          (grant) => grant.revokedAt || new Date(grant.expiresAt).getTime() <= Date.now(),
        ) && (
          <button
            className="secondary"
            type="button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? 'Hide expired and revoked access' : 'View expired and revoked access'}
          </button>
        )}
      {secret && (
        <div className="agent-key">
          <h3>Set up your agent</h3>
          <p>
            Endpoint: <code>{window.location.origin}/mcp</code>
          </p>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(`${window.location.origin}/mcp`)
                .then(() => setNotice('Endpoint copied.'))
                .catch(() => setError('Select and copy the endpoint manually.'))
            }
          >
            Copy endpoint
          </button>
          <p>
            Save this key now. It is shown once and stays active until it expires or you revoke it.
          </p>
          <label>
            One-time agent key
            <textarea readOnly value={secret} spellCheck={false} autoComplete="off" />
          </label>
          <div className="agent-actions">
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(secret);
                    setNotice('Key copied. Clear your clipboard after configuring the client.');
                  } catch {
                    setError('Clipboard access failed. Select and copy the key manually.');
                  }
                })();
              }}
            >
              Copy key
            </button>
            <button
              type="button"
              onClick={() => {
                setSecret(null);
                setCreating(false);
                setManual(false);
                setNotice('Key hidden. It cannot be retrieved again.');
              }}
            >
              Done · hide key
            </button>
          </div>
          <button
            className="secondary"
            type="button"
            aria-expanded={manual}
            onClick={() => setManual(!manual)}
          >
            Manual setup details
          </button>
          {manual && (
            <p>
              Use this endpoint in an MCP client that supports custom HTTP headers. Add{' '}
              <code>Authorization: Bearer YOUR_KEY</code> in its private credential settings.
            </p>
          )}
        </div>
      )}
      {!secret && !creating && (
        <button
          type="button"
          disabled={busy || uncertain || !loaded}
          onClick={() => setCreating(true)}
        >
          Add agent
        </button>
      )}
      {creating && !secret && (
        <form onSubmit={(event) => void issue(event)}>
          <h3>Add agent</h3>
          <label>
            Agent name
            <input
              maxLength={100}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={busy || uncertain}
              placeholder="For example, workout planner"
            />
          </label>
          <label>
            Purpose
            <select
              value={purpose}
              disabled={busy || uncertain}
              onChange={(event) => {
                const value = event.target.value;
                setPurpose(value);
                if (value !== 'custom') setScopes(purposes.find((p) => p.value === value)!.scopes);
              }}
            >
              {purposes.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {scopes.length
              ? scopes.map(scopeLabel).join(' · ')
              : 'Choose the permissions this agent needs.'}
          </p>
          {purpose === 'custom' && (
            <div className="agent-scope-grid">
              {groups.map((group) => (
                <fieldset key={group.title}>
                  <legend>{group.title}</legend>
                  {group.options.map((option) => (
                    <label className="agent-scope" key={option.scope}>
                      <input
                        type="checkbox"
                        checked={scopes.includes(option.scope)}
                        disabled={busy || uncertain}
                        onChange={() =>
                          setScopes(
                            scopes.includes(option.scope)
                              ? scopes.filter((scope) => scope !== option.scope)
                              : [...scopes, option.scope],
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
          <label>
            Access duration
            <select
              value={duration}
              disabled={busy || uncertain}
              onChange={(event) => setDuration(event.target.value)}
            >
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="custom">Custom date</option>
            </select>
          </label>
          {duration === 'custom' && (
            <label>
              Access ends
              <input
                type="datetime-local"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                disabled={busy || uncertain}
              />
            </label>
          )}
          <div className="agent-actions">
            <button type="submit" disabled={busy || uncertain || !loaded}>
              Create one-time key
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel adding agent
            </button>
          </div>
        </form>
      )}
      {uncertain && (
        <button
          type="button"
          disabled={busy || !loaded}
          onClick={() => {
            setUncertain(false);
            setError('');
          }}
        >
          I reviewed grants; create a replacement
        </button>
      )}
    </section>
  );
}
