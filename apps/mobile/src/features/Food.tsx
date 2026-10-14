import React, { useEffect, useState, useRef } from 'react';
import { View, Image, Alert, Modal, ScrollView } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Temporal } from '@js-temporal/polyfill';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import {
  FoodCommandSchema,
  FoodListResponseSchema,
  FoodResponseSchema,
  FoodCommandResponseSchema,
  FoodUploadResponseSchema,
  FoodHistorySchema,
  type FoodEntry,
  type Preferences,
} from '@mems-life/domain';
import { parseFoodAcknowledgement, useOfflineRevision } from '../offline-client';
import type { InstallationClient } from '../client';
import { Action, Body, Card, Field, Heading, usePalette } from '../ui';
import { retainFoodPhoto, uploadFoodPhoto, type LocalFoodPhoto } from '../media';
import { useCommand, messageOf } from './helpers';
import { DateTimeField, formatDateTime } from '../DateTimeField';
import { localInstant, localParts } from './Productivity';
import { retainedFoodPhotoUri } from '../retained-food-photo';
const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// Drafts from earlier builds store wall-clock text. Resolve it in the configured owner zone.
function foodInstant(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const at = localInstant(value.slice(0, 10), value.slice(11), timezone);
    if (!at) throw new Error('Choose a food date and time.');
    return at;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid food date and time.');
  return date.toISOString();
}
function PrivatePhoto({
  id,
  entryId,
  client,
}: {
  id: string;
  entryId: string;
  client: InstallationClient;
}) {
  const revision = useOfflineRevision(client);
  const [source, setSource] = useState<{ uri: string; headers?: { Cookie: string } } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(null);
    setUnavailable(false);
    void (async () => {
      const uri = await retainedFoodPhotoUri(client, entryId, id);
      if (!active) return;
      if (uri) {
        setSource({ uri });
        return;
      }
      if (client.offline) {
        setUnavailable(true);
        return;
      }
      const cookie = await client.auth.getCookie();
      if (active)
        setSource({ uri: `${client.baseURL}/api/media/${id}`, headers: { Cookie: cookie ?? '' } });
    })().catch(() => {
      if (active) setUnavailable(true);
    });
    return () => {
      active = false;
    };
  }, [client, entryId, id, revision]);
  if (unavailable) return <Body>Photo unavailable on this device. Connect to view it.</Body>;
  if (!source) return <Body>Loading photo…</Body>;
  return (
    <Image
      accessibilityLabel="Private food photo"
      source={source}
      onError={() => setUnavailable(true)}
      style={{ width: 150, height: 130, borderRadius: 12 }}
    />
  );
}
export function Food({
  client,
  preferences,
  focusTarget,
}: {
  client: InstallationClient;
  preferences?: Preferences;
  focusTarget?: { id?: string; action?: 'create' | 'capture' };
}) {
  const palette = usePalette();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingTime, setEditingTime] = useState(false);
  const [more, setMore] = useState(false);
  const [width, setWidth] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDay, setCalendarDay] = useState(
    () => localParts(new Date().toISOString(), preferences?.timeZone ?? deviceTimezone).date,
  );
  const historySequence = useRef(0);
  const timezone = preferences?.timeZone ?? deviceTimezone;
  const offlineRevision = useOfflineRevision(client);
  const [draftEntryId, setDraftEntryId] = useState(Crypto.randomUUID);
  const [draftReady, setDraftReady] = useState(!client.offline);
  const [localPhotos, setLocalPhotos] = useState<
    Awaited<ReturnType<NonNullable<InstallationClient['offline']>['store']['photos']>>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [text, setText] = useState('');
  const [time, setTime] = useState(() => new Date().toISOString());
  const initialTime = useRef(time);
  const [day, setDay] = useState(() => localParts(time, timezone).date);
  const [selected, setSelected] = useState<FoodEntry | null>(null);
  const [photos, setPhotos] = useState<LocalFoodPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const command = useCommand(client);
  const allocation = useRef(new Map<string, string>());
  const loadSequence = useRef(0);
  const picking = useRef(false);
  const saving = useRef(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const hasUnsavedText = selected
    ? text !== selected.content.text || Date.parse(time) !== Date.parse(selected.content.occurredAt)
    : !!text.trim() || time !== initialTime.current;
  async function load() {
    const sequence = ++loadSequence.current;
    setLoaded(false);
    try {
      const response = FoodListResponseSchema.parse(
        await client.request(`/api/food?date=${day}&timezone=${encodeURIComponent(timezone)}`),
      );
      if (sequence === loadSequence.current) {
        setEntries(response.entries);
        setLoaded(true);
      }
    } catch (error) {
      if (sequence === loadSequence.current) setNotice(messageOf(error));
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [client, day, timezone, offlineRevision]);
  useEffect(() => {
    let active = true;
    const offline = client.offline;
    if (!offline) {
      setDraftReady(true);
      return;
    }
    void offline.store
      .getDraft<{
        text: string;
        time: string;
        draftEntryId: string;
        selected: FoodEntry | null;
        photos: LocalFoodPhoto[];
      }>('food-editor')
      .then((saved) => {
        if (!active) return;
        if (saved) {
          if (saved.text || saved.selected || saved.photos.length) setComposerOpen(true);
          setText(saved.text);
          setTime(saved.time);
          setDraftEntryId(saved.draftEntryId);
          setSelected(saved.selected);
          setPhotos(saved.photos);
        }
        setDraftReady(true);
      })
      .catch((e) => setNotice(messageOf(e)));
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    if (!client.offline || !draftReady) return;
    void client.offline.store
      .setDraft('food-editor', { text, time, draftEntryId, selected, photos })
      .catch((e) => setNotice(`Draft storage failed: ${messageOf(e)}`));
  }, [client, draftReady, text, time, draftEntryId, selected, photos]);
  useEffect(() => {
    if (client.offline)
      void client.offline.store
        .photos()
        .then(setLocalPhotos)
        .catch((e) => setNotice(messageOf(e)));
  }, [client, offlineRevision]);
  useEffect(() => {
    if (!focusTarget || !draftReady) return;
    let active = true;
    if (hasUnsavedText || photos.length || busy || pickingPhoto || command.pending) {
      setNotice('Your diary draft is retained. Save it before opening another entry.');
      return;
    }
    if (focusTarget.id) {
      void client
        .request(`/api/food/${focusTarget.id}`)
        .then((raw) => {
          if (!active) return;
          const entry = FoodResponseSchema.parse(raw).entry;
          setComposerOpen(true);
          setHistory([]);
          historySequence.current++;
          setSelected(entry);
          setText(entry.content.text);
          setTime(entry.content.occurredAt);
          setDay(localParts(entry.content.occurredAt, timezone).date);
        })
        .catch((e) => {
          if (active) setNotice(messageOf(e));
        });
    } else if (focusTarget.action === 'capture') {
      setSelected(null);
      setComposerOpen(true);
    }
    return () => {
      active = false;
    };
  }, [client, focusTarget, draftReady]);
  async function pick(camera: boolean) {
    if (picking.current || busy || command.pending || !draftReady) return;
    picking.current = true;
    setPickingPhoto(true);
    setNotice('');
    try {
      if (photos.length + (selected?.photoIds.length ?? 0) >= 12)
        throw new Error('An entry can contain up to twelve photos.');
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setNotice(
          `${camera ? 'Camera' : 'Photo library'} permission was denied. Enable it in Settings, or record a text entry.`,
        );
        return;
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            selectionLimit: 12 - (selected?.photoIds.length ?? 0) - photos.length,
          });
      if (result.canceled) {
        setNotice('Photo selection canceled. Your entry is still here.');
        return;
      }
      if (result.assets.length + photos.length + (selected?.photoIds.length ?? 0) > 12)
        throw new Error('An entry can contain up to twelve photos.');
      const ownerId =
        client.offline?.store.partition.ownerId ?? (await client.auth.getSession()).data?.user.id;
      if (!ownerId) throw new Error('Sign in before selecting private photos.');
      let staged = photos;
      for (const asset of result.assets) {
        const retained = await retainFoodPhoto(asset.uri, `${client.baseURL}/${ownerId}`);
        if (client.offline)
          await client.offline.store.retainPhoto({
            ...retained,
            id: Crypto.randomUUID(),
            entryId: selected?.id ?? draftEntryId,
          });
        staged = [...staged, retained];
        if (client.offline)
          await client.offline.store.setDraft('food-editor', {
            text,
            time,
            draftEntryId,
            selected,
            photos: staged,
          });
        setPhotos(staged);
      }
      setNotice(
        client.offline
          ? 'Photos saved in private device storage. Save the entry to queue upload.'
          : 'Photos copied to private app storage. Save the entry to upload.',
      );
    } catch (error) {
      setNotice(messageOf(error));
    } finally {
      picking.current = false;
      setPickingPhoto(false);
    }
  }
  async function save() {
    if (saving.current || picking.current || !draftReady) return;
    saving.current = true;
    setBusy(true);
    try {
      const occurredAt = foodInstant(time, timezone);
      if (client.offline) {
        const saved = parseFoodAcknowledgement(
          await client.offline.saveFood(
            FoodCommandSchema.parse({
              type: selected ? 'food.edit' : 'food.create',
              operationId: Crypto.randomUUID(),
              entryId: selected?.id ?? draftEntryId,
              expectedRevision: selected?.revision ?? 0,
              content: { text, occurredAt, timezone },
            }),
            photos.map((photo) => photo.uri),
          ),
        );
        if (!saved.entry) return;
        setPhotos([]);
        setSelected(null);
        setText('');
        initialTime.current = new Date().toISOString();
        setTime(initialTime.current);
        setComposerOpen(false);
        setDraftEntryId(Crypto.randomUUID());
        setNotice('Saved on this device. Waiting for server confirmation and photo upload.');
        await load();
        return;
      }
      const result =
        selected && photos.some((photo) => photo.allocationRevision !== undefined)
          ? { entry: selected }
          : await command.send(
              '/api/food/commands',
              {
                type: selected ? 'food.edit' : 'food.create',
                entryId: selected?.id ?? draftEntryId,
                expectedRevision: selected?.revision ?? 0,
                content: { text, occurredAt, timezone },
              },
              parseFoodAcknowledgement,
            );
      if (!result) return;
      let entry = result.entry;
      setSelected(entry);
      for (const photo of photos) {
        let id = photo.uploadId;
        if (!id) {
          let operationId = allocation.current.get(photo.uri);
          if (!operationId) {
            operationId = Crypto.randomUUID();
            allocation.current.set(photo.uri, operationId);
          }
          const uploaded = FoodUploadResponseSchema.parse(
            await client.request(
              `/api/food/${entry.id}/uploads`,
              {
                operationId,
                expectedRevision:
                  photo.allocationRevision ?? (photo.allocationRevision = entry.revision),
                size: photo.size,
                sha256: photo.sha256,
                contentType: 'image/jpeg',
              },
              'POST',
            ),
          );
          id = uploaded.upload.id;
          photo.uploadId = id;
        }
        await uploadFoodPhoto(client, photo, id);
        const finalized = FoodCommandResponseSchema.parse(
          await client.request(
            `/api/media/${id}/finalize`,
            {
              operationId: photo.operationId,
              expectedRevision: photo.finalizeRevision ?? (photo.finalizeRevision = entry.revision),
            },
            'POST',
          ),
        );
        entry = finalized.entry;
        setSelected(entry);
        setPhotos((current) => current.filter((item) => item.uri !== photo.uri));
        new File(photo.uri).delete();
      }
      setSelected(null);
      setText('');
      initialTime.current = new Date().toISOString();
      setTime(initialTime.current);
      setComposerOpen(false);
      setDraftEntryId(Crypto.randomUUID());
      setNotice('Food entry saved.');
      await load();
    } catch (error) {
      setNotice(`${messageOf(error)} Your draft and local photos are retained on this screen.`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function mutate(entry: FoodEntry, photoId?: string) {
    if (
      busy ||
      picking.current ||
      photos.some((photo) => photo.allocationRevision !== undefined) ||
      command.pending
    ) {
      setNotice('Finish the pending save before removing photos or deleting entries.');
      return;
    }
    const result = await command.send(
      '/api/food/commands',
      {
        type: photoId ? 'food.detach' : 'food.delete',
        entryId: entry.id,
        expectedRevision: entry.revision,
        ...(photoId ? { photoId } : {}),
      },
      parseFoodAcknowledgement,
    );
    if (result) {
      if (selected?.id === entry.id) {
        setSelected(photoId ? result.entry : null);
        if (!photoId) {
          setText('');
          setPhotos([]);
          initialTime.current = new Date().toISOString();
          setTime(initialTime.current);
          setDraftEntryId(Crypto.randomUUID());
          setComposerOpen(false);
        }
      }
      await load();
    }
  }
  const locked =
    !draftReady ||
    busy ||
    pickingPhoto ||
    !!command.pending ||
    photos.some((photo) => photo.allocationRevision !== undefined);
  function begin() {
    if (!hasUnsavedText && !photos.length && !command.pending && !busy && !pickingPhoto) {
      setSelected(null);
      setText('');
      initialTime.current = new Date().toISOString();
      setTime(initialTime.current);
      setDraftEntryId(Crypto.randomUUID());
      setHistory([]);
      historySequence.current++;
      setEditingTime(false);
      setMore(false);
    }
    setComposerOpen(true);
  }
  const changeDay = (amount: number) =>
    setDay(Temporal.PlainDate.from(day).add({ days: amount }).toString());
  let displayTime = 'Review date and time';
  try {
    displayTime = formatDateTime(foodInstant(time, timezone), timezone);
  } catch {
    /* Saved invalid drafts stay repairable. */
  }
  const dayLabel = Temporal.PlainDate.from(day).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const openEntry = (entry: FoodEntry) => {
    setSelected(entry);
    setText(entry.content.text);
    setTime(entry.content.occurredAt);
    setHistory([]);
    historySequence.current++;
    setMore(false);
    setComposerOpen(true);
  };
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ gap: 14 }}>
      {!draftReady && <Body>Opening saved diary draft…</Body>}
      {!!notice && <Body>{notice}</Body>}
      {!!command.error && <Body error>{command.error}</Body>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Action title="Previous day" variant="quiet" compact onPress={() => changeDay(-1)} />
        <View style={{ flex: 1, minWidth: 140 }}>
          <Body>{dayLabel}</Body>
        </View>
        <Action title="Next day" variant="quiet" compact onPress={() => changeDay(1)} />
      </View>
      <Action
        title="Choose day"
        variant="quiet"
        compact
        onPress={() => {
          setCalendarDay(day);
          setCalendarOpen(true);
        }}
      />
      <Modal
        visible={calendarOpen}
        presentationStyle="pageSheet"
        onRequestClose={() => setCalendarOpen(false)}
      >
        <ScrollView
          style={{ backgroundColor: palette.background }}
          contentContainerStyle={{ padding: 24, gap: 16 }}
        >
          <Heading>Choose day</Heading>
          <DateTimePicker
            accessibilityLabel="Diary day picker"
            value={new Date(localInstant(calendarDay, '12:00', timezone)!)}
            mode="date"
            display="inline"
            timeZoneName={timezone}
            onValueChange={(_event, value) => {
              if (value) setCalendarDay(localParts(value.toISOString(), timezone).date);
            }}
          />
          <Action
            title="Show day"
            onPress={() => {
              setDay(calendarDay);
              setCalendarOpen(false);
            }}
          />
          <Action title="Cancel day" secondary onPress={() => setCalendarOpen(false)} />
        </ScrollView>
      </Modal>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Action
          title="Add photo"
          variant="quiet"
          compact
          disabled={locked}
          onPress={() => {
            setComposerOpen(true);
            void pick(true);
          }}
        />
        <Action
          title={!composerOpen && (hasUnsavedText || photos.length) ? 'Resume draft' : 'Add entry'}
          variant="quiet"
          compact
          disabled={!draftReady}
          onPress={begin}
        />
      </View>
      <View style={{ flexDirection: width > 760 ? 'row' : 'column', gap: 16 }}>
        {composerOpen && (
          <View style={{ flex: width > 760 ? 1 : undefined, minWidth: 0 }}>
            <Card>
              <Body>{selected ? 'Edit entry' : 'Add entry'}</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <Action
                  title="Take photo"
                  variant="quiet"
                  compact
                  disabled={locked || photos.length + (selected?.photoIds.length ?? 0) >= 12}
                  onPress={() => void pick(true)}
                />
                <Action
                  title="Choose photos"
                  variant="quiet"
                  compact
                  disabled={locked || photos.length + (selected?.photoIds.length ?? 0) >= 12}
                  onPress={() => void pick(false)}
                />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {photos.map((photo) => (
                  <Image
                    accessibilityLabel="Selected food photo"
                    key={photo.uri}
                    source={{ uri: photo.uri }}
                    style={{ width: 100, height: 90, borderRadius: 10 }}
                  />
                ))}
              </View>
              <Field
                editable={!locked}
                label="What did you eat?"
                multiline
                value={text}
                onChangeText={setText}
                placeholder="Add a few words (optional)"
              />
              <Body>Time · {displayTime}</Body>
              <Action
                title="Edit time"
                variant="quiet"
                compact
                disabled={locked}
                onPress={() => setEditingTime(!editingTime)}
              />
              {editingTime && (
                <DateTimeField
                  disabled={locked}
                  label="Date and time"
                  value={(() => {
                    try {
                      return foodInstant(time, timezone);
                    } catch {
                      return null;
                    }
                  })()}
                  timezone={timezone}
                  nullable={false}
                  onChange={(at) => {
                    if (at) setTime(at);
                  }}
                />
              )}
              {photos.length > 0 && (
                <Body>
                  {photos.length} {photos.length === 1 ? 'photo' : 'photos'} selected
                </Body>
              )}
              <Action
                title="Save entry"
                busy={busy || command.busy}
                disabled={!draftReady || pickingPhoto}
                onPress={() => void save()}
              />
              <Action
                title="Cancel"
                variant="quiet"
                compact
                disabled={busy || pickingPhoto}
                onPress={() => setComposerOpen(false)}
              />
              {selected && (
                <>
                  <Action title="More" variant="quiet" compact onPress={() => setMore(!more)} />
                  {more && (
                    <>
                      {selected.photoIds.map((id, index) => (
                        <Action
                          key={id}
                          title={`Remove photo ${index + 1}`}
                          variant="quiet"
                          compact
                          disabled={locked}
                          onPress={() => void mutate(selected, id)}
                        />
                      ))}
                      <Action
                        title="Entry history"
                        variant="quiet"
                        compact
                        onPress={() => {
                          const sequence = ++historySequence.current;
                          void client
                            .request(`/api/food/${selected.id}/history`)
                            .then((value) => {
                              if (sequence !== historySequence.current) return;
                              setHistory(
                                FoodHistorySchema.parse(value).events.map(
                                  (event) =>
                                    `${formatDateTime(event.createdAt, timezone)}: ${event.type === 'food.create' ? 'Entry added' : event.type === 'food.edit' ? 'Entry edited' : event.type === 'food.delete' ? 'Entry deleted' : event.type === 'food.detach' ? 'Photo removed' : 'Photo added'}`,
                                ),
                              );
                            })
                            .catch((error) => {
                              if (sequence === historySequence.current) setNotice(messageOf(error));
                            });
                        }}
                      />
                      <Action
                        title="Delete entry"
                        variant="destructive"
                        compact
                        disabled={locked}
                        onPress={() =>
                          Alert.alert('Delete food entry?', 'Its history will remain.', [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: () => void mutate(selected),
                            },
                          ])
                        }
                      />
                    </>
                  )}
                </>
              )}
              {history.map((event, index) => (
                <Body key={index}>{event}</Body>
              ))}
            </Card>
          </View>
        )}
        <View style={{ flex: width > 760 ? 1.4 : undefined, gap: 12, minWidth: 0 }}>
          {!loaded && <Body>Loading entries…</Body>}
          {!loaded && (
            <Action
              title="Retry food history"
              variant="quiet"
              compact
              onPress={() => void load()}
            />
          )}
          {loaded && entries.length === 0 && (
            <Card>
              <Body>No food recorded</Body>
              <Action title="Add your first entry" variant="quiet" compact onPress={begin} />
            </Card>
          )}
          {loaded &&
            entries.map((entry) => (
              <Card key={entry.id}>
                <Body>
                  {new Date(entry.content.occurredAt).toLocaleTimeString(undefined, {
                    timeZone: timezone,
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Body>
                <Body>{entry.content.text || 'Photo entry'}</Body>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {localPhotos
                    .filter(
                      (p) =>
                        p.entryId === entry.id && p.status !== 'synced' && p.status !== 'discarded',
                    )
                    .map((p) => (
                      <View key={p.id}>
                        <Image
                          accessibilityLabel="Food photo saved on this device"
                          source={{ uri: p.uri }}
                          style={{ width: 130, height: 100, borderRadius: 10 }}
                        />
                        <Body>
                          {p.status === 'needs-attention'
                            ? 'Upload needs review'
                            : 'Saved locally · upload pending'}
                        </Body>
                      </View>
                    ))}
                  {entry.photoIds.map((id) => (
                    <PrivatePhoto key={id} id={id} entryId={entry.id} client={client} />
                  ))}
                </View>
                <Action
                  title="Edit entry"
                  variant="quiet"
                  compact
                  disabled={
                    busy || pickingPhoto || photos.length > 0 || command.pending || hasUnsavedText
                  }
                  onPress={() => openEntry(entry)}
                />
              </Card>
            ))}
        </View>
      </View>
    </View>
  );
}
