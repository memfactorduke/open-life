import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { File, Paths } from 'expo-file-system';
import {
  MeSchema,
  AttentionResponseSchema,
  NotificationPreferencesRecordSchema,
  TaskResponseSchema,
  SessionResponseSchema,
  FoodListResponseSchema,
  PreferencesSchema,
  PreferencesRecordSchema,
  type MeResponse,
  type Preferences,
  type PreferencesCommand,
  type PreferencesRecord,
} from '@mems-life/domain';
import { createInstallationClient, SessionExpiredError, type InstallationClient } from './client';
import { normalizeInstallationUrl } from './installation';
import { loadInstallationSession, verifiedSessionKey } from './session-bootstrap';
import { Tasks } from './features/Tasks';
import { Workouts } from './features/Workouts';
import { Sessions } from './features/Sessions';
import { Food } from './features/Food';
import { Whoop } from './features/Whoop';
import { AgentAccess } from './features/AgentAccess';
import { NotificationSettings } from './features/NotificationSettings';
import {
  clearNotificationsOnLogout,
  reconcileDueNotifications,
  resolveNotificationResponse,
} from './notifications';
import { reconcileTimerAlert } from './timers';
import { createOfflineClient } from './offline-client';
import { SyncStatus } from './SyncStatus';
import { Today, type TodayTarget } from './features/Today';
import {
  Action,
  Body,
  Card,
  Choice,
  dark,
  Field,
  Heading,
  light,
  ThemeContext,
  usePalette,
} from './ui';

const installationKey = 'memslife_active_installation';
type Session = {
  me: MeResponse;
  preferences: PreferencesRecord;
  authentication?: 'verified' | 'offline';
};

async function reconcileOwnerNotifications(
  client: InstallationClient,
  active: () => boolean = () => true,
) {
  const [attention, raw] = await Promise.all([
    client.request('/api/attention'),
    client.request('/api/notifications/preferences'),
  ]);
  const record = raw as { revision: unknown; value: unknown };
  const preferences = NotificationPreferencesRecordSchema.parse({
    revision: record.revision,
    value: record.value,
  });
  if (!active()) return;
  await reconcileDueNotifications({
    installation: client.baseURL,
    attention: AttentionResponseSchema.parse(attention),
    preferences: preferences.value,
    authenticated: true,
  });
}
function notificationApi(client: InstallationClient) {
  return {
    register: (input: { deviceId: string; token: string; expectedPreferenceRevision: number }) =>
      client.request('/api/notifications/devices', input, 'POST'),
    deactivate: (id: string) =>
      client.request(`/api/notifications/devices/${id}`, undefined, 'DELETE'),
  };
}
type Access =
  | { kind: 'loading' }
  | { kind: 'signedOut'; message?: string }
  | { kind: 'signedIn'; session: Session };
type Area = 'Today' | 'Tasks' | 'Workouts' | 'Food' | 'Settings';
const areas: readonly Area[] = ['Today', 'Tasks', 'Workouts', 'Food', 'Settings'];

export default function App() {
  return (
    <SafeAreaProvider>
      <Installation />
    </SafeAreaProvider>
  );
}

function Installation() {
  const [client, setClient] = useState<InstallationClient | null>(null);
  const [access, setAccess] = useState<Access>({ kind: 'loading' });
  const [retainedDraft, setRetainedDraft] = useState<{ origin: string; value: Preferences } | null>(
    null,
  );
  const appearance = useColorScheme();
  const preference = access.kind === 'signedIn' ? access.session.preferences.value.theme : 'system';
  const palette =
    preference === 'dark' || (preference === 'system' && appearance === 'dark') ? dark : light;

  async function refresh(current: InstallationClient) {
    try {
      const session = await loadInstallationSession(current, SecureStore);
      const editableClient = await createOfflineClient(
        current.offline?.base ?? current,
        { installationId: session.me.installationId, ownerId: session.me.user.id },
        { resumeOffline: session.authentication === 'offline' },
      );
      setClient(editableClient);
      setAccess({ kind: 'signedIn', session });
    } catch (error) {
      if (error instanceof SessionExpiredError)
        await SecureStore.deleteItemAsync(verifiedSessionKey(current.baseURL));
      setAccess({
        kind: 'signedOut',
        message: error instanceof SessionExpiredError ? undefined : messageOf(error),
      });
    }
  }

  useEffect(() => {
    if (access.kind !== 'signedIn') return;
    return client?.offline?.start();
  }, [client, access.kind]);

  useEffect(() => {
    if (access.kind !== 'signedIn' || !client?.offline) return;
    const offline = client.offline;
    return offline.subscribe(() => {
      if (offline.needsSignIn) void SecureStore.deleteItemAsync(verifiedSessionKey(client.baseURL));
      if (offline.needsSignIn)
        setAccess({
          kind: 'signedOut',
          message: 'Sign in again. Your saved local changes remain on this device.',
        });
    });
  }, [client, access.kind]);

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(installationKey)
      .then((saved) => {
        if (!active) return;
        if (!saved) {
          setAccess({ kind: 'signedOut' });
          return;
        }
        try {
          const current = createInstallationClient(normalizeInstallationUrl(saved));
          setClient(current);
          void refresh(current);
        } catch (error) {
          setAccess({ kind: 'signedOut', message: messageOf(error) });
        }
      })
      .catch((error) => {
        if (active) setAccess({ kind: 'signedOut', message: messageOf(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && client && access.kind === 'signedIn') {
        client
          .request('/api/me')
          .then((data) => MeSchema.parse(data))
          .catch((error) => {
            if (error instanceof SessionExpiredError) {
              void SecureStore.deleteItemAsync(verifiedSessionKey(client.baseURL));
              void client.offline?.signOut('retain');
              setAccess({ kind: 'signedOut', message: error.message });
            }
          });
      }
    });
    return () => listener.remove();
  }, [client, access.kind]);

  return (
    <ThemeContext.Provider value={palette}>
      <SafeAreaView style={[layout.safe, { backgroundColor: palette.background }]}>
        {access.kind === 'loading' ? (
          <View style={layout.loading}>
            <ActivityIndicator color={palette.accent} />
            <Body>Opening your installation…</Body>
          </View>
        ) : access.kind === 'signedOut' ? (
          <SignIn
            installation={client?.baseURL}
            message={access.message}
            onSignedIn={async (current) => {
              setClient(current);
              await refresh(current);
            }}
          />
        ) : (
          client && (
            <Shell
              client={client}
              session={access.session}
              draft={retainedDraft?.origin === client.baseURL ? retainedDraft.value : undefined}
              onDraft={(value) => {
                setRetainedDraft({ origin: client.baseURL, value });
              }}
              onSaved={(preferences) => {
                setRetainedDraft(null);
                setAccess({ kind: 'signedIn', session: { ...access.session, preferences } });
              }}
              onExpired={(message) => setAccess({ kind: 'signedOut', message })}
              onSignedOut={() => {
                setRetainedDraft(null);
                setAccess({ kind: 'signedOut' });
              }}
            />
          )
        )}
      </SafeAreaView>
    </ThemeContext.Provider>
  );
}

export function SignIn({
  installation,
  message,
  onSignedIn,
}: {
  installation?: string;
  message?: string;
  onSignedIn: (client: InstallationClient) => Promise<void>;
}) {
  const palette = usePalette();
  const [address, setAddress] = useState(installation ?? process.env.EXPO_PUBLIC_API_URL ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setError(undefined);
    setBusy(true);
    try {
      const url = normalizeInstallationUrl(address);
      if (!email.trim() || !password) throw new Error('Enter your owner email and password.');
      const current = createInstallationClient(url);
      const result = await current.auth.signIn.email({ email: email.trim(), password });
      if (result.error)
        throw new Error(result.error.message ?? 'Sign-in failed. Check your email and password.');
      await SecureStore.setItemAsync(installationKey, url);
      setPassword('');
      await onSignedIn(current);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={layout.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={layout.signInScroll}>
        <View style={layout.signIn}>
          <Text style={[layout.wordmark, { color: palette.accent }]}>MEM’S LIFE</Text>
          <Heading eyebrow="Your private installation">A place for your day.</Heading>
          <Body>
            Tasks, training, and food. Sign in to the account your installation owner has set up.
          </Body>
          <View style={layout.space} />
          <Card>
            <Field
              label="Installation address"
              value={address}
              onChangeText={setAddress}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://life.example.com"
              editable={!busy}
            />
            <Field
              label="Owner email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              editable={!busy}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              editable={!busy}
              onSubmitEditing={() => {
                if (!busy) void signIn();
              }}
              returnKeyType="go"
            />
            {error && <Body error>{error}</Body>}
            <Action title="Sign in" onPress={() => void signIn()} busy={busy} />
          </Card>
          <View style={layout.space} />
          <Body>
            Accounts are provisioned privately. To create or recover the owner account, use your
            installation’s setup instructions.
          </Body>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Shell({
  client,
  session,
  draft,
  onDraft,
  onSaved,
  onExpired,
  onSignedOut,
}: {
  client: InstallationClient;
  session: Session;
  draft?: Preferences;
  onDraft?: (value: Preferences) => void;
  onSaved: (preferences: PreferencesRecord) => void;
  onExpired: (message: string) => void;
  onSignedOut: () => void;
}) {
  const [area, setArea] = useState<Area>('Today');
  const [workoutView, setWorkoutView] = useState<'library' | 'train' | 'whoop'>('library');
  const [focusTarget, setFocusTarget] = useState<TodayTarget>();
  const contentScroll = useRef<ScrollView>(null);
  const previousSelection = useRef({ area, workoutView });
  const handledNotifications = useRef(new Set<string>());
  useEffect(() => {
    const previous = previousSelection.current;
    if (previous.area !== area || previous.workoutView !== workoutView) {
      contentScroll.current?.scrollTo({ y: 0, animated: false });
      previousSelection.current = { area, workoutView };
    }
  }, [area, workoutView]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) void reconcileOwnerNotifications(client, () => active).catch(() => undefined);
      }, 250);
    };
    reconcile();
    const unsubscribe = client.offline?.subscribe(reconcile);
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });
    const respond = async (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledNotifications.current.has(id)) return;
      handledNotifications.current.add(id);
      try {
        const route = await resolveNotificationResponse(
          response.notification.request.content.data,
          async (target) => {
            if (target.kind === 'task')
              return (
                TaskResponseSchema.parse(await client.request(`/api/tasks/${target.id}`)).task
                  .id === target.id
              );
            if (target.kind === 'session')
              return (
                SessionResponseSchema.parse(await client.request(`/api/sessions/${target.id}`))
                  .session.id === target.id
              );
            return FoodListResponseSchema.parse(await client.request('/api/food')).entries.some(
              (entry) => entry.id === target.id && !entry.deletedAt,
            );
          },
        );
        if (!active || !route) {
          handledNotifications.current.delete(id);
          return;
        }
        setFocusTarget(route);
        if (route.kind === 'session') setWorkoutView('train');
        setArea(route.kind === 'task' ? 'Tasks' : route.kind === 'session' ? 'Workouts' : 'Food');
      } catch {
        handledNotifications.current.delete(id);
        /* Invalid, removed, or inaccessible records remain in Today. */
      }
    };
    const responses = Notifications.addNotificationResponseReceivedListener(
      (response) => void respond(response),
    );
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) void respond(response);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe?.();
      foreground.remove();
      responses.remove();
      void clearNotificationsOnLogout(client.baseURL).catch(() => undefined);
      void reconcileTimerAlert({
        installation: client.baseURL,
        session: null,
        timer: null,
        deviceId: '',
        enabled: false,
        sound: false,
        haptics: false,
        serverNow: Date.now(),
      }).catch(() => undefined);
    };
  }, [client]);
  const taskFocusTarget: { id?: string; action?: 'create' } | undefined = useMemo(
    () =>
      focusTarget?.kind === 'task'
        ? { id: focusTarget.id, action: focusTarget.action === 'create' ? 'create' : undefined }
        : undefined,
    [focusTarget],
  );
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const palette = usePalette();
  const navigation = (
    <View
      accessibilityRole="tablist"
      style={wide ? layout.sidebar : [layout.bottomNav, { borderTopColor: palette.line }]}
    >
      {wide && <Text style={[layout.sidebarBrand, { color: palette.accent }]}>Mem’s Life</Text>}
      {areas.map((name) => (
        <Pressable
          key={name}
          accessibilityRole="tab"
          accessibilityState={{ selected: area === name }}
          onPress={() => setArea(name)}
          style={[
            wide ? layout.sideItem : layout.tab,
            { backgroundColor: area === name ? palette.surface : 'transparent' },
          ]}
        >
          <Text
            style={[
              layout.navText,
              {
                color: area === name ? palette.accent : palette.muted,
                fontWeight: area === name ? '700' : '500',
              },
            ]}
          >
            {name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <View style={[layout.flex, wide && layout.row]}>
      {wide && navigation}
      <KeyboardAvoidingView
        style={layout.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={contentScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[layout.content, wide && layout.wideContent]}
        >
          <View style={layout.contentInner}>
            {session.authentication === 'offline' && (
              <Body>
                Working from this device’s saved records. Your server session has not been verified
                while offline.
              </Body>
            )}
            <SyncStatus client={client} />
            {area === 'Settings' ? (
              <Settings
                client={client}
                session={session}
                draft={draft}
                onDraft={onDraft}
                onSaved={onSaved}
                onExpired={onExpired}
                onSignedOut={onSignedOut}
              />
            ) : area === 'Tasks' ? (
              <Tasks
                client={client}
                preferences={session.preferences.value}
                focusTarget={taskFocusTarget}
              />
            ) : area === 'Workouts' ? (
              <View>
                <Action title="Library" onPress={() => setWorkoutView('library')} />
                <Action title="Train" onPress={() => setWorkoutView('train')} />
                <Action title="WHOOP" onPress={() => setWorkoutView('whoop')} />
              </View>
            ) : area === 'Food' ? (
              <Food
                client={client}
                preferences={session.preferences.value}
                focusTarget={focusTarget?.kind === 'food' ? focusTarget : undefined}
              />
            ) : null}
            <View style={{ display: area === 'Today' ? 'flex' : 'none' }}>
              <Today
                client={client}
                preferences={session.preferences.value}
                active={area === 'Today'}
                onOpen={(target) => {
                  setFocusTarget(target);
                  if (target.kind === 'session') setWorkoutView('train');
                  setArea(
                    target.kind === 'task'
                      ? 'Tasks'
                      : target.kind === 'session'
                        ? 'Workouts'
                        : 'Food',
                  );
                }}
              />
            </View>
            <View
              style={{
                display: area === 'Workouts' && workoutView === 'library' ? 'flex' : 'none',
              }}
            >
              <Workouts client={client} preferences={session.preferences.value} />
            </View>
            <View
              style={{ display: area === 'Workouts' && workoutView === 'train' ? 'flex' : 'none' }}
            >
              <Sessions
                client={client}
                preferences={session.preferences.value}
                focusTarget={focusTarget?.kind === 'session' ? focusTarget : undefined}
              />
            </View>
            <View
              style={{ display: area === 'Workouts' && workoutView === 'whoop' ? 'flex' : 'none' }}
            >
              <Whoop client={client} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {!wide && navigation}
    </View>
  );
}

export function Settings({
  client,
  session,
  draft: retainedDraft,
  onDraft,
  onSaved,
  onExpired,
  onSignedOut,
}: {
  client: InstallationClient;
  session: Session;
  draft?: Preferences;
  onDraft?: (value: Preferences) => void;
  onSaved: (preferences: PreferencesRecord) => void;
  onExpired: (message: string) => void;
  onSignedOut: () => void;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useState<Preferences>(retainedDraft ?? session.preferences.value);
  const [revision, setRevision] = useState(session.preferences.revision);
  const [pending, setPending] = useState<PreferencesCommand | null>(null);
  const [review, setReview] = useState<PreferencesRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  function change<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onDraft?.(next);
    setPending(null);
    setNotice(undefined);
  }
  function fail(caught: unknown) {
    if (caught instanceof SessionExpiredError) onExpired(caught.message);
    else setError(messageOf(caught));
  }
  async function save() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const validation = PreferencesSchema.safeParse(draft);
      if (!validation.success)
        throw new Error(validation.error.issues[0]?.message ?? 'Check your preferences.');
      const command = pending ?? {
        operationId: Crypto.randomUUID(),
        expectedRevision: revision,
        value: validation.data,
      };
      setPending(command);
      const record = PreferencesRecordSchema.parse(
        await client.request('/api/preferences', command),
      );
      setPending(null);
      setRevision(record.revision);
      setDraft(record.value);
      onSaved(record);
      setNotice('Preferences saved to your installation.');
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    setError(undefined);
    try {
      const record = PreferencesRecordSchema.parse(await client.request('/api/preferences'));
      setReview(record);
      setPending(null);
      setNotice(undefined);
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  }
  function chooseSaved(keepEdits: boolean) {
    if (!review) return;
    setRevision(review.revision);
    if (!keepEdits) setDraft(review.value);
    onSaved(review);
    if (keepEdits) onDraft?.(draft);
    setReview(null);
    setPending(null);
    setError(undefined);
    setNotice(
      keepEdits
        ? 'Your edits are ready to save. You have reviewed the saved preferences.'
        : 'Using your saved preferences.',
    );
  }
  function requestSignOut() {
    if (JSON.stringify(draft) === JSON.stringify(session.preferences.value)) {
      void signOut();
      return;
    }
    Alert.alert(
      'Discard unsaved preferences?',
      'Your preferences have unsaved changes. You can keep editing or discard them and sign out.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard and sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }
  async function signOut(choice?: 'retain' | 'discard' | 'export') {
    if (!choice && client.offline) {
      let pending: boolean;
      try {
        pending = (await client.offline.store.outbox()).some(
          (entry) => !['synced', 'discarded'].includes(entry.state),
        );
      } catch (caught) {
        fail(caught);
        return;
      }
      if (pending) {
        Alert.alert(
          'Saved changes are waiting to synchronize',
          'Choose what happens to the local changes on this device before signing out.',
          [
            { text: 'Keep editing', style: 'cancel' },
            { text: 'Retain and sign out', onPress: () => void signOut('retain') },
            {
              text: 'Discard and sign out',
              style: 'destructive',
              onPress: () => void signOut('discard'),
            },
            { text: 'Export and sign out', onPress: () => void signOut('export') },
          ],
        );
        return;
      }
    }
    setBusy(true);
    setError(undefined);
    try {
      if (client.offline && choice === 'export') {
        const file = new File(Paths.cache, `mems-life-pending-${Crypto.randomUUID()}.json`);
        file.create();
        file.write(await client.offline.store.exportPending());
        const shared = await Share.share({
          url: file.uri,
          title: 'Mem’s Life saved local changes',
        });
        if (shared.action === Share.dismissedAction) return;
      }
      await clearNotificationsOnLogout(client.baseURL, notificationApi(client));
      await reconcileTimerAlert({
        installation: client.baseURL,
        session: null,
        timer: null,
        deviceId: '',
        enabled: false,
        sound: false,
        haptics: false,
        serverNow: Date.now(),
      });
      await client.offline?.signOut(choice === 'discard' ? 'discard' : 'retain');
      const result = await client.auth.signOut();
      if (result.error)
        throw new Error(result.error.message ?? 'Sign-out could not be confirmed. Try again.');
      onSignedOut();
      await SecureStore.deleteItemAsync(verifiedSessionKey(client.baseURL));
    } catch (caught) {
      await client.offline?.store.signIn();
      client.offline?.notify();
      fail(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading eyebrow="Make it yours">Settings</Heading>
      <Card>
        <Text style={[layout.cardTitle, { color: palette.text }]}>Profile & preferences</Text>
        <Field
          label="Display name"
          value={draft.displayName}
          onChangeText={(value) => change('displayName', value)}
          editable={!busy}
          autoComplete="name"
        />
        <Field
          label="Time zone"
          value={draft.timeZone}
          onChangeText={(value) => change('timeZone', value)}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="America/New_York"
        />
        <Choice
          disabled={busy}
          label="Weight"
          value={draft.weightUnit}
          options={[
            { value: 'kg', label: 'Kilograms' },
            { value: 'lb', label: 'Pounds' },
          ]}
          onChange={(value) => change('weightUnit', value)}
        />
        <Choice
          disabled={busy}
          label="Distance"
          value={draft.distanceUnit}
          options={[
            { value: 'km', label: 'Kilometers' },
            { value: 'mi', label: 'Miles' },
          ]}
          onChange={(value) => change('distanceUnit', value)}
        />
        <Choice
          disabled={busy}
          label="Appearance"
          value={draft.theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(value) => change('theme', value)}
        />
        {error && <Body error>{error}</Body>}
        {notice && <Body>{notice}</Body>}
        {review && (
          <Card>
            <Text style={[layout.cardTitle, { color: palette.text }]}>
              Review saved preferences
            </Text>
            <Body>
              Your edits are still in the fields above. These are the preferences currently saved to
              your installation.
            </Body>
            <Body>
              {review.value.displayName}
              {'\n'}
              {review.value.timeZone}
              {'\n'}Weight: {review.value.weightUnit === 'kg' ? 'Kilograms' : 'Pounds'}
              {'\n'}Distance: {review.value.distanceUnit === 'km' ? 'Kilometers' : 'Miles'}
              {'\n'}Appearance: {review.value.theme}
            </Body>
            <Action title="Use saved preferences" secondary onPress={() => chooseSaved(false)} />
            <Action title="Keep my reviewed edits" secondary onPress={() => chooseSaved(true)} />
          </Card>
        )}
        <Action
          title="Save preferences"
          onPress={() => void save()}
          busy={busy}
          disabled={review !== null}
        />
        <Action
          title="Check saved preferences"
          secondary
          onPress={() => void reload()}
          disabled={busy}
        />
      </Card>
      <View style={layout.space} />
      <Card>
        <Text style={[layout.cardTitle, { color: palette.text }]}>Private account</Text>
        <Body>{session.me.user.email}</Body>
        <Body>{client.baseURL}</Body>
        <Body>
          Sign out ends this device’s server session. Your records remain in your installation.
        </Body>
        <Action title="Sign out" secondary onPress={requestSignOut} disabled={busy} />
      </Card>
      <View style={layout.space} />
      <NotificationSettings client={client} onSaved={() => reconcileOwnerNotifications(client)} />
      <AgentAccess client={client} />
    </>
  );
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}
const layout = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  signInScroll: { flexGrow: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  signIn: { width: '100%', maxWidth: 480, paddingVertical: 32 },
  wordmark: { fontSize: 14, fontWeight: '800', letterSpacing: 3, marginBottom: 44 },
  space: { height: 24 },
  content: { flexGrow: 1, padding: 24, paddingTop: 34 },
  wideContent: { padding: 48 },
  contentInner: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  sidebar: { width: 208, padding: 20, gap: 8 },
  sidebarBrand: { fontSize: 24, fontWeight: '700', marginTop: 20, marginBottom: 32 },
  sideItem: { minHeight: 54, borderRadius: 13, padding: 16, justifyContent: 'center' },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 8 },
  tab: {
    flex: 1,
    minHeight: 56,
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { fontSize: 13 },
  cardTitle: { fontSize: 21, fontWeight: '600' },
  status: { borderTopWidth: 1, paddingTop: 18 },
});
