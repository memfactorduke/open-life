import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  AttentionResponseSchema,
  latestFoodEntries,
  type AttentionItem,
  type AttentionResponse,
  type Preferences,
} from '@mems-life/domain';
import type { InstallationClient } from '../client';
import { useOfflineRevision } from '../offline-client';
import { Action, Body, Disclosure, ScalingText, usePalette } from '../ui';

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
  not_released: 'Not released',
  paused: 'Paused',
  agent: 'Waiting for an agent.',
  dependencies: 'Waiting for earlier steps.',
  dependency: 'Waiting for an earlier step.',
  agent_failed: 'Review the failed attempt.',
  reconcile_agent_outcome: 'Check the outcome before retrying.',
  review_result: 'Review the agent result.',
  final_review: 'Final review',
};
function reason(item: AttentionItem) {
  return item.waitingReason
    ? (reasons[item.waitingReason] ?? item.waitingReason.replace(/_/g, ' '))
    : item.step
      ? item.task.content.title
      : '';
}

export function Today({
  client,
  onOpen,
  active = true,
}: {
  client: InstallationClient;
  preferences: Preferences;
  onOpen: (target: TodayTarget) => void;
  active?: boolean;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const wide = contentWidth >= 720 && fontScale < 1.5;
  const [data, setData] = useState<AttentionResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
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
  const ready = data?.items.filter((item) => item.kind !== 'waiting') ?? [];
  const waiting = data?.items.filter((item) => item.kind === 'waiting') ?? [];
  const attentionRow = (item: AttentionItem) => (
    <Pressable
      key={item.id}
      accessibilityRole="button"
      accessibilityLabel={`${labels[item.kind]}: ${item.step?.content.title ?? item.task.content.title}`}
      onPress={() => onOpen({ kind: 'task', id: item.task.id })}
      style={[s.row, { borderColor: palette.line }]}
    >
      <View style={s.rowContent}>
        <ScalingText style={[s.itemTitle, { color: palette.text }]}>
          {item.step?.content.title ?? item.task.content.title}
        </ScalingText>
        {!!reason(item) && (
          <ScalingText style={[s.meta, { color: palette.muted }]}>{reason(item)}</ScalingText>
        )}
      </View>
      <ScalingText
        style={[
          s.status,
          {
            color: ['failure', 'outcome-unknown'].includes(item.kind)
              ? palette.error
              : palette.accent,
          },
        ]}
      >
        {labels[item.kind]}
      </ScalingText>
    </Pressable>
  );
  const quickAction = (title: string, onPress: () => void) => (
    <Action title={title} onPress={onPress} compact variant="secondary" />
  );
  return (
    <ScrollView
      contentContainerStyle={[s.page, { backgroundColor: palette.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <View testID="today-header" style={[s.header, fontScale >= 1.5 && s.largeHeader]}>
        <View style={[s.rowContent, fontScale >= 1.5 && s.largeHeaderContent]}>
          <ScalingText accessibilityRole="header" style={[s.title, { color: palette.text }]}>
            Today
          </ScalingText>
          {data && (
            <ScalingText style={[s.meta, { color: palette.muted }]}>
              {new Intl.DateTimeFormat('en', {
                timeZone: data.timezone,
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              }).format(new Date(data.now))}
            </ScalingText>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Today"
          accessibilityState={{ disabled: loading, busy: loading }}
          disabled={loading}
          onPress={() => void refresh()}
          style={s.quick}
        >
          {loading ? (
            <ActivityIndicator color={palette.accent} />
          ) : (
            <ScalingText style={[s.quickText, { color: palette.accent }]}>Refresh</ScalingText>
          )}
        </Pressable>
      </View>
      {loading && !data && <Body>Loading your day…</Body>}
      {error && (
        <View style={s.notice}>
          <Body error>{error}</Body>
          {data && <Body>Showing your last confirmed view. It may have changed.</Body>}
          <Action title="Retry Today" onPress={() => void refresh()} busy={loading} secondary />
        </View>
      )}
      {client.offline?.attentionFromDevice && (
        <Body>Device view · server freshness unverified.</Body>
      )}
      {data?.activeSession && (
        <View style={[s.workout, { backgroundColor: palette.surface, borderColor: palette.line }]}>
          <View style={s.rowContent}>
            <ScalingText style={[s.itemTitle, { color: palette.text }]}>
              {data.activeSession.name}
            </ScalingText>
            <ScalingText style={[s.meta, { color: palette.muted }]}>
              {data.activeSession.items.reduce(
                (count, exercise) =>
                  count + exercise.results.filter((result) => !result.removedAt).length,
                0,
              )}{' '}
              sets recorded
            </ScalingText>
          </View>
          {quickAction('Resume workout', () =>
            onOpen({ kind: 'session', id: data.activeSession!.id }),
          )}
        </View>
      )}
      <View style={s.capture}>
        {quickAction('Capture a task', () => onOpen({ kind: 'task', action: 'create' }))}
        {quickAction('Log food', () => onOpen({ kind: 'food', action: 'capture' }))}
        {!data?.activeSession && quickAction('Start workout', () => onOpen({ kind: 'session' }))}
      </View>
      {data && (
        <View
          testID="today-content"
          onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}
          style={[s.columns, wide && s.wide]}
        >
          <View style={s.focus}>
            <ScalingText
              accessibilityRole="header"
              style={[s.sectionTitle, { color: palette.text }]}
            >
              Needs you{ready.length ? ` · ${ready.length}` : ''}
            </ScalingText>
            {ready.length ? ready.map(attentionRow) : <Body>Nothing needs your attention.</Body>}
            {!!waiting.length && (
              <Disclosure title={`Waiting · ${waiting.length}`}>
                {waiting.map(attentionRow)}
              </Disclosure>
            )}
          </View>
          <View style={s.food}>
            <View style={s.header}>
              <ScalingText
                accessibilityRole="header"
                style={[s.sectionTitle, { color: palette.text }]}
              >
                Food today · {data.food.count}
              </ScalingText>
              {quickAction('Add food entry', () => onOpen({ kind: 'food', action: 'capture' }))}
            </View>
            {!data.food.count && <Body>No entries yet.</Body>}
            {latestFoodEntries(data.food.entries).map((entry) => (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={`Open food: ${entry.content.text.trim() || 'Photo entry'}`}
                onPress={() => onOpen({ kind: 'food', id: entry.id })}
                style={[s.row, { borderColor: palette.line }]}
              >
                <ScalingText style={[s.itemTitle, s.rowContent, { color: palette.text }]}>
                  {entry.content.text.trim() || 'Photo entry'}
                </ScalingText>
                <ScalingText style={[s.meta, { color: palette.muted }]}>
                  {new Intl.DateTimeFormat('en', {
                    timeZone: data.timezone,
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(entry.content.occurredAt))}
                </ScalingText>
              </Pressable>
            ))}
            {data.food.count > 3 && quickAction('View food diary', () => onOpen({ kind: 'food' }))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  page: { padding: 20, gap: 20, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  largeHeader: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  largeHeaderContent: { flex: 0, width: '100%' },
  title: { fontSize: 32, fontWeight: '700' },
  sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  itemTitle: { fontSize: 17, lineHeight: 24, fontWeight: '500' },
  meta: { fontSize: 14, lineHeight: 21 },
  status: { fontSize: 13, lineHeight: 19, maxWidth: 130, flexShrink: 1 },
  quick: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    justifyContent: 'center',
  },
  quickText: { fontSize: 15, fontWeight: '600' },
  capture: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  workout: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  row: {
    minHeight: 60,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowContent: { flex: 1, minWidth: 0 },
  notice: { gap: 8 },
  columns: { gap: 24 },
  wide: { flexDirection: 'row', alignItems: 'flex-start' },
  focus: { flex: 1, minWidth: 0 },
  food: { flex: 1, minWidth: 0 },
});
