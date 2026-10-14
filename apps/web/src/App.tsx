import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ComponentType,
  type ComponentProps,
} from 'react';
import { MeSchema, PreferencesSchema, PreferencesRecordSchema } from '@mems-life/domain';
import type { z } from 'zod';
import { auth, request, RequestError } from './api';
import type { TodayTarget } from './features/Today';
const Tasks = retryableFeature<ComponentProps<typeof import('./features/Tasks').Tasks> & object>(
  'Tasks',
  () => import('./features/Tasks').then((module) => ({ default: module.Tasks })),
);
const Workouts = retryableFeature<
  ComponentProps<typeof import('./features/Workouts').Workouts> & object
>('Workouts', () => import('./features/Workouts').then((module) => ({ default: module.Workouts })));
const Sessions = retryableFeature<
  ComponentProps<typeof import('./features/Sessions').Sessions> & object
>('Sessions', () => import('./features/Sessions').then((module) => ({ default: module.Sessions })));
const Food = retryableFeature<ComponentProps<typeof import('./features/Food').Food> & object>(
  'Food',
  () => import('./features/Food').then((module) => ({ default: module.Food })),
);
const Whoop = retryableFeature<ComponentProps<typeof import('./features/Whoop').Whoop> & object>(
  'Whoop',
  () => import('./features/Whoop').then((module) => ({ default: module.Whoop })),
);
const AgentAccess = retryableFeature<
  ComponentProps<typeof import('./features/AgentAccess').AgentAccess> & object
>('AgentAccess', () =>
  import('./features/AgentAccess').then((module) => ({ default: module.AgentAccess })),
);
const NotificationSettings = retryableFeature<
  ComponentProps<typeof import('./features/NotificationSettings').NotificationSettings> & object
>('NotificationSettings', () =>
  import('./features/NotificationSettings').then((module) => ({
    default: module.NotificationSettings,
  })),
);
const Today = retryableFeature<ComponentProps<typeof import('./features/Today').Today> & object>(
  'Today',
  () => import('./features/Today').then((module) => ({ default: module.Today })),
);

class FeatureBoundary extends Component<
  { children: React.ReactNode; onRetry?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section role="alert">
        <p>This view could not open. Your other open views are still available.</p>
        <button
          onClick={() => {
            this.props.onRetry?.();
            this.setState({ failed: false });
          }}
        >
          Retry opening view
        </button>
      </section>
    ) : (
      <Suspense fallback={<p role="status">Opening view…</p>}>{this.props.children}</Suspense>
    );
  }
}

function retryableFeature<P extends object>(
  name: string,
  loader: () => Promise<{ default: ComponentType<P> }>,
) {
  return function Feature(props: P) {
    const [attempt, setAttempt] = useState(0);
    const View = useMemo(
      () =>
        lazy(async () => {
          if (!attempt) return loader();
          await Promise.all(
            Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
              .filter((link) => {
                if (new URL(link.href).origin !== window.location.origin) return false;
                try {
                  return !link.sheet?.cssRules.length;
                } catch {
                  return true;
                }
              })
              .map(
                (link) =>
                  new Promise<void>((resolve, reject) => {
                    const replacement = document.createElement('link');
                    replacement.rel = 'stylesheet';
                    const url = new URL(link.href);
                    url.searchParams.set('retry', crypto.randomUUID());
                    replacement.href = url.href;
                    replacement.onload = () => {
                      link.remove();
                      resolve();
                    };
                    replacement.onerror = () => {
                      replacement.remove();
                      reject(new Error('View styles could not load.'));
                    };
                    document.head.append(replacement);
                  }),
              ),
          );

          // Browsers cache a rejected module URL, separately from React.lazy's promise.
          // Vite records its compiled chunk URL in a same-origin modulepreload link.
          const href = Array.from(
            document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'),
          )
            .map((link) => link.href)
            .find(
              (href) =>
                new URL(href).origin === window.location.origin &&
                new URL(href).pathname.split('/').at(-1)?.startsWith(`${name}-`),
            );
          if (!href) return loader();
          const url = new URL(href);
          url.searchParams.set('retry', crypto.randomUUID());
          const module = await import(/* @vite-ignore */ url.href);
          return { default: module[name] as ComponentType<P> };
        }),
      [attempt],
    );
    return (
      <FeatureBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
        <View {...props} />
      </FeatureBoundary>
    );
  };
}

type Me = z.infer<typeof MeSchema>;
type Preferences = z.infer<typeof PreferencesSchema>;
type PreferenceRecord = z.infer<typeof PreferencesRecordSchema>;
type Page = 'today' | 'tasks' | 'workouts' | 'food' | 'settings';
type Session =
  | { kind: 'loading' }
  | { kind: 'signedOut'; expired: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; me: Me };
const pages: { id: Page; title: string; detail: string; icon: string }[] = [
  { id: 'today', title: 'Today', detail: 'Your daily focus', icon: '◷' },
  { id: 'tasks', title: 'Tasks', detail: 'Plans & progress', icon: '☷' },
  { id: 'workouts', title: 'Workouts', detail: 'Training & history', icon: '↗' },
  { id: 'food', title: 'Food', detail: 'Your food diary', icon: '◒' },
  { id: 'settings', title: 'Settings', detail: 'Make it yours', icon: '⚙' },
];
function currentPage(): Page {
  return pages.find((page) => `#${page.id}` === window.location.hash)?.id ?? 'today';
}
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function App() {
  const [session, setSession] = useState<Session>({ kind: 'loading' });
  const [page, setPage] = useState<Page>(currentPage);
  const [visited, setVisited] = useState<Set<Page>>(() => new Set([currentPage()]));
  useEffect(() => {
    setVisited((previous) => (previous.has(page) ? previous : new Set([...previous, page])));
  }, [page]);
  const [workoutView, setWorkoutView] = useState<'library' | 'train' | 'whoop'>('library');
  const [focusTarget, setFocusTarget] = useState<TodayTarget>();
  const taskFocusTarget: { id?: string; action?: 'create' } | undefined = useMemo(
    () =>
      focusTarget?.kind === 'task'
        ? { id: focusTarget.id, action: focusTarget.action === 'create' ? 'create' : undefined }
        : undefined,
    [focusTarget],
  );
  const [record, setRecord] = useState<PreferenceRecord | null>(null);
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [latestForReview, setLatestForReview] = useState<PreferenceRecord | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const dirtyRef = useRef(false);
  const operation = useRef<{
    operationId: string;
    expectedRevision: number;
    value: Preferences;
  } | null>(null);
  const load = async () => {
    setSession({ kind: 'loading' });
    try {
      const [me, preferences] = await Promise.all([
        request('/api/me', MeSchema),
        request('/api/preferences', PreferencesRecordSchema),
      ]);
      if (!dirtyRef.current) {
        setRecord(preferences);
        setDraft(preferences.value);
      } else {
        setLatestForReview(preferences);
        setNotice({
          kind: 'success',
          message:
            'Your edits were preserved. Compare the current saved preferences below before continuing.',
        });
      }
      setSession({ kind: 'ready', me });
    } catch (error) {
      setSession(
        error instanceof RequestError && error.status === 401
          ? { kind: 'signedOut', expired: dirtyRef.current }
          : { kind: 'error', message: messageOf(error) },
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const verifySession = () => {
      if (session.kind !== 'ready') return;
      void request('/api/me', MeSchema).catch((error) => {
        if (error instanceof RequestError && error.status === 401)
          setSession({ kind: 'signedOut', expired: dirtyRef.current });
      });
    };
    window.addEventListener('focus', verifySession);
    return () => window.removeEventListener('focus', verifySession);
  }, [session.kind]);
  useEffect(() => {
    const update = () => {
      const matched = pages.find((item) => `#${item.id}` === window.location.hash);
      if (matched) setPage(matched.id);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = draft?.theme ?? 'system';
  }, [draft?.theme]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, []);
  const edit = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
    dirtyRef.current = true;
    setDirty(true);
    setNotice(null);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !record) return;
    const parsed = PreferencesSchema.safeParse(draft);
    if (!parsed.success) {
      setNotice({
        kind: 'error',
        message: parsed.error.issues[0]?.message ?? 'Check your preferences.',
      });
      return;
    }
    setSaving(true);
    setNotice(null);
    operation.current ??= {
      operationId: crypto.randomUUID(),
      expectedRevision: record.revision,
      value: parsed.data,
    };
    const command = operation.current;
    try {
      const saved = await request('/api/preferences', PreferencesRecordSchema, {
        method: 'PUT',
        body: JSON.stringify(command),
      });
      setRecord(saved);
      const hasNewerEdits = JSON.stringify(parsed.data) !== JSON.stringify(command.value);
      if (!hasNewerEdits) setDraft(saved.value);
      dirtyRef.current = hasNewerEdits;
      setDirty(hasNewerEdits);
      operation.current = null;
      setNotice({
        kind: 'success',
        message: hasNewerEdits
          ? 'Your previous save is confirmed. Your newer edits are still here and have not been saved yet.'
          : 'Your preferences are saved.',
      });
    } catch (error) {
      if (error instanceof RequestError && error.status >= 400 && error.status < 500)
        operation.current = null;
      if (error instanceof RequestError && error.status === 401) {
        setSession({ kind: 'signedOut', expired: true });
      } else {
        setNotice({
          kind: 'error',
          message:
            error instanceof RequestError && error.status === 409
              ? 'Preferences changed on another device. Your edits are still here. Reload saved preferences to review the latest version.'
              : error instanceof RequestError && (error.status === 0 || error.status >= 500)
                ? "We couldn't confirm whether your preferences were saved. Your edits are still here. Save again to check the earlier request before saving any newer edits."
                : messageOf(error),
        });
      }
    } finally {
      setSaving(false);
    }
  };
  const reloadPreferences = async () => {
    try {
      const latest = await request('/api/preferences', PreferencesRecordSchema);
      setLatestForReview(latest);
      setNotice({
        kind: 'success',
        message:
          'The latest saved version is below. Compare it with your edits before choosing which version to keep.',
      });
    } catch (error) {
      if (error instanceof RequestError && error.status === 401)
        setSession({ kind: 'signedOut', expired: true });
      else setNotice({ kind: 'error', message: messageOf(error) });
    }
  };
  const signOut = async () => {
    setSaving(true);
    try {
      const result = await auth.signOut();
      if (result.error) throw new Error('Sign out could not be completed. Please try again.');
      setSession({ kind: 'signedOut', expired: false });
      setDraft(null);
      setRecord(null);
      dirtyRef.current = false;
      setDirty(false);
      setNotice(null);
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) });
    } finally {
      setSaving(false);
    }
  };
  if (session.kind === 'loading')
    return <Status title="Opening your workspace" message="Checking your private session." />;
  if (session.kind === 'error')
    return (
      <Status
        title="We couldn't open your workspace"
        message={session.message}
        action={<button onClick={() => void load()}>Try again</button>}
      />
    );
  if (session.kind === 'signedOut') return <SignIn expired={session.expired} onSignedIn={load} />;
  const title = pages.find((item) => item.id === page)!.title;
  const name = record?.value.displayName || session.me.user.name;
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="#today" className="brand">
          <span className="brand-mark">m.</span>
          <span>
            Mem's Life<small>A little more intentional.</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {pages.map((item) => (
            <a
              href={`#${item.id}`}
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              className="nav-item"
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>
                {item.title}
                <small>{item.detail}</small>
              </span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="private-indicator">Private workspace</span>
          <div className="account">
            <span className="avatar" aria-hidden="true">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className="account-name">
              <span
                title={name}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                }}
              >
                {name}
              </span>
              <small>{session.me.user.email}</small>
            </span>
          </div>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        {page !== 'today' && (
          <header className="page-header">
            <div>
              <p className="eyebrow">Your workspace</p>
              <h1>{title}</h1>
            </div>
            <span className="header-note">A place for your everyday.</span>
          </header>
        )}
        {page === 'settings' && draft ? (
          <>
            <div className="intro">
              <h2>Make yourself at home.</h2>
              <p>Choose how your name, measurements, and workspace appear.</p>
            </div>
            <form className="settings-card" onSubmit={(event) => void save(event)}>
              <fieldset disabled={saving}>
                <legend>Personal preferences</legend>
                <label>
                  Display name
                  <input
                    autoComplete="nickname"
                    value={draft.displayName}
                    maxLength={100}
                    required
                    onChange={(event) => edit('displayName', event.target.value)}
                  />
                </label>
                <label>
                  Time zone
                  <input
                    list="time-zones"
                    value={draft.timeZone}
                    required
                    onChange={(event) => edit('timeZone', event.target.value)}
                  />
                  <small>Use a time zone such as America/New_York or Europe/London.</small>
                </label>
                <datalist id="time-zones">
                  {[
                    'America/New_York',
                    'America/Chicago',
                    'America/Denver',
                    'America/Los_Angeles',
                    'Europe/London',
                    'Europe/Paris',
                    'Asia/Tokyo',
                    'Australia/Sydney',
                    'UTC',
                  ].map((zone) => (
                    <option value={zone} key={zone} />
                  ))}
                </datalist>
                <div className="field-row">
                  <label>
                    Weight unit
                    <select
                      value={draft.weightUnit}
                      onChange={(event) =>
                        edit('weightUnit', event.target.value as Preferences['weightUnit'])
                      }
                    >
                      <option value="lb">Pounds (lb)</option>
                      <option value="kg">Kilograms (kg)</option>
                    </select>
                  </label>
                  <label>
                    Distance unit
                    <select
                      value={draft.distanceUnit}
                      onChange={(event) =>
                        edit('distanceUnit', event.target.value as Preferences['distanceUnit'])
                      }
                    >
                      <option value="mi">Miles (mi)</option>
                      <option value="km">Kilometers (km)</option>
                    </select>
                  </label>
                </div>
                <label>
                  Appearance
                  <select
                    value={draft.theme}
                    onChange={(event) => edit('theme', event.target.value as Preferences['theme'])}
                  >
                    <option value="system">Follow device</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
              </fieldset>
              {notice && (
                <p
                  className={`notice ${notice.kind}`}
                  role={notice.kind === 'error' ? 'alert' : 'status'}
                >
                  {notice.message}
                </p>
              )}
              <div className="form-footer">
                <span>
                  {dirty ? 'You have unsaved changes.' : 'Your preferences are up to date.'}
                </span>
                <button type="submit" disabled={saving || !dirty || latestForReview !== null}>
                  {saving ? 'Saving…' : 'Save preferences'}
                </button>
              </div>
              {latestForReview && (
                <section className="revision-review" aria-labelledby="revision-title">
                  <h3 id="revision-title">Review the latest preferences</h3>
                  <p>
                    Keeping your edits will replace all five preferences with the values shown in
                    your form.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Preference</th>
                        <th scope="col">Saved on the server</th>
                        <th scope="col">Your edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        ['displayName', 'timeZone', 'weightUnit', 'distanceUnit', 'theme'] as const
                      ).map((key) => (
                        <tr key={key}>
                          <th scope="row">
                            {
                              {
                                displayName: 'Display name',
                                timeZone: 'Time zone',
                                weightUnit: 'Weight unit',
                                distanceUnit: 'Distance unit',
                                theme: 'Appearance',
                              }[key]
                            }
                          </th>
                          <td>{latestForReview.value[key]}</td>
                          <td>{draft[key]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="review-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setRecord(latestForReview);
                        operation.current = null;
                        setDraft(latestForReview.value);
                        setLatestForReview(null);
                        dirtyRef.current = false;
                        setDirty(false);
                        setNotice({
                          kind: 'success',
                          message: 'Your form now matches the saved preferences.',
                        });
                      }}
                    >
                      Keep saved preferences
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecord(latestForReview);
                        setLatestForReview(null);
                        operation.current = null;
                        setNotice({
                          kind: 'success',
                          message:
                            'You reviewed the current saved preferences. Save to replace them with your edits.',
                        });
                      }}
                    >
                      Keep my reviewed edits
                    </button>
                  </div>
                </section>
              )}
              {notice?.kind === 'error' && (
                <button
                  className="text-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void reloadPreferences()}
                >
                  Reload saved preferences
                </button>
              )}
            </form>
            <FeatureBoundary>
              <NotificationSettings />
            </FeatureBoundary>
            <FeatureBoundary>
              <AgentAccess />
            </FeatureBoundary>
            <section className="session-card">
              <div>
                <h3>Your session</h3>
                <p>Signed in as {session.me.user.email}.</p>
                {dirty && <small>Save or discard your changes before signing out.</small>}
              </div>
              <div className="session-actions">
                {dirty && (
                  <button
                    className="secondary"
                    disabled={saving}
                    onClick={() => {
                      setDraft(record!.value);
                      dirtyRef.current = false;
                      setDirty(false);
                      setLatestForReview(null);
                      setNotice(null);
                      operation.current = null;
                    }}
                  >
                    Discard changes
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={saving || dirty}
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
              </div>
            </section>
          </>
        ) : page === 'workouts' ? (
          <nav aria-label="Workout views">
            <button
              onClick={() => setWorkoutView('library')}
              aria-pressed={workoutView === 'library'}
            >
              Library
            </button>
            <button onClick={() => setWorkoutView('train')} aria-pressed={workoutView === 'train'}>
              Train
            </button>
            <button onClick={() => setWorkoutView('whoop')} aria-pressed={workoutView === 'whoop'}>
              WHOOP
            </button>
          </nav>
        ) : null}
        {(page === 'tasks' || visited.has('tasks')) && (
          <div hidden={page !== 'tasks'}>
            <FeatureBoundary>
              <Tasks
                active={page === 'tasks'}
                preferences={record?.value}
                focusTarget={page === 'tasks' ? taskFocusTarget : undefined}
              />
            </FeatureBoundary>
          </div>
        )}
        {(page === 'food' || visited.has('food')) && (
          <div hidden={page !== 'food'}>
            <FeatureBoundary>
              <Food
                preferences={record?.value}
                focusTarget={
                  page === 'food' && focusTarget?.kind === 'food' ? focusTarget : undefined
                }
              />
            </FeatureBoundary>
          </div>
        )}
        {record && (
          <>
            <div hidden={page !== 'today'}>
              <FeatureBoundary>
                <Today
                  preferences={record.value}
                  active={page === 'today'}
                  onOpen={(target) => {
                    setFocusTarget(target);
                    if (target.kind === 'session') setWorkoutView('train');
                    window.location.hash =
                      target.kind === 'task'
                        ? 'tasks'
                        : target.kind === 'session'
                          ? 'workouts'
                          : 'food';
                  }}
                />
              </FeatureBoundary>
            </div>
            {(page === 'workouts' || visited.has('workouts')) && (
              <>
                <div hidden={page !== 'workouts' || workoutView !== 'library'}>
                  <FeatureBoundary>
                    <Workouts
                      active={page === 'workouts' && workoutView === 'library'}
                      preferences={record.value}
                    />
                  </FeatureBoundary>
                </div>
                <div hidden={page !== 'workouts' || workoutView !== 'train'}>
                  <FeatureBoundary>
                    <Sessions
                      active={page === 'workouts' && workoutView === 'train'}
                      preferences={record.value}
                      focusTarget={
                        page === 'workouts' && focusTarget?.kind === 'session'
                          ? focusTarget
                          : undefined
                      }
                    />
                  </FeatureBoundary>
                </div>
                <div hidden={page !== 'workouts' || workoutView !== 'whoop'}>
                  <FeatureBoundary>
                    <Whoop />
                  </FeatureBoundary>
                </div>
              </>
            )}
          </>
        )}
        <footer className="workspace-footer">
          Your life, in your own space.<span>Private installation</span>
        </footer>
      </main>
    </div>
  );
}

function Status({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="status-page">
      <span className="brand-mark">m.</span>
      <h1>{title}</h1>
      <p role="status">{message}</p>
      {action}
    </main>
  );
}
function SignIn({ expired, onSignedIn }: { expired: boolean; onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await auth.signIn.email({ email, password });
      if (result.error) {
        setError('The email or password was not accepted. Check your details and try again.');
        return;
      }
      setPassword('');
      await onSignedIn();
    } catch {
      setError('The service could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="sign-in-layout">
      <section className="sign-in-story">
        <a className="brand" href="#">
          <span className="brand-mark">m.</span>
          <span>Mem's Life</span>
        </a>
        <div>
          <p className="eyebrow">A private place for everyday life</p>
          <h1>
            Make room for
            <br />
            <em>what matters.</em>
          </h1>
          <p>
            Your tasks, your training, your everyday meals.
            <br />
            Together in a workspace you own.
          </p>
        </div>
        <span className="story-footnote">Personal by design. Private by default.</span>
      </section>
      <section className="sign-in-panel">
        <form onSubmit={(event) => void submit(event)}>
          <p className="eyebrow">Welcome home</p>
          <h2>Sign in to your space.</h2>
          <p className="muted">Use the owner account for this installation.</p>
          {expired && (
            <p className="notice error" role="alert">
              Your session ended. Sign in again to continue. Your unsaved preferences are still
              here.
            </p>
          )}
          <fieldset disabled={busy}>
            <legend className="sr-only">Sign in</legend>
            <label>
              Email address
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </fieldset>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button className="sign-in-button" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
            <span aria-hidden="true">↗</span>
          </button>
          <p className="bootstrap-note">
            New installation? Create the owner account with the local setup command. Account
            recovery is managed on the server.
          </p>
        </form>
      </section>
    </main>
  );
}
