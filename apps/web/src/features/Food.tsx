import { useEffect, useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import {
  formatFoodDay,
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
    setUrl('');
    setError('');
    fetch(`/api/media/${id}`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Photo unavailable');
        const blob = await response.blob();
        if (disposed) return;
        objectURL = URL.createObjectURL(blob);
        setUrl(objectURL);
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
function DraftPhotos({ files }: { files: File[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((file) => URL.createObjectURL(file));
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  return (
    <div className="food-photos">
      {urls.map((url, index) => (
        <figure key={url}>
          <img src={url} alt={`Selected food photo ${index + 1}`} />
        </figure>
      ))}
    </div>
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
  const [composerOpen, setComposerOpen] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const addEntryButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (composerOpen) notesInput.current?.focus();
  }, [composerOpen]);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [day, setDay] = useState(() => local(new Date().toISOString(), timezone).slice(0, 10));
  const [text, setText] = useState('');
  const [time, setTime] = useState(() => local(new Date().toISOString(), timezone));
  const initialTime = useRef(time);
  const query = useRef({ day, timezone });
  query.current = { day, timezone };
  const [selected, setSelected] = useState<FoodEntry | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const pending = useRef<Record<string, unknown> | null>(null);
  const loadGeneration = useRef(0);
  const historyGeneration = useRef(0);
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
    const generation = ++loadGeneration.current;
    const current = query.current;
    setLoaded(false);
    try {
      const result = await request(
        `/api/food?date=${current.day}&timezone=${encodeURIComponent(current.timezone)}`,
        FoodListResponseSchema,
      );
      if (generation !== loadGeneration.current) return;
      setEntries(result.entries);
      setLoaded(true);
    } catch (error) {
      if (generation === loadGeneration.current) setNotice((error as Error).message);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current++;
    };
  }, [day, timezone]);
  const hasDraft = () =>
    !!pending.current ||
    files.length > 0 ||
    text !== (selected?.content.text ?? '') ||
    time !== (selected ? local(selected.content.occurredAt, timezone) : initialTime.current);
  useEffect(() => {
    if (!focusTarget || handledFocus.current === focusTarget || !loaded || busy) return;
    handledFocus.current = focusTarget;
    if (hasDraft()) {
      setNotice('Save or discard the current food draft before opening another entry.');
      return;
    }
    if (!focusTarget.id) {
      reset();
      setComposerOpen(true);
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
    setComposerOpen(true);
    setSelected(entry);
    setText(entry.content.text);
    setTime(local(entry.content.occurredAt, timezone));
    setFiles([]);
    setHistory([]);
    historyGeneration.current++;
    pending.current = null;
    uploads.current.clear();
  }
  function reset() {
    setSelected(null);
    setText('');
    initialTime.current = local(new Date().toISOString(), timezone);
    setTime(initialTime.current);
    setFiles([]);
    setHistory([]);
    historyGeneration.current++;
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
    if (busy) return;
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
      setComposerOpen(false);
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
  const locked =
    busy || pending.current !== null || files.some((file) => uploads.current.has(file));
  const changeDay = (amount: number) =>
    setDay(Temporal.PlainDate.from(day).add({ days: amount }).toString());
  const dayLabel = formatFoodDay(day);
  function begin() {
    if (!hasDraft()) reset();
    setComposerOpen(true);
  }
  function showHistory(entry: FoodEntry) {
    const generation = ++historyGeneration.current;
    void request(`/api/food/${entry.id}/history`, FoodHistorySchema)
      .then((result) => {
        if (generation !== historyGeneration.current) return;
        setHistory(
          result.events.map(
            (event) =>
              `${new Date(event.createdAt).toLocaleString()}: ${event.type === 'food.create' ? 'Entry added' : event.type === 'food.edit' ? 'Entry edited' : event.type === 'food.delete' ? 'Entry deleted' : event.type === 'food.detach' ? 'Photo removed' : 'Photo added'}`,
          ),
        );
      })
      .catch((error) => {
        if (generation === historyGeneration.current) setNotice(error.message);
      });
  }
  let displayTime = 'Review date and time';
  try {
    displayTime = new Date(instant(time, timezone)).toLocaleString(undefined, {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    /* Native input validates incomplete values. */
  }
  let timeNotice = '';
  if (time !== initialTime.current) {
    try {
      const plain = Temporal.PlainDateTime.from(time);
      const earlier = plain.toZonedDateTime(timezone, { disambiguation: 'earlier' });
      const later = plain.toZonedDateTime(timezone, { disambiguation: 'later' });
      if (earlier.epochMilliseconds !== later.epochMilliseconds)
        timeNotice = earlier.toPlainDateTime().equals(plain)
          ? 'This time occurs twice. The first occurrence will be saved.'
          : `This time falls in the clock change. It will be saved as ${local(instant(time, timezone), timezone).slice(11)}.`;
    } catch {
      /* The input's validation handles incomplete values. */
    }
  }
  return (
    <section className="food" aria-label="Food diary">
      <div role="status">{notice}</div>
      <header className="food-day">
        <div className="food-day-navigation">
          <button type="button" aria-label="Previous day" onClick={() => changeDay(-1)}>
            ‹
          </button>
          <h2>{dayLabel}</h2>
          <button type="button" aria-label="Next day" onClick={() => changeDay(1)}>
            ›
          </button>
        </div>
        <label className="food-calendar">
          Choose day
          <input
            aria-label="Daily history"
            type="date"
            value={day}
            onChange={(event) => {
              if (event.target.value) setDay(event.target.value);
            }}
          />
        </label>
        <div className="food-actions">
          <button
            type="button"
            onClick={() => {
              begin();
              photoInput.current?.click();
            }}
          >
            Add photo
          </button>
          <button
            type="button"
            ref={addEntryButton}
            className={!composerOpen ? 'food-add-entry' : undefined}
            onClick={begin}
          >
            {!composerOpen && (hasDraft() || selected) ? 'Resume draft' : 'Add entry'}
          </button>
        </div>
      </header>
      <div className={`food-layout ${composerOpen ? 'food-layout-editing' : ''}`}>
        <div className="food-timeline">
          {!loaded && (
            <>
              <p>Loading entries…</p>
              <button type="button" onClick={() => void load()}>
                Retry food history
              </button>
            </>
          )}
          {loaded && entries.length === 0 && (
            <div className="food-empty">
              <h3>No food recorded</h3>
              <button
                type="button"
                ref={addEntryButton}
                className={!composerOpen ? 'food-add-entry' : undefined}
                onClick={begin}
              >
                Add your first entry
              </button>
            </div>
          )}
          {loaded &&
            entries.map((entry) => (
              <article key={entry.id}>
                <time>
                  {new Date(entry.content.occurredAt).toLocaleTimeString(undefined, {
                    timeZone: timezone,
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
                <p>{entry.content.text || 'Photo entry'}</p>
                <div className="food-photos">
                  {entry.photoIds.map((id) => (
                    <figure key={id}>
                      <PrivatePhoto id={id} />
                    </figure>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!hasDraft()) edit(entry);
                    else if (selected?.id === entry.id) setComposerOpen(true);
                    else setNotice('Finish the current draft before opening another entry.');
                  }}
                >
                  Edit entry
                </button>
                <details>
                  <summary>More</summary>
                  <button type="button" disabled={busy} onClick={() => showHistory(entry)}>
                    Entry history
                  </button>
                  {entry.photoIds.map((id, index) => (
                    <button
                      type="button"
                      key={id}
                      disabled={busy}
                      onClick={() => void remove(entry, id)}
                    >
                      Remove photo {index + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="food-destructive"
                    disabled={busy}
                    onClick={() => void remove(entry)}
                  >
                    Delete entry
                  </button>
                </details>
              </article>
            ))}
          {history.length > 0 && (
            <aside>
              <h3>Entry history</h3>
              <ul>
                {history.map((event, index) => (
                  <li key={index}>{event}</li>
                ))}
              </ul>
            </aside>
          )}
        </div>
        <form
          hidden={!composerOpen}
          className="food-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2>{selected ? 'Edit entry' : 'Add entry'}</h2>
          <label className="food-photo-picker">
            Add photos
            <input
              ref={photoInput}
              disabled={locked}
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(event) => {
                const next = Array.from(event.target.files ?? []);
                if (
                  next.some(
                    (file) =>
                      file.size > 8388608 || !['image/jpeg', 'image/png'].includes(file.type),
                  ) ||
                  next.length + files.length + (selected?.photoIds.length ?? 0) > 12
                ) {
                  setNotice('Choose up to twelve JPEG or PNG photos, each no larger than 8 MB.');
                  return;
                }
                setFiles((current) => [...current, ...next]);
                event.target.value = '';
              }}
            />
          </label>
          {files.length > 0 && <DraftPhotos files={files} />}
          <label>
            What did you eat?
            <textarea
              ref={notesInput}
              disabled={locked}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={20000}
              placeholder="Add a few words (optional)"
            />
          </label>
          <details className="food-time">
            <summary>Time · {displayTime}</summary>
            <label>
              Date and time
              <input
                disabled={locked}
                type="datetime-local"
                required
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
            {timezone !== deviceTimezone && <p>Times use {timezone}.</p>}
            {timeNotice && <p>{timeNotice}</p>}
          </details>
          {files.length > 0 && (
            <p>
              {files.length} {files.length === 1 ? 'photo' : 'photos'} waiting to upload.
            </p>
          )}
          <div className="food-actions">
            <button disabled={busy} className="food-save">
              {busy ? 'Saving…' : 'Save entry'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setComposerOpen(false);
                addEntryButton.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
          {(hasDraft() || selected) && (
            <details>
              <summary>More</summary>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (
                    window.confirm(
                      'Discard this food draft? Unsaved notes and photo selections will be removed.',
                    )
                  ) {
                    reset();
                    setComposerOpen(false);
                  }
                }}
              >
                Discard draft
              </button>
            </details>
          )}
        </form>
      </div>
    </section>
  );
}
