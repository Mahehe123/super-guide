import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { confirmDialog, toast } from '../ui/feedback';
import { db } from '../db/db';
import type { Context, Entry, EntryType } from '../db/types';
import { useAllEntries, useRefs } from '../lib/refs';
import { quickPicks } from '../lib/stats';
import { money, symbolOf } from '../lib/money';
import { fmtDay, toDateStr, today } from '../lib/dates';
import { deleteEntries, saveEntry } from '../lib/entries';
import { compressImage } from '../lib/files';
import { newTemplate } from '../lib/recurring';
import { findTripByName, looksLikeTrip, tripKindFor } from '../lib/trips';
import { closeOverlay, openOverlay } from '../lib/nav';

type Photo = { id?: string; blob: Blob; url: string };

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
};

export function EntryForm({ id, type: initialType }: { id?: string; type?: EntryType }) {
  const refs = useRefs();
  const all = useAllEntries();
  const editing = !!id;

  const [loaded, setLoaded] = useState(!editing);
  const [original, setOriginal] = useState<Entry | null>(null);
  const [type, setType] = useState<EntryType>(initialType ?? 'expense');
  const [amountStr, setAmountStr] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [context, setContext] = useState<Context>('personal');
  const [claimable, setClaimable] = useState(true);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [tripId, setTripId] = useState<string | null | undefined>(undefined);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [repeat, setRepeat] = useState(false);
  /** Set when 'Create trip' was tapped for a tag; the new trip is picked up when it appears. */
  const [pendingTrip, setPendingTrip] = useState<{ tag: string; since: number } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  /* Load entry when editing */
  useEffect(() => {
    if (!id) return;
    (async () => {
      const e = await db.entries.get(id);
      if (!e) return closeOverlay();
      const rc = await db.receipts.bulkGet(e.receiptIds);
      setOriginal(e);
      setType(e.type);
      setAmountStr(String(e.amount));
      setCurrency(e.currency);
      setCategoryId(e.categoryId);
      setSubId(e.subId);
      setContext(e.context);
      setClaimable(e.claimStatus !== null);
      setDate(e.date);
      setNote(e.note);
      setTags(e.tags.join(', '));
      setTripId(e.tripId);
      setPhotos(rc.filter((r) => !!r).map((r) => ({ id: r!.id, blob: r!.blob, url: URL.createObjectURL(r!.blob) })));
      setLoaded(true);
    })();
  }, [id]);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const def = refs?.settings.defaultCurrency ?? 'MYR';
  const cur = currency ?? def;
  const amount = Number(amountStr.replace(/,/g, ''));
  // Keep the rate an entry was logged with; only a new/changed currency takes today's rate.
  const rate =
    cur === def ? 1 : original && original.currency === cur ? original.rate : (refs?.curByCode.get(cur)?.rate ?? 1);

  const cats = useMemo(
    () => refs?.categories.filter((c) => c.type === type && (!c.archived || c.id === categoryId)) ?? [],
    [refs, type, categoryId],
  );
  const cat = categoryId ? refs?.catById.get(categoryId) : undefined;
  const subs = cat?.subs.filter((s) => !s.archived || s.id === subId) ?? [];
  const picks = useMemo(() => (all && !editing ? quickPicks(all, type, today(), 6) : []), [all, type, editing]);

  /* Trip for this entry: chosen by hand, else a tag naming a trip, else a trip covering the date */
  const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
  const matchedTrip = refs ? tagList.map((t) => findTripByName(refs.trips, t)).find(Boolean) : undefined;
  const tripTag = refs ? tagList.find((t) => looksLikeTrip(t) && !findTripByName(refs.trips, t)) : undefined;
  const coveringTrip = refs?.trips.find((t) => t.start <= date && (t.end ?? t.start) >= date);
  const effectiveTrip = tripId === undefined ? (matchedTrip?.id ?? coveringTrip?.id ?? null) : tripId;

  // After 'Create trip' from a tag: select the new trip and drop the tag it replaces.
  useEffect(() => {
    if (!pendingTrip || !refs) return;
    const created = refs.trips.find((t) => t.createdAt >= pendingTrip.since);
    if (!created) return;
    setTripId(created.id);
    setTags((cur) =>
      cur
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && t.toLowerCase() !== pendingTrip.tag.toLowerCase())
        .join(', '),
    );
    setPendingTrip(null);
  }, [refs?.trips, pendingTrip]);

  if (!refs || !loaded) return <Sheet title={editing ? 'Edit entry' : 'New entry'}>{null}</Sheet>;

  function reset(keep: { date: string; context: Context }) {
    setAmountStr('');
    setCategoryId(null);
    setSubId(null);
    setNote('');
    setTags('');
    setTripId(undefined);
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setRemoved([]);
    setDate(keep.date);
    setContext(keep.context);
    setError(null);
    amountRef.current?.focus();
  }

  async function save(next: boolean) {
    if (!(amount > 0)) return setError('Enter an amount above zero.');
    if (!categoryId) return setError('Pick a category.');
    setSaving(true);
    try {
      const claimStatus =
        type === 'expense' && context === 'work' && claimable
          ? (original?.claimStatus ?? 'pending')
          : null;
      const e = await saveEntry(
        {
          id: original?.id,
          date,
          type,
          amount,
          currency: cur,
          rate,
          categoryId,
          subId,
          context,
          claimStatus,
          claimSettledAt: claimStatus ? (original?.claimSettledAt ?? null) : null,
          claimSettlementId: claimStatus ? (original?.claimSettlementId ?? null) : null,
          tripId: effectiveTrip,
          note: note.trim(),
          // A tag that names the entry's trip is redundant once the trip is set.
          tags: [...new Set(tagList)].filter((t) => !(effectiveTrip && matchedTrip?.id === effectiveTrip && t.toLowerCase() === matchedTrip.name.toLowerCase())),
          receiptIds: original?.receiptIds,
          recurringId: original?.recurringId ?? null,
        },
        photos.filter((p) => !p.id).map((p) => p.blob),
        removed,
      );
      if (repeat && !editing) {
        const t = newTemplate({
          type: e.type,
          amount: e.amount,
          currency: e.currency,
          categoryId: e.categoryId,
          subId: e.subId,
          context: e.context,
          claimable: e.claimStatus !== null,
          note: e.note,
          dayOfMonth: Math.min(Number(e.date.slice(8, 10)), 28),
          startMonth: e.date.slice(0, 7),
        });
        await db.recurring.add(t);
        await db.entries.update(e.id, { recurringId: t.id });
        setRepeat(false);
      }
      toast(`${editing ? 'Updated' : 'Saved'} · ${money(e.amount, e.currency)}${repeat && !editing ? ' · repeats monthly' : ''}`);
      if (next) {
        setSaving(false);
        reset({ date, context });
      } else closeOverlay();
    } catch (err) {
      console.error(err);
      setSaving(false);
      setError('Couldn’t save. Try again.');
    }
  }

  async function remove() {
    if (!original) return;
    const ok = await confirmDialog({ title: 'Delete this entry?', body: 'Its receipt photos are deleted too.', confirm: 'Delete', danger: true });
    if (!ok) return;
    const undo = await deleteEntries([original.id]);
    closeOverlay();
    toast('Entry deleted', { label: 'Undo', run: undo });
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const added: Photo[] = [];
    for (const f of Array.from(files)) {
      const blob = await compressImage(f);
      added.push({ blob, url: URL.createObjectURL(blob) });
    }
    setPhotos((p) => [...p, ...added]);
  }

  const dateChoice = date === today() ? 'today' : date === yesterday() ? 'yesterday' : 'other';

  return (
    <Sheet
      title={editing ? 'Edit entry' : 'New entry'}
      actions={
        editing && (
          <button class="iconbtn" aria-label="Delete entry" onClick={remove}>
            <Icon name="delete" />
          </button>
        )
      }
    >
      <div class="seg" role="group" aria-label="Entry type">
        {(['expense', 'income'] as const).map((t) => (
          <button
            key={t}
            aria-pressed={type === t}
            onClick={() => {
              if (t === type) return;
              setType(t);
              setCategoryId(null);
              setSubId(null);
            }}
          >
            {t === 'expense' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>

      <div class="amount-field">
        <label class="cur-select">
          <span class="sr-only">Currency</span>
          <select id="entry-currency" value={cur} onChange={(e) => setCurrency(e.currentTarget.value)}>
            {refs.currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <Icon name="down" size={16} />
        </label>
        <label class="amount-input">
          <span class="sr-only">Amount</span>
          <input
            id="entry-amount"
            ref={amountRef}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amountStr}
            autoFocus={!editing}
            onInput={(e) => {
              setAmountStr(e.currentTarget.value.replace(/[^\d.,]/g, ''));
              setError(null);
            }}
          />
        </label>
      </div>
      {cur !== def && amount > 0 && (
        <p class="fx-note num">
          ≈ {money(amount * rate, def)} at {symbolOf(def)} {rate.toFixed(4)} per {cur}
        </p>
      )}

      {picks.length > 0 && (
        <>
          <div class="label">Quick picks</div>
          <div class="chips scroll">
            {picks.map((p) => {
              const c = refs.catById.get(p.categoryId);
              const s = c?.subs.find((x) => x.id === p.subId);
              const on = categoryId === p.categoryId && subId === p.subId;
              return (
                <button
                  key={`${p.categoryId}|${p.subId}`}
                  class="chip"
                  aria-pressed={on}
                  onClick={() => {
                    setCategoryId(p.categoryId);
                    setSubId(p.subId);
                    setContext(p.context);
                    setCurrency(p.currency);
                    if (!amountStr) setAmountStr(String(p.amount));
                    setError(null);
                  }}
                >
                  {c?.emoji} {s?.name ?? c?.name}
                  <em class="num">{p.amount}</em>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div class="label">Category</div>
      <div class="cat-grid">
        {cats.map((c) => (
          <button
            key={c.id}
            class="cat"
            aria-pressed={categoryId === c.id}
            onClick={() => {
              setCategoryId(c.id);
              const live = c.subs.filter((s) => !s.archived);
              setSubId(live.length === 1 ? live[0].id : null);
              setError(null);
            }}
          >
            <span class="cat-ic" aria-hidden="true">
              {c.emoji}
            </span>
            <span class="cat-name">{c.name}</span>
          </button>
        ))}
      </div>

      {subs.length > 0 && (
        <div class="chips">
          {subs.map((s) => (
            <button key={s.id} class="chip" aria-pressed={subId === s.id} onClick={() => setSubId(subId === s.id ? null : s.id)}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div class="form-grid">
        <div class="seg" role="group" aria-label="Personal or work">
          {(['personal', 'work'] as const).map((c) => (
            <button key={c} aria-pressed={context === c} onClick={() => setContext(c)}>
              {c === 'personal' ? 'Personal' : 'Work'}
            </button>
          ))}
        </div>
        {type === 'expense' && context === 'work' && (
          <label class="switch-row">
            <span>
              Claimable
              <small>{original?.claimStatus === 'settled' ? 'Already settled' : 'Shows in Claims until settled'}</small>
            </span>
            <input type="checkbox" role="switch" checked={claimable} onChange={(e) => setClaimable(e.currentTarget.checked)} />
          </label>
        )}
      </div>

      <div class="label">Date</div>
      <div class="chips">
        <button class="chip" aria-pressed={dateChoice === 'today'} onClick={() => setDate(today())}>
          Today
        </button>
        <button class="chip" aria-pressed={dateChoice === 'yesterday'} onClick={() => setDate(yesterday())}>
          Yesterday
        </button>
        <label class="chip date-chip" aria-pressed={dateChoice === 'other'}>
          <Icon name="calendar" />
          {dateChoice === 'other'
            ? fmtDay(date, { weekday: true, year: true })
            : 'Pick date'}
          <input
            id="entry-date"
            type="date"
            value={date}
            max="2099-12-31"
            onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)}
          />
        </label>
      </div>

      <label class="field">
        <span>Note</span>
        <input id="entry-note" value={note} placeholder="e.g. Customer lunch" onInput={(e) => setNote(e.currentTarget.value)} />
      </label>

      <label class="field">
        <span>Tags · separate with commas</span>
        <input id="entry-tags" value={tags} placeholder="Customer, Team lunch" onInput={(e) => setTags(e.currentTarget.value)} />
      </label>

      {tripTag && (
        <div class="card notice tag-trip">
          <Icon name="flight" />
          <span class="grow">
            <b>“{tripTag}” looks like a trip</b>
            <span class="small">Make it a trip to see its total and claims together.</span>
          </span>
          <button
            class="btn tonal"
            onClick={() => {
              const dates = [date, ...(all ?? []).filter((x) => !x.tripId && x.tags.includes(tripTag)).map((x) => x.date)].sort();
              setPendingTrip({ tag: tripTag, since: Date.now() });
              openOverlay('trip-edit', {
                prefill: {
                  name: tripTag,
                  kind: context === 'work' ? 'work' : tripKindFor(tripTag),
                  start: dates[0],
                  end: dates[dates.length - 1],
                  tag: tripTag,
                },
              });
            }}
          >
            Create trip
          </button>
        </div>
      )}
      {matchedTrip && tripId === undefined && (
        <p class="small muted">Tag matches the trip “{matchedTrip.name}”, so this entry goes into it.</p>
      )}

      {refs.trips.length > 0 && (
        <label class="field">
          <span>Trip{coveringTrip && tripId === undefined ? ' · added automatically for these dates' : ''}</span>
          <select id="entry-trip" value={effectiveTrip ?? ''} onChange={(e) => setTripId(e.currentTarget.value || null)}>
            <option value="">No trip</option>
            {refs.trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div class="label">Receipts</div>
      <div class="photos">
        {photos.map((p, i) => (
          <div class="photo" key={p.url}>
            <button class="photo-open" aria-label={`Open receipt ${i + 1}`} onClick={() => openOverlay('receipt', { url: p.url })}>
              <img src={p.url} alt="" />
            </button>
            <button
              class="photo-x"
              aria-label={`Remove receipt ${i + 1}`}
              onClick={() => {
                if (p.id) setRemoved((r) => [...r, p.id!]);
                setPhotos((list) => list.filter((x) => x !== p));
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        <label class="photo add">
          <Icon name="camera" />
          <span>Camera</span>
          {/* capture opens the rear camera directly */}
          <input
            id="entry-receipt-camera"
            type="file"
            accept="image/*"
            capture="environment"
            class="sr-only"
            onChange={(e) => {
              addPhotos(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <label class="photo add">
          <Icon name="attach" />
          <span>Attach</span>
          {/* no capture: opens the gallery / files, e.g. screenshots */}
          <input
            id="entry-receipt"
            type="file"
            accept="image/*"
            multiple
            class="sr-only"
            onChange={(e) => {
              addPhotos(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
        </label>
      </div>

      {!editing ? (
        <label class="switch-row">
          <span>
            Repeat every month
            <small>Logs itself on day {Math.min(Number(date.slice(8, 10)), 28)} each month</small>
          </span>
          <input type="checkbox" role="switch" checked={repeat} onChange={(e) => setRepeat(e.currentTarget.checked)} />
        </label>
      ) : (
        original?.recurringId && (
          <button class="switch-row as-link" onClick={() => openOverlay('recurring-edit', { id: original.recurringId })}>
            <span>
              Part of a recurring bill
              <small>Change the amount or schedule for future months</small>
            </span>
            <Icon name="right" />
          </button>
        )
      )}

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <div class="savebar">
        {!editing && (
          <button class="btn tonal" disabled={saving} onClick={() => save(true)}>
            Save &amp; next
          </button>
        )}
        <button class="btn primary" disabled={saving} onClick={() => save(false)}>
          {amount > 0 ? `Save · ${money(amount, cur)}` : 'Save'}
        </button>
      </div>
    </Sheet>
  );
}

export function ReceiptViewer({ url }: { url: string }) {
  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Receipt">
      <button class="iconbtn viewer-x" aria-label="Close" onClick={closeOverlay}>
        <Icon name="close" />
      </button>
      <img src={url} alt="Receipt" />
    </div>
  );
}
