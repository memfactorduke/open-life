import React, { useEffect, useState } from 'react';
import { View, Alert } from 'react-native';
import {
  WhoopStateSchema,
  WhoopCommandSchema,
  WhoopCommandResponseSchema,
  type WhoopState,
  SessionListSchema,
  type WorkoutSession,
} from '@mems-life/domain';
import * as WebBrowser from 'expo-web-browser';
import type { InstallationClient } from '../client';
import { Action, Body, Card, Heading, Choice } from '../ui';
import { useCommand, messageOf } from './helpers';
export function Whoop({ client }: { client: InstallationClient }) {
  const [state, setState] = useState<WhoopState | null>(null);
  const command = useCommand(client);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [details, setDetails] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  async function load() {
    try {
      setState(WhoopStateSchema.parse(await client.request('/api/whoop')));
    } catch (e) {
      command.setError(messageOf(e));
    }
  }
  useEffect(() => {
    void load();
    void client
      .request('/api/sessions?limit=100')
      .then((r) => setSessions(SessionListSchema.parse(r).sessions))
      .catch(() => {});
  }, [client]);
  async function act(type: string) {
    if (!state) return;
    const result = await command.send(
      '/api/whoop/commands',
      {
        type,
        ...(type === 'whoop.connect' ? { channel: 'native' } : {}),
        expectedRevision: state.revision,
      },
      WhoopCommandResponseSchema.parse,
      WhoopCommandSchema.parse,
    );
    if (result) {
      setState(result.state);
      if (result.authorizationUrl) {
        try {
          const browser = await WebBrowser.openAuthSessionAsync(
            result.authorizationUrl,
            'memslife://whoop-callback',
          );
          if (browser.type === 'success') {
            const url = new URL(browser.url);
            if (
              url.protocol !== 'memslife:' ||
              url.hostname !== 'whoop-callback' ||
              url.searchParams.get('state') !==
                new URL(result.authorizationUrl).searchParams.get('state')
            )
              throw new Error('Unexpected WHOOP return URL.');
            await client.request(
              '/api/whoop/callback',
              { state: url.searchParams.get('state'), code: url.searchParams.get('code') },
              'POST',
            );
            await load();
          }
        } catch (error) {
          command.setError(messageOf(error));
        }
      }
      if (result.revocation === 'failed')
        command.setError(
          'Disconnected locally. Remove access in WHOOP settings because remote revocation failed.',
        );
    }
  }
  async function observationChange(body: Record<string, unknown>) {
    if (!state) return;
    const result = await command.send(
      '/api/whoop/commands',
      { ...body, expectedRevision: state.revision },
      WhoopCommandResponseSchema.parse,
      WhoopCommandSchema.parse,
    );
    if (result) setState(result.state);
  }
  return (
    <View style={{ gap: 16 }}>
      <Heading>WHOOP</Heading>
      <Body>Training and recovery context from WHOOP.</Body>
      {command.error ? <Body>{command.error}</Body> : null}
      <Action title="Reload WHOOP" variant="quiet" onPress={() => void load()} />
      {state ? (
        <>
          <Card>
            <Body>
              {state.status === 'connected'
                ? 'Connected'
                : state.status === 'disconnected'
                  ? 'Not connected'
                  : state.status === 'reconnect'
                    ? 'Sign in again'
                    : 'Not set up'}
              {state.stale && state.observations.length > 0
                ? ' · saved observations need a refresh'
                : ''}
            </Body>
            {state.lastSuccessAt && (
              <Body>Updated {new Date(state.lastSuccessAt).toLocaleString()}</Body>
            )}
            {state.error ? <Body>{state.error}</Body> : null}

            {state.configured ? (
              <>
                <Action
                  title={state.status === 'connected' ? 'Change WHOOP account' : 'Connect WHOOP'}
                  disabled={command.busy}
                  onPress={() => void act('whoop.connect')}
                />
                {state.status === 'connected' ? (
                  <Action
                    title="Refresh observations"
                    disabled={
                      command.busy ||
                      (!!state.nextRefreshAt && new Date(state.nextRefreshAt) > new Date())
                    }
                    onPress={() => void act('whoop.refresh')}
                  />
                ) : null}
                {state.status !== 'disconnected' ? (
                  <Action
                    title="Disconnect WHOOP"
                    disabled={command.busy}
                    secondary
                    onPress={() =>
                      Alert.alert(
                        'Disconnect WHOOP?',
                        'Local workouts and saved WHOOP observations remain.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Disconnect',
                            style: 'destructive',
                            onPress: () => void act('whoop.disconnect'),
                          },
                        ],
                      )
                    }
                  />
                ) : null}
                {details && state.observations.length ? (
                  <Action
                    title="Delete cached WHOOP observations"
                    variant="destructive"
                    disabled={command.busy}
                    onPress={() =>
                      Alert.alert('Delete WHOOP cache?', 'Local workouts remain.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete cache',
                          style: 'destructive',
                          onPress: () => void act('whoop.delete-cache'),
                        },
                      ])
                    }
                  />
                ) : null}
              </>
            ) : (
              <Body>WHOOP cannot connect until it is set up for this installation.</Body>
            )}
          </Card>
          <Action
            title={
              details
                ? 'Hide saved observations'
                : `View saved observations (${state.observations.length})`
            }
            secondary
            onPress={() => setDetails(!details)}
          />
          {details &&
            state.observations.map((o) => (
              <Card key={`${o.accountId}:${o.resource}:${o.providerId}`}>
                <Body>
                  WHOOP {o.resource} · account {o.providerAccountId}
                </Body>
                <Body>
                  {o.currentAccount
                    ? 'Current connection'
                    : 'Retained disconnected or previous account'}
                </Body>
                <Body>
                  {o.start ?? 'Interval unavailable'} — {o.end ?? 'Ongoing or unavailable'} ·{' '}
                  {o.timezoneOffset ?? 'Time zone unavailable'}
                </Body>
                <Body>{o.available ? o.scoreState : 'Provider observation unavailable'}</Body>
                <Body>
                  {o.score
                    ? Object.entries(o.score)
                        .filter(([, v]) => typeof v === 'number')
                        .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${v}`)
                        .join('\n')
                    : 'Missing or unscored values are unavailable, not zero.'}
                </Body>
                <Body>
                  Retrieved {o.retrievedAt}; provider updated {o.providerUpdatedAt}
                </Body>
                {o.linkedSessionId ? <Body>Linked session {o.linkedSessionId}</Body> : null}
                {o.currentAccount ? (
                  <>
                    <Action
                      title="Recheck this observation"
                      disabled={command.busy}
                      onPress={() =>
                        void observationChange({
                          type: 'whoop.refresh-observation',
                          resource: o.resource,
                          providerId: o.providerId,
                        })
                      }
                    />
                    {o.resource === 'workout' && o.available ? (
                      <>
                        <Choice
                          label="Choose a local session to link explicitly"
                          value={selected[o.providerId] ?? ''}
                          onChange={(value) => setSelected({ ...selected, [o.providerId]: value })}
                          options={[
                            { value: '', label: 'Select session' },
                            ...sessions.map((session) => ({
                              value: session.id,
                              label: `${session.name} · ${new Date(session.startedAt).toLocaleString()}`,
                            })),
                          ]}
                        />
                        <Action
                          title="Link selected session"
                          disabled={command.busy || !selected[o.providerId]}
                          onPress={() =>
                            void observationChange({
                              type: 'whoop.link',
                              providerId: o.providerId,
                              sessionId: selected[o.providerId],
                            })
                          }
                        />
                        {o.linkedSessionId ? (
                          <Action
                            title="Unlink session"
                            disabled={command.busy}
                            onPress={() =>
                              void observationChange({
                                type: 'whoop.link',
                                providerId: o.providerId,
                                sessionId: null,
                              })
                            }
                          />
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}
              </Card>
            ))}
        </>
      ) : null}
    </View>
  );
}
