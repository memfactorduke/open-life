import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import type { InstallationClient } from './client';
import { useOfflineRevision } from './offline-client';
import type { LocalRecord, OutboxEntry, SyncState, DurablePhoto, OfflineCommand } from './offline';
import { reviewCommandDifferences, reviewFields } from './offline/recovery';
import { shareRetainedPhoto, exportRecoveryFiles } from './offline/photo-export';
import { Action, Body, Card } from './ui';
export function SyncStatus({ client }: { client: InstallationClient }) {
  const revision = useOfflineRevision(client);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [state, setState] = useState<SyncState | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState(0);
  const [photoReview, setPhotoReview] = useState<DurablePhoto[]>([]);
  const [checked, setChecked] = useState<
    Record<string, Awaited<ReturnType<NonNullable<InstallationClient['offline']>['checkRecovery']>>>
  >({});
  const [checkedPhotos, setCheckedPhotos] = useState<
    Record<
      string,
      Awaited<ReturnType<NonNullable<InstallationClient['offline']>['checkPhotoRecovery']>>
    >
  >({});
  const [error, setError] = useState('');
  const [exportPath, setExportPath] = useState('');
  useEffect(() => {
    let active = true;
    const offline = client.offline;
    if (!offline) return;
    void Promise.all([
      offline.store.outbox(),
      offline.store.records(),
      offline.store.state(),
      offline.store.photos(),
    ])
      .then(([e, r, s, p]) => {
        if (active) {
          setEntries(e);
          setRecords(r);
          setState(s);
          setPhotoReview(p.filter((photo) => photo.status === 'needs-attention'));
          setPendingPhotos(
            p.filter((photo) => !['synced', 'discarded'].includes(photo.status)).length,
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [client, revision]);
  const offline = client.offline;
  if (!offline) return null;
  const pending = entries.filter((e) => !['synced', 'discarded'].includes(e.state));
  const review = pending.filter((e) => ['conflict', 'review'].includes(e.state));
  const act = async (work: () => Promise<unknown>) => {
    try {
      await work();
      setError('');
      offline.notify();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review could not be saved.');
    }
  };
  return (
    <Card>
      <Body>
        {!state?.epoch
          ? 'Opening the server snapshot · local saves remain on this device'
          : pending.length || pendingPhotos
            ? `Saved on this device · ${pending.length} changes and ${pendingPhotos} photos pending server confirmation`
            : 'Server confirmed · saved changes are synchronized'}
      </Body>
      {!!offline.error && <Body error>{offline.error}</Body>}
      {!!error && <Body error>{error}</Body>}
      {offline.needsSignIn && (
        <Body error>Sign in again. Your saved local changes remain on this device.</Body>
      )}
      {state?.replayPaused && (
        <Body error>
          The server was restored. Sending is paused while you review local work. Check whether
          earlier changes already saved before sending a new copy. Changes that were never sent can
          be checked against the restored server.
        </Body>
      )}
      {photoReview.map((photo) => {
        const proof = checkedPhotos[photo.id];
        return (
          <Card key={photo.id}>
            <Body error>
              The private image is retained on this device. Check the current entry before choosing
              what to save.
            </Body>
            <Image
              accessibilityLabel="Retained food photo awaiting review"
              source={{ uri: photo.uri }}
              style={{ width: 140, height: 120 }}
            />
            <Action
              title="Check current entry and saved photos"
              secondary
              onPress={() =>
                void act(async () => {
                  const result = await offline.checkPhotoRecovery(photo.id);
                  setCheckedPhotos((p) => ({ ...p, [photo.id]: result }));
                })
              }
            />
            <Action
              title="Save a copy of this photo"
              secondary
              onPress={() => void act(() => shareRetainedPhoto(photo))}
            />
            {proof && (
              <>
                <Body>
                  {proof.text} · {proof.photoCount} saved photos.{' '}
                  {proof.matchingId
                    ? 'This exact image is already saved.'
                    : 'No saved image with matching bytes was found.'}
                </Body>
                {proof.matchingId ? (
                  <Action
                    title="Use the already saved image"
                    onPress={() => void act(() => offline.recoverPhoto(photo.id, proof))}
                  />
                ) : proof.entryExists ? (
                  <>
                    <Body>
                      {photo.attempts
                        ? 'Only choose this after checking the entry and confirming the earlier upload has stopped and did not save this image.'
                        : 'This photo was never sent. Save it to the current entry with fresh upload details.'}
                    </Body>
                    <Action
                      title={
                        photo.attempts
                          ? 'I checked: save as a new photo'
                          : 'Save this never-sent photo'
                      }
                      onPress={() => void act(() => offline.recoverPhoto(photo.id, proof, true))}
                    />
                  </>
                ) : (
                  <>
                    <Body>
                      The original entry is unavailable. This photo remains on this device.
                    </Body>
                    {proof.retainedEntry && (
                      <Body>
                        Retained diary details:{' '}
                        {proof.retainedEntry.content.text || 'Photo diary entry'}
                        {' · '}
                        {new Date(proof.retainedEntry.content.occurredAt).toLocaleString()}
                        {' · '}
                        {photo.size} bytes · SHA-256 {photo.sha256}
                      </Body>
                    )}
                    {proof.recoveryEntryId ? (
                      <Body>
                        The new diary entry is awaiting server confirmation. Review its pending
                        change if sending was interrupted, then check this photo again.
                      </Body>
                    ) : proof.retainedEntry ? (
                      <>
                        <Body>
                          Review these details before creating a separate diary entry. After the
                          server confirms it, check again and choose whether to save this photo.
                        </Body>
                        <Action
                          title="Create new diary entry from retained details"
                          onPress={() =>
                            void act(async () => {
                              await offline.recoverPhoto(photo.id, proof, false, true);
                              const updated = await offline.checkPhotoRecovery(photo.id);
                              setCheckedPhotos((p) => ({ ...p, [photo.id]: updated }));
                            })
                          }
                        />
                      </>
                    ) : (
                      <Body>
                        No retained diary details are available. Save a copy of the photo.
                      </Body>
                    )}
                  </>
                )}
              </>
            )}
          </Card>
        );
      })}
      {review.map((entry) => {
        const record = records.find((r) => `${r.recordType}:${r.id}` === entry.aggregate);
        const proof = checked[entry.operationId];
        const command = JSON.parse(entry.payload || '{}') as OfflineCommand;
        const checkedRecord = proof?.record ?? record;
        const fields = reviewFields(record?.value);
        const server = checkedRecord?.confirmed as { deletedAt?: string; status?: string } | null;
        const canResubmit =
          !!server &&
          !server.deletedAt &&
          !(record?.recordType === 'session' && server.status !== 'active');
        return (
          <Card key={entry.operationId}>
            <Body>
              {fields.Title ?? fields.Entry ?? fields.Workout} ·{' '}
              {entry.state === 'conflict' ? 'Changed on another device' : 'Needs review'} ·{' '}
              {entry.attempts ? 'An earlier attempt may have saved' : 'Never sent'}
            </Body>
            <Body error>{entry.error}</Body>
            {reviewCommandDifferences(command, checkedRecord?.confirmed, records).map((d) => (
              <Body key={d.field}>
                {d.field}
                {d.changed ? ' — different' : ''}
                {'\n'}On this device: {d.local}
                {'\n'}On the server: {d.server}
              </Body>
            ))}
            <Action
              title="Check the current server and original attempt"
              secondary
              onPress={() =>
                void act(async () => {
                  const result = await offline.checkRecovery(entry.operationId);
                  setChecked((p) => ({ ...p, [entry.operationId]: result }));
                })
              }
            />
            {proof && (
              <>
                <Body>
                  {proof.originalSaved
                    ? 'The original attempt appears in server history. Keep the current server version to avoid sending it again.'
                    : entry.attempts
                      ? 'The original attempt was not found in the available history. Restores can lose receipts. Check the versions above and confirm that the earlier attempt did not save before making a new submission.'
                      : 'The current server version has been checked.'}
                </Body>
                <Body>
                  Keeping the server version stops these local edits from sending. Your local copy
                  remains in the recovery export.
                </Body>
                <Action
                  title="I reviewed it: keep server version"
                  secondary
                  onPress={() => void act(() => offline.store.keepServer(entry.aggregate))}
                />
                {entry.attempts === 0 && entry.state === 'review' && (
                  <Action
                    title="Check and send this never-sent change"
                    secondary
                    onPress={() => void act(() => offline.revalidateReviewed(entry.operationId))}
                  />
                )}
                {!proof.originalSaved && canResubmit && (
                  <Action
                    title={
                      entry.attempts
                        ? 'I checked: submit my reviewed change'
                        : 'Submit my reviewed change'
                    }
                    onPress={() =>
                      void act(() =>
                        offline.saveReviewed(entry.operationId, { ...proof, outcomeChecked: true }),
                      )
                    }
                  />
                )}
                {!proof.originalSaved && ['task', 'food'].includes(record?.recordType ?? '') && (
                  <>
                    <Body>
                      A separate copy gets a new identity. Existing photos and task organization
                      stay with the original record.
                    </Body>
                    <Action
                      title="I checked: save text as a separate copy"
                      secondary
                      onPress={() =>
                        void act(() =>
                          offline.saveReviewed(
                            entry.operationId,
                            { ...proof, outcomeChecked: true },
                            true,
                          ),
                        )
                      }
                    />
                  </>
                )}
                {record?.recordType === 'session' && !canResubmit && (
                  <Body>
                    The finished server workout will remain intact. Your local sets and measurements
                    remain retained for export and comparison.
                  </Body>
                )}
              </>
            )}
          </Card>
        );
      })}
      {state?.replayPaused && (
        <Action
          title="Resume after reviewing changes"
          onPress={() =>
            void act(async () => {
              await offline.store.resumeAfterReview();
              await offline.sync();
            })
          }
        />
      )}
      {(review.length > 0 || photoReview.length > 0) && (
        <Action
          title="Export retained changes and image files"
          secondary
          onPress={() =>
            void act(async () => setExportPath(await exportRecoveryFiles(offline.store)))
          }
        />
      )}
      {!!exportPath && (
        <Body>
          Recovery copy saved in app Documents: {exportPath}. It includes the image files and a
          manifest; the originals remain retained.
        </Body>
      )}
      <Action title="Synchronize now" secondary onPress={() => void offline.sync()} />
    </Card>
  );
}
