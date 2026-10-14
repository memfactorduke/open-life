import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  AgentGrantCreateSchema,
  AgentGrantListSchema,
  AgentGrantIssueResponseSchema,
  AgentGrantRevokeResponseSchema,
  type AgentScope,
} from '@mems-life/domain';
import { DateTimeField } from '../DateTimeField';
import * as Clipboard from 'expo-clipboard';
import type { z } from 'zod';
import { type InstallationClient, RequestRejectedError } from '../client';
import { ScalingText as Text, Action, Body, Card, Field, Heading, Choice, usePalette } from '../ui';

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
const purposes: { value: string; label: string; scopes: AgentScope[] }[] = [
  { value: 'read', label: 'Read only', scopes: ['tasks:read'] },
  { value: 'tasks', label: 'Task assistant', scopes: ['tasks:read', 'tasks:write'] },
  { value: 'workouts', label: 'Workout planner', scopes: ['workouts:read', 'workouts:plan'] },
  { value: 'custom', label: 'Custom', scopes: [] },
];
export function AgentAccess({
  client,
  active = true,
}: {
  client: InstallationClient;
  active?: boolean;
}) {
  const palette = usePalette();
  const [grants, setGrants] = useState<Grant[]>([]),
    [label, setLabel] = useState(''),
    [creating, setCreating] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [purpose, setPurpose] = useState('read'),
    [duration, setDuration] = useState('7'),
    [manual, setManual] = useState(false),
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
  useEffect(() => {
    if (!active) {
      generation.current++;
      setSecret(null);
      setCreating(false);
      setManual(false);
      setNotice('');
    }
  }, [active]);
  async function issue() {
    if (working.current || secret || uncertain) return;
    const parsed = AgentGrantCreateSchema.safeParse({
      operationId: Crypto.randomUUID(),
      label,
      scopes,
      expiresAt:
        duration === 'custom'
          ? expiry
          : new Date(Date.now() + Number(duration) * 86400000).toISOString(),
    });
    if (
      !parsed.success ||
      new Date(parsed.data.expiresAt).getTime() <= Date.now() ||
      new Date(parsed.data.expiresAt).getTime() > Date.now() + 366 * 86400000
    ) {
      setError(
        'Enter a name, choose at least one permission, and set an expiry within the next year with a valid date and time.',
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
  const disabled = busy || !!secret || uncertain;
  return (
    <View style={{ gap: 16 }}>
      <Heading eyebrow="Connections">Agent access</Heading>
      <Body>Choose what an agent can read or change.</Body>
      {error ? <Body error>{error}</Body> : null}
      {notice ? <Body>{notice}</Body> : null}
      {(!creating || uncertain) && (
        <>
          <Action title="Reload grants" secondary disabled={busy} onPress={() => void load()} />
          {loaded && grants.length === 0 ? <Body>No agent access has been issued.</Body> : null}
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
            .map((grant) => (
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
                <Body>{grant.scopes.map(scopeLabel).join(' · ')}</Body>
                {!grant.revokedAt && <Body>Revoking ends this agent’s access.</Body>}
                {grant.revokedAt ? (
                  <Body>
                    Revoked {new Date(grant.revokedAt).toLocaleString()} · history retained
                  </Body>
                ) : (
                  <Action
                    title={`Revoke ${grant.label}`}
                    variant="destructive"
                    disabled={busy}
                    onPress={() => void revoke(grant)}
                  />
                )}
              </Card>
            ))}
        </>
      )}
      {(!creating || uncertain) &&
        grants.some(
          (grant) => grant.revokedAt || new Date(grant.expiresAt).getTime() <= Date.now(),
        ) && (
          <Action
            title={
              showHistory ? 'Hide expired and revoked access' : 'View expired and revoked access'
            }
            secondary
            onPress={() => setShowHistory(!showHistory)}
          />
        )}
      {secret ? (
        <Card>
          <Heading>Set up your agent</Heading>
          <Body>Endpoint</Body>
          <Text selectable style={{ color: palette.text }}>
            {client.baseURL.replace(/\/$/, '')}/mcp
          </Text>
          <Action
            title="Copy endpoint"
            secondary
            onPress={() =>
              void Clipboard.setStringAsync(`${client.baseURL.replace(/\/$/, '')}/mcp`)
                .then(() => setNotice('Endpoint copied.'))
                .catch(() => setError('Select and copy the endpoint manually.'))
            }
          />
          <Body>
            Save this key now. It is shown once and stays active until it expires or you revoke it.
          </Body>
          <Text
            selectable
            accessibilityLabel="One-time agent key"
            style={{ color: palette.text, fontFamily: 'Courier', fontSize: 15 }}
          >
            {secret}
          </Text>
          <Action
            title="Copy key"
            onPress={() =>
              void Clipboard.setStringAsync(secret)
                .then(() => setNotice('Key copied.'))
                .catch(() => setError('Select and copy the key manually.'))
            }
          />
          <Action
            title={manual ? 'Hide manual setup' : 'Manual setup details'}
            secondary
            onPress={() => setManual(!manual)}
          />
          {manual && (
            <Body>
              Use this endpoint in an MCP client that supports custom HTTP headers. Add
              Authorization: Bearer YOUR_KEY in its private credential settings.
            </Body>
          )}
          <Action
            title="Done · hide key"
            secondary
            onPress={() => {
              setSecret(null);
              setCreating(false);
              setManual(false);
              setNotice('Key hidden. It cannot be retrieved again.');
            }}
          />
        </Card>
      ) : null}
      {!secret && !creating && (
        <Action
          title="Add agent"
          disabled={busy || uncertain || !loaded}
          onPress={() => setCreating(true)}
        />
      )}
      {creating && !secret && (
        <Card>
          <Heading>Add agent</Heading>
          <Field
            label="Agent name"
            value={label}
            onChangeText={setLabel}
            maxLength={100}
            editable={!disabled}
            placeholder="For example, workout planner"
          />
          <Choice
            label="Purpose"
            value={purpose}
            disabled={disabled}
            options={purposes.map(({ value, label }) => ({ value, label }))}
            onChange={(value) => {
              setPurpose(value);
              if (value !== 'custom') setScopes(purposes.find((p) => p.value === value)!.scopes);
            }}
          />
          <Body>
            {scopes.length
              ? scopes.map(scopeLabel).join(' · ')
              : 'Choose the permissions this agent needs.'}
          </Body>
          {purpose === 'custom' &&
            groups.map((group) => (
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
                      borderWidth: 1,
                      borderRadius: 12,
                      borderColor: palette.line,
                    }}
                  >
                    <Text style={{ color: palette.text }}>
                      {scopes.includes(option.scope) ? '✓ ' : ''}
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          <Choice
            label="Access duration"
            value={duration}
            disabled={disabled}
            options={[
              { value: '1', label: '1 day' },
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: 'custom', label: 'Custom date' },
            ]}
            onChange={setDuration}
          />
          {duration === 'custom' && (
            <DateTimeField
              label="Access ends"
              value={expiry}
              timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
              nullable={false}
              disabled={disabled}
              onChange={(value) => {
                if (value) setExpiry(value);
              }}
            />
          )}
          <Action
            title="Create one-time key"
            disabled={disabled || !loaded}
            onPress={() => void issue()}
          />
          <Action
            title="Cancel adding agent"
            secondary
            disabled={busy}
            onPress={() => setCreating(false)}
          />
        </Card>
      )}
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
    </View>
  );
}
