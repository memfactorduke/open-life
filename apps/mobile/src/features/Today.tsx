import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  AttentionResponseSchema,
  type AttentionItem,
  type AttentionResponse,
  type Preferences,
} from '@mems-life/domain';
import type { InstallationClient } from '../client';
import { useOfflineRevision } from '../offline-client';
import { Action, Body, Card, Heading, usePalette } from '../ui';

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
function reason(item: AttentionItem) {
  return item.waitingReason
    ? (reasons[item.waitingReason] ?? item.waitingReason.replace(/_/g, ' '))
    : item.step
      ? 'This step is ready for you.'
      : 'Open this task to continue.';
}

export function Today({
  client,
  preferences,
  onOpen,
  active = true,
}: {
  client: InstallationClient;
  preferences: Preferences;
  onOpen: (target: TodayTarget) => void;
  active?: boolean;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [data, setData] = useState<AttentionResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const generation = useRef(0);
  const offlineRevision = useOfflineRevision(client);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const response = AttentionResponseSchema.parse(await client.request('/api/attention'));
      if (current === generation.current) {
        setData(response);
        setError('');
      }
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : 'Today could not be refreshed.');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      generation.current++;
      listener.remove();
    };
  }, [active, refresh, offlineRevision]);
  const chosen = data?.items.find((i) => i.id === selected) ?? data?.items[0];
  const ready = data?.items.filter((i) => i.kind !== 'waiting').length ?? 0;
  const nextAction = data?.items.find((i) => i.kind !== 'waiting');
  const detail = chosen && (
    <View style={[s.detail, { backgroundColor: palette.background }]}>
      <Text style={[s.tag, { color: palette.accent }]}>{labels[chosen.kind]}</Text>
      <Text accessibilityRole="header" style={[s.itemTitle, { color: palette.text }]}>
        {chosen.step?.content.title ?? chosen.task.content.title}
      </Text>
      <Body>{reason(chosen)}</Body>
      {chosen.task.schedule.dueAt && (
        <Body>
          Due{' '}
          {new Intl.DateTimeFormat('en', {
            timeZone: preferences.timeZone,
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }).format(new Date(chosen.task.schedule.dueAt))}
        </Body>
      )}
      <Action title="Open task" onPress={() => onOpen({ kind: 'task', id: chosen.task.id })} />
    </View>
  );
  return (
    <ScrollView
      contentContainerStyle={[s.page, { backgroundColor: palette.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <View>
        <Heading eyebrow="Your daily focus">Today</Heading>
        <Text style={[s.greeting, { color: palette.text }]} numberOfLines={2} ellipsizeMode="tail">
          Hello, {preferences.displayName}.
        </Text>
        <Body>
          {data
            ? new Intl.DateTimeFormat('en', {
                timeZone: data.timezone,
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              }).format(new Date(data.now))
            : 'A little space to see what comes next.'}
        </Body>
      </View>
      {loading && !data && (
        <View accessibilityLabel="Loading your day" style={s.loading}>
          <ActivityIndicator color={palette.accent} />
          <Body>Loading your day…</Body>
        </View>
      )}
      {error && (
        <Card>
          <Body error>{error}</Body>
          {data && <Body>Showing your last confirmed view. It may have changed.</Body>}
          <Action title="Retry Today" onPress={() => void refresh()} busy={loading} secondary />
        </Card>
      )}
      {client.offline?.attentionFromDevice && (
        <Body>
          Device view · server freshness is unverified. Pending changes stay on this device until
          sync confirms them.
        </Body>
      )}
      <View style={s.capture}>
        <View style={s.captureAction}>
          <Action
            title="Capture a task"
            onPress={() => onOpen({ kind: 'task', action: 'create' })}
          />
        </View>
        <View style={s.captureAction}>
          <Action
            title="Log food"
            onPress={() => onOpen({ kind: 'food', action: 'capture' })}
            secondary
          />
        </View>
      </View>
      {data?.activeSession && (
        <Action
          title="Resume workout"
          onPress={() => onOpen({ kind: 'session', id: data.activeSession!.id })}
        />
      )}
      {nextAction && (
        <Card>
          <Text style={[s.tag, { color: palette.accent }]}>{labels[nextAction.kind]}</Text>
          <Text style={[s.itemTitle, { color: palette.text }]} numberOfLines={2}>
            {nextAction.step?.content.title ?? nextAction.task.content.title}
          </Text>
          <Action
            title="Continue task"
            onPress={() => onOpen({ kind: 'task', id: nextAction.task.id })}
          />
        </Card>
      )}
      {data && (
        <View style={[s.columns, wide && s.wide]}>
          <View style={s.focus}>
            <Card>
              <Text accessibilityRole="header" style={[s.sectionTitle, { color: palette.text }]}>
                What needs you
              </Text>
              {data.items.length === 0 ? (
                <>
                  <Text style={[s.itemTitle, { color: palette.text }]}>A clear place to start</Text>
                  <Body>
                    Capture a task, log a meal, or open Workouts to plan your next session.
                  </Body>
                </>
              ) : (
                <>
                  <Body>
                    {ready} {ready === 1 ? 'action needs' : 'actions need'} your attention ·{' '}
                    {data.items.length - ready} waiting
                  </Body>
                  {!wide && detail}
                  <View style={s.list}>
                    {data.items.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${labels[item.kind]}: ${item.step?.content.title ?? item.task.content.title}`}
                        accessibilityState={{ selected: chosen?.id === item.id }}
                        onPress={() => setSelected(item.id)}
                        style={[
                          s.row,
                          {
                            borderColor: chosen?.id === item.id ? palette.accent : palette.line,
                            backgroundColor: palette.surface,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            s.tag,
                            {
                              color:
                                item.kind === 'failure' || item.kind === 'outcome-unknown'
                                  ? palette.error
                                  : palette.accent,
                            },
                          ]}
                        >
                          {labels[item.kind]}
                        </Text>
                        <Text style={[s.itemTitle, { color: palette.text }]}>
                          {item.step?.content.title ?? item.task.content.title}
                        </Text>
                        {item.step && <Body>{item.task.content.title}</Body>}
                        <Body>{reason(item)}</Body>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </Card>
          </View>
          <View style={[s.side, wide && s.wideSide]}>
            {wide && detail}
            <Card>
              <Text style={[s.tag, { color: palette.muted }]}>TRAINING</Text>
              <Text accessibilityRole="header" style={[s.sectionTitle, { color: palette.text }]}>
                {data.activeSession ? 'Workout in progress' : 'Room for movement'}
              </Text>
              {data.activeSession ? (
                <>
                  <Body>{data.activeSession.name}</Body>
                  <Body>
                    {data.activeSession.items.reduce(
                      (count, exercise) => count + exercise.results.length,
                      0,
                    )}{' '}
                    sets recorded
                  </Body>
                  <Action
                    title={`Resume ${data.activeSession.name}`}
                    onPress={() => onOpen({ kind: 'session', id: data.activeSession!.id })}
                  />
                </>
              ) : (
                <>
                  <Body>No active workout.</Body>
                  <Action
                    title="Open Workouts"
                    onPress={() => onOpen({ kind: 'session' })}
                    secondary
                  />
                </>
              )}
            </Card>
            <Card>
              <Text style={[s.tag, { color: palette.muted }]}>FOOD DIARY</Text>
              <Text accessibilityRole="header" style={[s.sectionTitle, { color: palette.text }]}>
                Food today
              </Text>
              <Body>
                {data.food.count === 0
                  ? 'Your diary is ready for your first entry.'
                  : `${data.food.count} ${data.food.count === 1 ? 'entry' : 'entries'} recorded`}
              </Body>
              {data.food.entries.map((entry) => (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open food: ${entry.content.text.trim() || 'Photo entry'}`}
                  onPress={() => onOpen({ kind: 'food', id: entry.id })}
                  style={[s.row, { borderColor: palette.line }]}
                >
                  <Text style={[s.itemTitle, { color: palette.text }]}>
                    {entry.content.text.trim() || 'Photo entry'}
                  </Text>
                  <Body>
                    {new Intl.DateTimeFormat('en', {
                      timeZone: data.timezone,
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(entry.content.occurredAt))}
                  </Body>
                </Pressable>
              ))}
              <Action
                title="Add a food entry"
                onPress={() => onOpen({ kind: 'food', action: 'capture' })}
                secondary
              />
            </Card>
          </View>
        </View>
      )}
      <Action title="Refresh Today" onPress={() => void refresh()} busy={loading} secondary />
    </ScrollView>
  );
}
const s = StyleSheet.create({
  page: { padding: 20, gap: 20, paddingBottom: 40 },
  greeting: { fontSize: 22, lineHeight: 30, fontWeight: '600', flexShrink: 1, marginBottom: 8 },
  loading: { flexDirection: 'row', gap: 12 },
  capture: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  captureAction: { flex: 1, minWidth: 140 },
  columns: { gap: 20 },
  wide: { flexDirection: 'row', alignItems: 'flex-start' },
  focus: { flex: 1, minWidth: 0 },
  side: { gap: 20 },
  wideSide: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  itemTitle: { fontSize: 17, lineHeight: 25, fontWeight: '600', flexShrink: 1 },
  tag: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  list: { gap: 12 },
  row: { minHeight: 60, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  detail: { borderRadius: 16, padding: 18, gap: 12 },
});
