import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  AgentGrantCreateSchema,
  AgentGrantListSchema,
  AgentGrantIssueResponseSchema,
  AgentGrantRevokeResponseSchema,
  type AgentScope,
} from '@mems-life/domain';
import type { z } from 'zod';
import { type InstallationClient, RequestRejectedError } from '../client';
import { Action, Body, Card, Field, Heading, usePalette } from '../ui';

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
export function AgentAccess({ client }: { client: InstallationClient }) {
  const palette = usePalette();
  const [grants, setGrants] = useState<Grant[]>([]),
    [label, setLabel] = useState(''),
    [scopes, setScopes] = useState<AgentScope[]>(['tasks:read']),
    [expiry, setExpiry] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString()),
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
      setGrants(AgentGrantListSchema.parse(await client.request('/api/agent-grants')).grants);
      setLoaded(true);
    } catch (e) {
      setLoaded(false);
      setError(e instanceof Error ? e.message : 'Agent access could not load.');
    }
  }
  useEffect(() => {
    void load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        generation.current++;
        setSecret(null);
        setNotice('');
      }
    });
    return () => {
      generation.current++;
      subscription.remove();
    };
  }, [client]);
  async function issue() {
    if (working.current || secret || uncertain) return;
    const parsed = AgentGrantCreateSchema.safeParse({
      operationId: Crypto.randomUUID(),
      label,
      scopes,
      expiresAt: expiry,
    });
    if (
      !parsed.success ||
      new Date(parsed.data.expiresAt).getTime() <= Date.now() ||
      new Date(parsed.data.expiresAt).getTime() > Date.now() + 366 * 86400000
    ) {
      setError(
        'Enter a name, choose at least one permission, and set an expiry within the next year using the UTC format shown.',
      );
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const current = generation.current;
    try {
      const result = AgentGrantIssueResponseSchema.parse(
        await client.request('/api/agent-grants', parsed.data, 'POST'),
      );
      if (current === generation.current) {
        revealedGrantId.current = result.grant.id;
        setSecret(result.secret);
      } else {
        setUncertain(true);
        setError(
          'The key was hidden before delivery. Review grants, revoke this grant and create a replacement.',
        );
      }
    } catch (e) {
      if (
        e instanceof RequestRejectedError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 409
      )
        setError(e.message);
      else {
        setUncertain(true);
        setError(
          'The key could not be retrieved. A grant may have been created. Review grants, revoke the unused grant, then create a replacement. The same request cannot retrieve its key.',
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
    const operationId = revokeOperations.current.get(grant.id) ?? Crypto.randomUUID();
    revokeOperations.current.set(grant.id, operationId);
    try {
      AgentGrantRevokeResponseSchema.parse(
        await client.request(
          '/api/agent-grants/revoke',
          { operationId, grantId: grant.id },
          'POST',
        ),
      );
      if (revealedGrantId.current === grant.id) setSecret(null);
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
  const disabled = busy || !!secret || uncertain;
  return (
    <View style={{ gap: 16 }}>
      <Heading eyebrow="Your external assistants">Agent access</Heading>
      <Body>
        Give a client only the permissions it needs. Access ends at expiry or when you revoke it.
      </Body>
      {error ? <Body error>{error}</Body> : null}
      {notice ? <Body>{notice}</Body> : null}
      {secret ? (
        <Card>
          <Heading>Copy this key now</Heading>
          <Body>
            This is its only display. Touch and hold the key to copy it to your client's private
            credential configuration. Leaving this screen or hiding the app clears the display; the
            key remains active until expiry or revocation.
          </Body>
          <Text
            selectable
            accessibilityLabel="One-time agent key"
            style={{ color: palette.text, fontFamily: 'Courier', fontSize: 15 }}
          >
            {secret}
          </Text>
          <Action
            title="Done · hide key"
            onPress={() => {
              setSecret(null);
              setNotice('Key hidden. It cannot be retrieved again.');
            }}
          />
        </Card>
      ) : null}
      <Card>
        <Body>Connect your MCP client</Body>
        <Text selectable style={{ color: palette.text }}>
          {client.baseURL.replace(/\/$/, '')}/mcp
        </Text>
        <Body>
          Configure the HTTP header Authorization: Bearer YOUR_KEY privately in a client that
          supports custom headers. Do not put the key in a URL or shared content. This connection
          uses manual credentials.
        </Body>
      </Card>
      <Card>
        <Body>Create agent access</Body>
        <Field
          label="Agent name"
          value={label}
          onChangeText={setLabel}
          maxLength={100}
          editable={!disabled}
        />
        <Field
          label="Expires at (UTC)"
          value={expiry}
          onChangeText={setExpiry}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[1, 7, 30].map((days) => (
            <Action
              key={days}
              title={`${days} ${days === 1 ? 'day' : 'days'}`}
              secondary
              disabled={disabled}
              onPress={() => setExpiry(new Date(Date.now() + days * 86400000).toISOString())}
            />
          ))}
        </View>
        <Body>
          Use YYYY-MM-DDTHH:mm:ss.sssZ. The default is seven days; choose a shorter time for a
          one-off task.
        </Body>
        {groups.map((group) => (
          <View key={group.title} style={{ gap: 8 }}>
            <Body>{group.title}</Body>
            {group.options.map((option) => (
              <Pressable
                key={option.scope}
                accessibilityRole="checkbox"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: scopes.includes(option.scope), disabled }}
                disabled={disabled}
                onPress={() =>
                  setScopes(
                    scopes.includes(option.scope)
                      ? scopes.filter((scope) => scope !== option.scope)
                      : [...scopes, option.scope],
                  )
                }
                style={{
                  minHeight: 48,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: palette.line,
                  backgroundColor: scopes.includes(option.scope) ? palette.accent : palette.surface,
                }}
              >
                <Text
                  style={{
                    color: scopes.includes(option.scope) ? palette.accentText : palette.text,
                  }}
                >
                  {scopes.includes(option.scope) ? '✓ ' : ''}
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
        <Action
          title="Create one-time key"
          disabled={disabled || !loaded}
          onPress={() => void issue()}
        />
      </Card>
      {uncertain ? (
        <Action
          title="I reviewed grants; create a replacement"
          disabled={busy || !loaded}
          onPress={() => {
            setUncertain(false);
            setError('');
          }}
        />
      ) : null}
      <Action title="Reload grants" secondary disabled={busy} onPress={() => void load()} />
      {loaded && grants.length === 0 ? <Body>No agent access has been issued.</Body> : null}
      {grants.map((grant) => (
        <Card key={grant.id}>
          <Body>{grant.label}</Body>
          <Body>
            {grant.revokedAt
              ? 'Revoked'
              : new Date(grant.expiresAt).getTime() <= Date.now()
                ? 'Expired'
                : 'Active'}{' '}
            · expires {new Date(grant.expiresAt).toLocaleString()}
          </Body>
          <Body>Created {new Date(grant.createdAt).toLocaleString()}</Body>
          <Body>{grant.scopes.map(scopeLabel).join('\n')}</Body>
          {grant.revokedAt ? (
            <Body>Revoked {new Date(grant.revokedAt).toLocaleString()} · history retained</Body>
          ) : (
            <Action
              title={`Revoke ${grant.label}`}
              disabled={busy}
              onPress={() => void revoke(grant)}
            />
          )}
        </Card>
      ))}
    </View>
  );
}
