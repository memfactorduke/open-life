import { useEffect, useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import {
  FoodListResponseSchema,
  FoodCommandResponseSchema,
  FoodUploadResponseSchema,
  FoodHistorySchema,
  type FoodEntry,
  type Preferences,
} from '@mems-life/domain';
import { request, RequestError } from '../api';
import './food.css';
const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function local(value: string, timezone: string): string {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString()
    .slice(0, 16);
}
function instant(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('Choose a valid food date and time.');
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(timezone, { disambiguation: 'compatible' })
    .toInstant()
    .toString();
}
function PrivatePhoto({ id }: { id: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let objectURL = '';
    fetch(`/api/media/${id}`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Photo unavailable');
        objectURL = URL.createObjectURL(await response.blob());
        if (!disposed) setUrl(objectURL);
      })
      .catch((error) => {
        if (!disposed) setError(error.message);
      });
    return () => {
      disposed = true;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [id]);
  return url ? (
    <img src={url} alt="Private food diary photo" />
  ) : (
    <span>{error || 'Loading photo…'}</span>
  );
}
export function Food({
  preferences,
  focusTarget,
}: {
  preferences?: Preferences;
  focusTarget?: { id?: string; action?: 'create' | 'capture' };
} = {}) {
  const timezone = preferences?.timeZone ?? deviceTimezone;
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [day, setDay] = useState(() => local(new Date().toISOString(), timezone).slice(0, 10));
  const [text, setText] = useState('');
  const [time, setTime] = useState(() => local(new Date().toISOString(), timezone));
  const [selected, setSelected] = useState<FoodEntry | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const pending = useRef<Record<string, unknown> | null>(null);
  const handledFocus = useRef<typeof focusTarget>(undefined);
  const uploads = useRef(
    new Map<
      File,
      {
        id?: string;
        operationId: string;
        allocationId: string;
        allocationRevision: number;
        finalizeRevision?: number;
      }
    >(),
  );
  async function load() {
    try {
      const result = await request(
        `/api/food?date=${day}&timezone=${encodeURIComponent(timezone)}`,
        FoodListResponseSchema,
      );
      setEntries(result.entries);
      setLoaded(true);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [day, timezone]);
  useEffect(() => {
    if (!focusTarget || handledFocus.current === focusTarget || !loaded || busy) return;
    handledFocus.current = focusTarget;
    if (
      pending.current ||
      files.length ||
      text !== (selected?.content.text ?? '') ||
      (selected && time !== local(selected.content.occurredAt, timezone))
    ) {
      setNotice('Save or discard the current food draft before opening another entry.');
      return;
    }
    if (!focusTarget.id) {
      reset();
      document.querySelector<HTMLTextAreaElement>('.food textarea')?.focus();
      return;
    }
    let active = true;
    void request('/api/food', FoodListResponseSchema)
      .then((result) => {
        if (!active) return;
        const entry = result.entries.find((candidate) => candidate.id === focusTarget.id);
        if (!entry) throw new Error('This food entry is no longer available.');
        setDay(local(entry.content.occurredAt, timezone).slice(0, 10));
        edit(entry);
      })
      .catch((error) => {
        if (active)
          setNotice(error instanceof Error ? error.message : 'Unable to open the food entry.');
      });
    return () => {
      active = false;
    };
  }, [focusTarget, loaded, busy]);
  function edit(entry: FoodEntry) {
    setSelected(entry);
    setText(entry.content.text);
    setTime(local(entry.content.occurredAt, timezone));
    setFiles([]);
    setHistory([]);
    pending.current = null;
    uploads.current.clear();
  }
  function reset() {
    setSelected(null);
    setText('');
    setTime(local(new Date().toISOString(), timezone));
    setFiles([]);
    setHistory([]);
    pending.current = null;
    uploads.current.clear();
  }
  async function command(body: Record<string, unknown>) {
    pending.current ??= { ...body, operationId: crypto.randomUUID() };
    try {
      const result = await request('/api/food/commands', FoodCommandResponseSchema, {
        method: 'POST',
        body: JSON.stringify(pending.current),
      });
      pending.current = null;
      return result.entry;
    } catch (error) {
      if (error instanceof RequestError && error.status >= 400 && error.status < 500)
        pending.current = null;
      throw error;
    }
  }
  async function save() {
    setBusy(true);
    setNotice('');
    try {
      let entry =
        selected && files.some((file) => uploads.current.has(file))
          ? selected
          : await command({
              type: selected ? 'food.edit' : 'food.create',
              entryId: selected?.id ?? crypto.randomUUID(),
              expectedRevision: selected?.revision ?? 0,
              content: {
                text,
                occurredAt:
                  selected && time === local(selected.content.occurredAt, timezone)
                    ? selected.content.occurredAt
                    : instant(time, timezone),
                timezone,
              },
            });
      setSelected(entry);
      for (const file of files) {
        let upload = uploads.current.get(file);
        if (!upload) {
          upload = {
            operationId: crypto.randomUUID(),
            allocationId: crypto.randomUUID(),
            allocationRevision: entry.revision,
          };
          uploads.current.set(file, upload);
        }
        if (!upload.id) {
          const bytes = await file.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          const sha256 = Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
          const result = await request(`/api/food/${entry.id}/uploads`, FoodUploadResponseSchema, {
            method: 'POST',
            body: JSON.stringify({
              operationId: upload.allocationId,
              expectedRevision: upload.allocationRevision,
              size: file.size,
              sha256,
              contentType: file.type,
            }),
          });
          upload.id = result.upload.id;
        }
        await request(`/api/media/${upload.id}/content`, FoodUploadResponseSchema, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        upload.finalizeRevision ??= entry.revision;
        const result = await request(
          `/api/media/${upload.id}/finalize`,
          FoodCommandResponseSchema,
          {
            method: 'POST',
            body: JSON.stringify({
              operationId: upload.operationId,
              expectedRevision: upload.finalizeRevision,
            }),
          },
        );
        entry = result.entry;
        setSelected(entry);
        setFiles((current) => current.filter((candidate) => candidate !== file));
      }
      reset();
      await load();
      setNotice('Food entry saved.');
    } catch (error) {
      setNotice(`${(error as Error).message} Your text and remaining photos are retained here.`);
    } finally {
      setBusy(false);
    }
  }
  async function remove(entry: FoodEntry, photoId?: string) {
    if (busy || pending.current || files.some((file) => uploads.current.has(file))) {
      setNotice('Finish the pending save before deleting entries or removing photos.');
      return;
    }
    if (!photoId && !window.confirm('Delete this food entry? Its history will remain.')) return;
    setBusy(true);
    try {
      const next = await command({
        type: photoId ? 'food.detach' : 'food.delete',
        entryId: entry.id,
        expectedRevision: entry.revision,
        ...(photoId ? { photoId } : {}),
      });
      if (selected?.id === entry.id) {
        if (photoId) setSelected(next);
        else reset();
      }
      await load();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="food">
      <header>
        <p className="eyebrow">A simple record of what you ate</p>
        <h1>Food diary</h1>
      </header>
      <div role="status">{notice}</div>
      <div className="food-layout">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2>{selected ? 'Correct an entry' : 'What did you eat?'}</h2>
          <label>
            Notes
            <textarea
              disabled={pending.current !== null || files.some((file) => uploads.current.has(file))}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={20000}
            />
          </label>
          <label>
            Date and time
            <input
              disabled={pending.current !== null || files.some((file) => uploads.current.has(file))}
              type="datetime-local"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          <p>{timezone}</p>
          <p>
            At a daylight-saving gap the time moves forward; a repeated time uses the earlier
            offset.
          </p>
          <label>
            Add private photos (JPEG or PNG, up to 8 MB each)
            <input
              disabled={
                busy || pending.current !== null || files.some((file) => uploads.current.has(file))
              }
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(event) => {
                const next = Array.from(event.target.files ?? []);
                if (
                  next.some((file) => file.size > 8388608) ||
                  next.length + (selected?.photoIds.length ?? 0) > 12
                ) {
                  setNotice('Choose up to twelve photos, each no larger than 8 MB.');
                  return;
                }
                setFiles(next);
              }}
            />
          </label>
          <p>
            {files.length} photos waiting to upload. If an upload fails, Save entry resumes it;
            edits remain locked until its outcome is known. Keep this page open until saved.
          </p>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save entry'}</button>
          {selected && (
            <button
              type="button"
              onClick={reset}
              disabled={busy || files.length > 0 || pending.current !== null}
            >
              New entry
            </button>
          )}
        </form>
        <div>
          <label>
            Daily history
            <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          </label>
          {!loaded ? (
            <p>Loading entries…</p>
          ) : entries.length === 0 ? (
            <p>No food recorded for this day. Add a photo or a few words.</p>
          ) : (
            entries.map((entry) => (
              <article key={entry.id}>
                <time>
                  {new Date(entry.content.occurredAt).toLocaleString(undefined, {
                    timeZone: timezone,
                  })}
                </time>
                <p>{entry.content.text || 'Photo entry'}</p>
                <div className="food-photos">
                  {entry.photoIds.map((id) => (
                    <figure key={id}>
                      <PrivatePhoto id={id} />
                      <button disabled={busy} onClick={() => void remove(entry, id)}>
                        Remove photo
                      </button>
                    </figure>
                  ))}
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (!files.length && !pending.current) edit(entry);
                    else setNotice('Finish the current draft before opening another entry.');
                  }}
                >
                  Edit
                </button>
                <button disabled={busy} onClick={() => void remove(entry)}>
                  Delete
                </button>
                <button
                  onClick={() =>
                    void request(`/api/food/${entry.id}/history`, FoodHistorySchema)
                      .then((result) =>
                        setHistory(
                          result.events.map(
                            (event) =>
                              `${event.createdAt}: ${event.type} (revision ${event.entry.revision})`,
                          ),
                        ),
                      )
                      .catch((error) => setNotice(error.message))
                  }
                >
                  History
                </button>
              </article>
            ))
          )}
          {history.length > 0 && (
            <aside>
              <h2>Entry history</h2>
              <ul>
                {history.map((event) => (
                  <li key={event}>{event}</li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}
