import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { EntryRow } from '../ui/EntryRow';
import { Meter } from '../ui/charts';
import { confirmDialog, toast } from '../ui/feedback';
import { db, uid } from '../db/db';
import type { Trip, TripKind } from '../db/types';
import { useAllEntries, useRefs } from '../lib/refs';
import { fmtDay, today } from '../lib/dates';
import { money } from '../lib/money';
import { closeOverlay, openOverlay } from '../lib/nav';
import { tagTripSuggestions } from '../lib/trips';

const KIND_LABEL: Record<TripKind, string> = { work: 'Work', holiday: 'Holiday', other: 'Other' };

function range(t: Trip) {
  if (!t.end || t.end === t.start) return fmtDay(t.start, { year: true });
  return `${fmtDay(t.start)} – ${fmtDay(t.end, { year: true })}`;
}

export function TripsSheet() {
  const refs = useRefs();
  const all = useAllEntries();
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all ?? []) if (e.tripId && e.type === 'expense') m.set(e.tripId, (m.get(e.tripId) ?? 0) + e.base);
    return m;
  }, [all]);
  const suggestions = useMemo(() => (all && refs ? tagTripSuggestions(all, refs.trips) : []), [all, refs]);

  return (
    <Sheet
      title="Trips"
      icon="back"
      actions={
        <button class="iconbtn" aria-label="New trip" onClick={() => openOverlay('trip-edit')}>
          <Icon name="add" />
        </button>
      }
    >
      {suggestions.length > 0 && (
        <>
          <div class="label">Found in your tags</div>
          <section class="card list">
            {suggestions.map((s) => (
              <div key={s.key} class="row">
                <span class="av">
                  <Icon name="flight" size={20} />
                </span>
                <span class="mid">
                  <span class="t1">{s.name}</span>
                  <span class="t2">
                    {s.start === s.end ? fmtDay(s.start, { year: true }) : `${fmtDay(s.start)} – ${fmtDay(s.end, { year: true })}`} · {s.entryIds.length}{' '}
                    {s.entryIds.length === 1 ? 'entry' : 'entries'}
                  </span>
                </span>
                <button
                  class="btn tonal"
                  onClick={() => openOverlay('trip-edit', { prefill: { name: s.name, kind: s.kind, start: s.start, end: s.end, tag: s.tag } })}
                >
                  Create
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {refs && refs.trips.length === 0 && (
        <div class="empty">
          <Icon name="flight" />
          <b>No trips yet</b>
          <span>Group a work trip or holiday to see its total and claims in one place.</span>
          <button class="btn primary" onClick={() => openOverlay('trip-edit')}>
            New trip
          </button>
        </div>
      )}
      {refs && refs.trips.length > 0 && (
        <section class="card list">
          {refs.trips.map((t) => (
            <button key={t.id} class="row" onClick={() => openOverlay('trip', { id: t.id })}>
              <span class="av">
                <Icon name="flight" size={20} />
              </span>
              <span class="mid">
                <span class="t1">{t.name}</span>
                <span class="t2">
                  {range(t)} · {KIND_LABEL[t.kind]}
                </span>
              </span>
              <span class="amt num">{money(totals.get(t.id) ?? 0, refs.settings.defaultCurrency, { whole: true })}</span>
            </button>
          ))}
        </section>
      )}
    </Sheet>
  );
}

export function TripDetail({ id }: { id: string }) {
  const refs = useRefs();
  const all = useAllEntries();
  const trip = refs?.tripById.get(id);
  const list = useMemo(() => (all ?? []).filter((e) => e.tripId === id), [all, id]);

  if (!refs || !all) return <Sheet title="Trip" icon="back">{null}</Sheet>;
  if (!trip)
    return (
      <Sheet title="Trip" icon="back">
        <div class="empty">
          <b>This trip was deleted</b>
        </div>
      </Sheet>
    );

  const def = refs.settings.defaultCurrency;
  const exp = list.filter((e) => e.type === 'expense');
  const total = exp.reduce((s, e) => s + e.base, 0);
  const byCat = new Map<string, number>();
  for (const e of exp) byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.base);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const pending = list.filter((e) => e.claimStatus === 'pending');
  const settled = list.filter((e) => e.claimStatus === 'settled');
  const currencies = [...new Set(list.map((e) => e.currency))];

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${trip!.name}”?`,
      body: `Its ${list.length} entries stay; they just won’t be grouped under this trip.`,
      confirm: 'Delete trip',
      danger: true,
    });
    if (!ok) return;
    await db.transaction('rw', db.trips, db.entries, async () => {
      await db.entries.where('tripId').equals(id).modify({ tripId: null });
      await db.trips.delete(id);
    });
    closeOverlay();
    toast('Trip deleted');
  }

  return (
    <Sheet
      title="Trip"
      icon="back"
      actions={
        <>
          <button class="iconbtn" aria-label="Edit trip" onClick={() => openOverlay('trip-edit', { id })}>
            <Icon name="edit" />
          </button>
          <button class="iconbtn" aria-label="Delete trip" onClick={remove}>
            <Icon name="delete" />
          </button>
        </>
      }
    >
      <section class="card trip-hero">
        <div class="trip-top">
          <span class="av brand">
            <Icon name="flight" />
          </span>
          <div>
            <h3>{trip.name}</h3>
            <p>
              {range(trip)} · {KIND_LABEL[trip.kind]} · {list.length} {list.length === 1 ? 'entry' : 'entries'}
              {currencies.length > 1 ? ` · ${currencies.join(' + ')}` : ''}
            </p>
          </div>
        </div>
        <div>
          <span class="small muted">Total spent</span>
          <div class="trip-total num">{money(total, def)}</div>
        </div>
      </section>

      {(pending.length > 0 || settled.length > 0) && (
        <div class="stat3">
          <div class="tint-ok">
            <span>Settled</span>
            <b class="num">{settled.length}</b>
          </div>
          <div class="tint-wait">
            <span>Pending</span>
            <b class="num">{pending.length}</b>
          </div>
          <div>
            <span>Owed</span>
            <b class="num">{money(pending.reduce((s, e) => s + e.base, 0), def, { whole: true })}</b>
          </div>
        </div>
      )}

      {cats.length > 0 && (
        <section class="card list">
          <div class="label list-head">By category</div>
          {cats.map(([cid, amt]) => {
            const c = refs.catById.get(cid);
            return (
              <div key={cid} class="cat-row">
                <span class="av" aria-hidden="true">
                  {c?.emoji}
                </span>
                <span class="mid">
                  <span class="cat-row-top">
                    <span class="t1">{c?.name}</span>
                    <span class="amt num">{money(amt, def)}</span>
                  </span>
                  <Meter value={amt} max={cats[0][1]} />
                  <span class="t2">{Math.round((amt / total) * 100)}% of trip</span>
                </span>
              </div>
            );
          })}
        </section>
      )}

      <section class="card list">
        <div class="label list-head">Entries</div>
        {list.length === 0 ? (
          <p class="small muted" style={{ paddingBottom: 12 }}>
            No entries yet. Entries dated inside this trip are added to it automatically.
          </p>
        ) : (
          list.map((e) => <EntryRow key={e.id} e={e} refs={refs} showDate hideTrip onClick={() => openOverlay('entry', { id: e.id })} />)
        )}
      </section>
    </Sheet>
  );
}

export interface TripPrefill {
  name: string;
  kind: TripKind;
  start: string;
  end: string;
  /** Tag the trip was suggested from; its entries move into the trip and lose the tag */
  tag?: string;
}

export function TripForm({ id, prefill }: { id?: string; prefill?: TripPrefill }) {
  const refs = useRefs();
  const [name, setName] = useState(prefill?.name ?? '');
  const [kind, setKind] = useState<TripKind>(prefill?.kind ?? 'work');
  const [start, setStart] = useState(prefill?.start ?? today());
  const [end, setEnd] = useState(prefill?.end ?? today());
  const [attach, setAttach] = useState(!prefill?.tag);
  const [moveTagged, setMoveTagged] = useState(!!prefill?.tag);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (!id) return;
    db.trips.get(id).then((t) => {
      if (!t) return closeOverlay();
      setName(t.name);
      setKind(t.kind);
      setStart(t.start);
      setEnd(t.end ?? t.start);
      setAttach(false);
      setLoaded(true);
    });
  }, [id]);

  const allEntries = useAllEntries();
  const candidates = useMemo(
    () => (allEntries ?? []).filter((x) => x.date >= start && x.date <= end && !x.tripId && (kind !== 'work' || x.context === 'work')).length,
    [allEntries, start, end, kind],
  );
  const tagged = useMemo(
    () => (prefill?.tag ? (allEntries ?? []).filter((x) => !x.tripId && x.date >= start && x.date <= end && x.tags.includes(prefill.tag!)) : []),
    [allEntries, start, end, prefill?.tag],
  );

  async function save() {
    if (!name.trim()) return setError('Give the trip a name.');
    if (end < start) return setError('The end date is before the start date.');
    const trip: Trip = {
      id: id ?? `trip-${uid()}`,
      name: name.trim(),
      kind,
      start,
      end,
      currency: null,
      createdAt: Date.now(),
    };
    await db.transaction('rw', db.trips, db.entries, async () => {
      const old = id ? await db.trips.get(id) : undefined;
      await db.trips.put({ ...trip, createdAt: old?.createdAt ?? trip.createdAt });
      if (moveTagged && prefill?.tag) {
        const tag = prefill.tag;
        await db.entries
          .where('date')
          .between(start, end, true, true)
          .filter((e) => !e.tripId && e.tags.includes(tag))
          .modify((e) => {
            e.tripId = trip.id;
            e.tags = e.tags.filter((t) => t !== tag);
          });
      }
      if (attach)
        await db.entries
          .where('date')
          .between(start, end, true, true)
          .filter((e) => !e.tripId && (kind !== 'work' || e.context === 'work'))
          .modify({ tripId: trip.id });
    });
    closeOverlay();
    toast(id ? 'Trip updated' : 'Trip created');
  }

  if (!refs || !loaded) return <Sheet title={id ? 'Edit trip' : 'New trip'}>{null}</Sheet>;

  return (
    <Sheet title={id ? 'Edit trip' : 'New trip'}>
      <label class="field">
        <span>Name</span>
        <input id="trip-name" value={name} placeholder="e.g. Bangkok work trip" onInput={(e) => setName(e.currentTarget.value)} autoFocus={!id} />
      </label>
      <div class="seg" role="group" aria-label="Kind">
        {(['work', 'holiday', 'other'] as const).map((k) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div class="two-col">
        <label class="field">
          <span>Start</span>
          <input id="trip-start" type="date" value={start} onChange={(e) => { const v = e.currentTarget.value; setStart(v); if (end < v) setEnd(v); }} />
        </label>
        <label class="field">
          <span>End</span>
          <input id="trip-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.currentTarget.value)} />
        </label>
      </div>
      {prefill?.tag && (
        <label class="switch-row">
          <span>
            Move entries tagged “{prefill.tag}”
            <small>
              {tagged.length} {tagged.length === 1 ? 'entry' : 'entries'} in these dates · the tag is replaced by the trip
            </small>
          </span>
          <input type="checkbox" role="switch" checked={moveTagged} onChange={(e) => setMoveTagged(e.currentTarget.checked)} />
        </label>
      )}
      <label class="switch-row">
        <span>
          {prefill?.tag ? 'Also add other entries in these dates' : 'Add existing entries'}
          <small>
            {candidates} {kind === 'work' ? 'work ' : ''}
            {candidates === 1 ? 'entry' : 'entries'} in these dates without a trip
          </small>
        </span>
        <input type="checkbox" role="switch" checked={attach} onChange={(e) => setAttach(e.currentTarget.checked)} />
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <button class="btn primary block" onClick={save}>
        {id ? 'Save trip' : 'Create trip'}
      </button>
    </Sheet>
  );
}
