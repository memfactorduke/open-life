import React, { useEffect, useRef, useState } from 'react';
import { Switch, View, StyleSheet } from 'react-native';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import {
  defaultNotificationPreferences,
  NotificationPreferencesRecordSchema,
  type NotificationPreferences,
} from '@mems-life/domain';
import { RequestRejectedError, type InstallationClient } from '../client';
import { registerRemoteNotifications } from '../notifications';
import { ScalingText as Text, Action, Body, Card, usePalette } from '../ui';
const Response = NotificationPreferencesRecordSchema.extend({ providerConfigured: z.boolean() });
type Record = z.infer<typeof NotificationPreferencesRecordSchema>;
const choices: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: 'enabled',
    label: 'Enable notifications',
    description: 'Optional alerts on your signed-in devices.',
  },
  { key: 'due', label: 'Due reminders', description: 'Ready human work when it is due.' },
  {
    key: 'handoff',
    label: 'Ready for you',
    description: 'Agent handoffs and results needing review.',
  },
  { key: 'failure', label: 'Work needs help', description: 'Failed or uncertain agent work.' },
];
export function NotificationSettings({
  client,
  onSaved,
}: {
  client: InstallationClient;
  onSaved?: (record: Record) => void | Promise<void>;
}) {
  const palette = usePalette();
  const [record, setRecord] = useState<Record | null>(null);
  const [draft, setDraft] = useState(defaultNotificationPreferences);
  const [provider, setProvider] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const working = useRef(false);
  const pending = useRef<{
    operationId: string;
    expectedRevision: number;
    value: NotificationPreferences;
  } | null>(null);
  async function load() {
    setBusy(true);
    try {
      const value = Response.parse(await client.request('/api/notifications/preferences'));
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
  }, [client]);
  async function save() {
    if (!record || working.current) return;
    working.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    const command = pending.current ?? {
      operationId: Crypto.randomUUID(),
      expectedRevision: record.revision,
      value: { ...draft },
    };
    pending.current = command;
    try {
      const saved = NotificationPreferencesRecordSchema.parse(
        await client.request('/api/notifications/preferences', command),
      );
      setRecord(saved);
      setDraft(saved.value);
      setConflict(false);
      pending.current = null;
      setMessage('Notification choices saved.');
      if (saved.value.enabled) await enableDevice(saved);
      else await onSaved?.(saved);
    } catch (e) {
      if (
        e instanceof RequestRejectedError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 409
      )
        pending.current = null;
      if (e instanceof RequestRejectedError && e.status === 409) {
        pending.current = null;
        try {
          const latest = Response.parse(await client.request('/api/notifications/preferences'));
          setRecord(latest);
          setProvider(latest.providerConfigured);
          setConflict(true);
        } catch {
          setError('The saved choices changed, and could not be refreshed. Retry when connected.');
        }
      } else setError(e instanceof Error ? e.message : 'Notification choices could not be saved.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function enableDevice(saved: Record) {
    setError('');
    setMessage('');
    try {
      const status = await registerRemoteNotifications({
        installation: client.baseURL,
        preferences: saved,
        providerConfigured: provider,
        api: {
          register: (body) => client.request('/api/notifications/devices', body, 'POST'),
          deactivate: async () => undefined,
        },
      });
      setMessage(
        status ||
          'This device is registered for remote alerts. Delivery still depends on the configured provider.',
      );
      await onSaved?.(saved);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Device alerts could not be enabled. Retry when connected.',
      );
    }
  }
  return (
    <Card>
      <Text accessibilityRole="header" style={[s.title, { color: palette.text }]}>
        Notifications
      </Text>
      <Body>Remind me when something needs me.</Body>
      {!record && !error && <Body>Loading notification choices…</Body>}
      {record && (
        <>
          {choices
            .filter((choice) => choice.key === 'enabled' || draft.enabled)
            .map((choice) => (
              <View key={choice.key} style={s.choice}>
                <View style={s.copy}>
                  <Text style={[s.label, { color: palette.text }]}>{choice.label}</Text>
                  <Body>{choice.description}</Body>
                </View>
                <Switch
                  accessibilityLabel={choice.label}
                  disabled={busy || !!pending.current}
                  value={draft[choice.key]}
                  onValueChange={(value) => {
                    pending.current = null;
                    setDraft({ ...draft, [choice.key]: value });
                    setMessage('');
                  }}
                />
              </View>
            ))}
          <Body>
            {provider
              ? 'Remote alerts are configured for this installation.'
              : 'Remote alerts are unavailable. Local reminders and workout timers remain available.'}
          </Body>
          {conflict && (
            <>
              <Body error>
                These choices changed elsewhere. Your draft is retained above. Currently saved:
              </Body>
              {choices.map((choice) => (
                <Body key={choice.key}>
                  {choice.label}: {record.value[choice.key] ? 'On' : 'Off'}
                </Body>
              ))}
              <Body>Review your draft before saving against the current choices.</Body>
              <Action
                title="Use saved choices"
                secondary
                disabled={busy}
                onPress={() => {
                  setDraft(record.value);
                  pending.current = null;
                  setConflict(false);
                }}
              />
            </>
          )}
          <Action
            title={conflict ? 'Save reviewed notification choices' : 'Save notification choices'}
            busy={busy}
            onPress={() => void save()}
          />
        </>
      )}
      {error && (
        <>
          <Body error>{error}</Body>
          {pending.current && (
            <Body>
              The save is unconfirmed. Retry checks the same request before changing your choices.
            </Body>
          )}
          <Action
            title="Retry notification settings"
            secondary
            busy={busy}
            onPress={() => void (record ? save() : load())}
          />
        </>
      )}
      {message && <Body>{message}</Body>}
    </Card>
  );
}
const s = StyleSheet.create({
  title: { fontSize: 23, fontWeight: '700' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  copy: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
});
