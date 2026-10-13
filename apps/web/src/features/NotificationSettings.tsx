import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  defaultNotificationPreferences,
  NotificationPreferencesRecordSchema,
  type NotificationPreferences,
} from '@mems-life/domain';
import { request, RequestError } from '../api';
import './notification-settings.css';
const Response = NotificationPreferencesRecordSchema.extend({ providerConfigured: z.boolean() });
type Record = z.infer<typeof NotificationPreferencesRecordSchema>;
const choices: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: 'enabled',
    label: 'Enable notifications',
    description: 'Optional alerts on your signed-in native devices.',
  },
  {
    key: 'due',
    label: 'Due reminders',
    description: 'A reminder when your ready human work is due.',
  },
  {
    key: 'handoff',
    label: 'Ready for you',
    description: 'Agent handoffs and results that need your review.',
  },
  {
    key: 'failure',
    label: 'Work needs help',
    description: 'Failed or uncertain agent work that needs your attention.',
  },
];
export function NotificationSettings({ onSaved }: { onSaved?: (record: Record) => void }) {
  const [record, setRecord] = useState<Record | null>(null);
  const [draft, setDraft] = useState(defaultNotificationPreferences);
  const [provider, setProvider] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const pending = useRef<{
    operationId: string;
    expectedRevision: number;
    value: NotificationPreferences;
  } | null>(null);
  async function load() {
    setBusy(true);
    try {
      const value = await request('/api/notifications/preferences', Response);
      setRecord(value);
      setDraft(value.value);
      setProvider(value.providerConfigured);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Notification settings could not be loaded.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    if (!record) return;
    setBusy(true);
    setMessage('');
    setError('');
    const command = pending.current ?? {
      operationId: crypto.randomUUID(),
      expectedRevision: record.revision,
      value: { ...draft },
    };
    pending.current = command;
    try {
      const saved = await request(
        '/api/notifications/preferences',
        NotificationPreferencesRecordSchema,
        { method: 'PUT', body: JSON.stringify(command) },
      );
      setRecord(saved);
      setDraft(saved.value);
      setConflict(false);
      pending.current = null;
      onSaved?.(saved);
      setMessage('Notification choices saved.');
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500 && e.status !== 409)
        pending.current = null;
      if (e instanceof RequestError && e.status === 409) {
        pending.current = null;
        try {
          const latest = await request('/api/notifications/preferences', Response);
          setRecord(latest);
          setProvider(latest.providerConfigured);
          setConflict(true);
        } catch {
          setError('The saved choices changed, and could not be refreshed. Retry when connected.');
        }
      } else setError(e instanceof Error ? e.message : 'Notification choices could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="notification-settings" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">Notifications</h2>
      <p>
        Today always shows what needs you, even when notifications are off. Ordinary agent success
        does not send an alert.
      </p>
      {!record && !error && <p role="status">Loading notification choices…</p>}
      {record && (
        <>
          <fieldset disabled={busy || !!pending.current}>
            <legend>Choose useful alerts</legend>
            {choices.map((choice) => (
              <label key={choice.key} className="notification-choice">
                <input
                  type="checkbox"
                  checked={draft[choice.key]}
                  onChange={(e) => {
                    pending.current = null;
                    setDraft({ ...draft, [choice.key]: e.target.checked });
                    setMessage('');
                  }}
                />
                <span>
                  <strong>{choice.label}</strong>
                  <small>{choice.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="notification-note">
            {provider
              ? 'Remote alerts are available. Enable device alerts in the iPhone or iPad app after saving your choices.'
              : 'Remote alerts are not configured. Native local due reminders and workout timers can still work.'}{' '}
            Device permission is managed in the native app.
          </p>
          {conflict && (
            <div role="alert">
              <p>
                These choices changed elsewhere. Your draft is still above. The currently saved
                choices are:
              </p>
              <ul>
                {choices.map((choice) => (
                  <li key={choice.key}>
                    {choice.label}: {record.value[choice.key] ? 'On' : 'Off'}
                  </li>
                ))}
              </ul>
              <p>Review your draft, then save it against the current choices.</p>
              <button
                disabled={busy}
                onClick={() => {
                  setDraft(record.value);
                  pending.current = null;
                  setConflict(false);
                }}
              >
                Use saved choices
              </button>
            </div>
          )}
          <button disabled={busy} onClick={() => void save()}>
            {busy
              ? 'Saving…'
              : conflict
                ? 'Save reviewed notification choices'
                : 'Save notification choices'}
          </button>
        </>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {pending.current && (
            <p>
              The save is unconfirmed. Retry checks the same request before changing your choices.
            </p>
          )}
          <button disabled={busy} onClick={() => void (record ? save() : load())}>
            Retry notification settings
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
