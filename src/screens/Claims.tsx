import { useMemo, useRef, useState } from 'preact/hooks';
import { strToU8, zipSync } from 'fflate';
import { Icon } from '../ui/Icon';
import { EntryRow } from '../ui/EntryRow';
import { confirmWithOption, toast } from '../ui/feedback';
import { entryTitle, subName, useAllEntries, useRefs, type Refs } from '../lib/refs';
import { addMonths, claimCycle, claimMonthFor, daysBetween, fmtDay, monthLabel, today } from '../lib/dates';
import { money } from '../lib/money';
import { settleClaims, unsettleClaims } from '../lib/entries';
import { shareFile, toCsv } from '../lib/files';
import { openOverlay } from '../lib/nav';
import { db } from '../db/db';
import type { Entry } from '../db/types';

type View = 'pending' | 'settled';

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);

async function exportClaims(refs: Refs, list: Entry[], label: string, zip: boolean) {
  const def = refs.settings.defaultCurrency;
  const files: Record<string, Uint8Array> = {};
  const rows: (string | number)[][] = [
    ['Date', 'Category', 'Subcategory', 'Description', 'Currency', 'Amount', `Amount (${def})`, 'Trip', 'Status', 'Receipt'],
  ];
  let n = 0;
  for (const e of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
    const names: string[] = [];
    if (zip) {
      const receipts = await db.receipts.bulkGet(e.receiptIds);
      for (const r of receipts) {
        if (!r) continue;
        const ext = r.blob.type.includes('png') ? 'png' : 'jpg';
        const name = `receipts/${e.date}_${slug(entryTitle(refs, e))}_${++n}.${ext}`;
        files[name] = new Uint8Array(await r.blob.arrayBuffer());
        names.push(name);
      }
    }
    rows.push([
      e.date,
      refs.catById.get(e.categoryId)?.name ?? '',
      subName(refs, e) ?? '',
      e.note || e.tags.join('; '),
      e.currency,
      e.amount.toFixed(2),
      e.base.toFixed(2),
      e.tripId ? (refs.tripById.get(e.tripId)?.name ?? '') : '',
      e.claimStatus ?? '',
      names.join(' | ') || (e.receiptIds.length ? 'yes' : ''),
    ]);
  }
  const total = list.reduce((s, e) => s + e.base, 0);
  rows.push(['', '', '', 'Total', '', '', total.toFixed(2), '', '', '']);
  const csv = toCsv(rows);
  const base = `hiyo-claims-${slug(label)}`;
  if (!zip) return shareFile(new Blob([csv], { type: 'text/csv' }), `${base}.csv`, 'Claims');
  files[`${base}.csv`] = strToU8(csv);
  // Photos are already compressed; store without deflating them again.
  const out = zipSync(files, { level: 0 });
  return shareFile(new Blob([out], { type: 'application/zip' }), `${base}.zip`, 'Claims with receipts');
}

export function Claims() {
  const refs = useRefs();
  const all = useAllEntries();
  const now = today();
  const cutoff = refs?.settings.claimCutoffDay ?? 25;
  const [view, setView] = useState<View>('pending');
  const [cycleMonth, setCycleMonth] = useState(() => claimMonthFor(now, cutoff));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const cycle = claimCycle(cycleMonth, cutoff);
  const currentCycle = claimCycle(claimMonthFor(now, cutoff), cutoff);

  const data = useMemo(() => {
    if (!all) return null;
    const claims = all.filter((e) => e.claimStatus !== null);
    const pending = claims.filter((e) => e.claimStatus === 'pending');
    const settledInCycle = claims.filter((e) => e.claimStatus === 'settled' && e.date >= cycle.from && e.date <= cycle.to);
    const groups = new Map<string, Entry[]>();
    for (const e of pending) {
      const m = claimMonthFor(e.date, cutoff);
      groups.set(m, [...(groups.get(m) ?? []), e]);
    }
    const lastReimbursement = all.find((e) => e.type === 'income' && claims.some((c) => c.claimSettlementId === e.id));
    return {
      pending,
      pendingTotal: pending.reduce((s, e) => s + e.base, 0),
      groups: [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      settledInCycle,
      lastReimbursement,
    };
  }, [all, cycle.from, cycle.to, cutoff]);

  if (!refs || !data) return <main class="screen" />;
  const def = refs.settings.defaultCurrency;
  const selecting = selected.size > 0;
  const selList = (all ?? []).filter((e) => selected.has(e.id));
  const selTotal = selList.reduce((s, e) => s + e.base, 0);
  const daysLeft = daysBetween(now, currentCycle.to);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const rowProps = (e: Entry) => ({
    onPointerDown: () => {
      longPressed.current = false;
      press.current = setTimeout(() => {
        longPressed.current = true;
        toggle(e.id);
        navigator.vibrate?.(15);
      }, 450);
    },
    onPointerUp: () => press.current && clearTimeout(press.current),
    onPointerLeave: () => press.current && clearTimeout(press.current),
    onPointerCancel: () => press.current && clearTimeout(press.current),
  });

  const onRowClick = (e: Entry) => {
    if (longPressed.current) return void (longPressed.current = false);
    if (selecting) toggle(e.id);
    else openOverlay('entry', { id: e.id });
  };

  const row = (e: Entry) => (
    <div key={e.id} {...rowProps(e)} class={selected.has(e.id) ? 'press sel-row on' : 'press sel-row'}>
      <button
        class={selected.has(e.id) ? 'av check on' : 'av check'}
        aria-pressed={selected.has(e.id)}
        aria-label={`Select ${entryTitle(refs, e)}, ${money(e.base, def)}`}
        onClick={() => toggle(e.id)}
      >
        {selected.has(e.id) ? <Icon name="check" size={20} /> : refs.catById.get(e.categoryId)?.emoji}
      </button>
      <EntryRow e={e} refs={refs} showDate compact noAvatar onClick={() => onRowClick(e)} />
    </div>
  );

  async function settle() {
    const ids = [...selected];
    const pendingIds = selList.filter((e) => e.claimStatus === 'pending').map((e) => e.id);
    if (!pendingIds.length) return;
    const res = await confirmWithOption({
      title: `Settle ${pendingIds.length} ${pendingIds.length === 1 ? 'claim' : 'claims'}?`,
      body: `${money(selList.filter((e) => e.claimStatus === 'pending').reduce((s, e) => s + e.base, 0), def)} marked as reimbursed today.`,
      confirm: 'Settle',
      option: { label: 'Also log it as Claims income', checked: true },
    });
    if (!res.ok) return;
    await settleClaims(pendingIds, { logIncome: res.checked, date: now, currency: def });
    setSelected(new Set());
    toast(`Settled ${ids.length} ${ids.length === 1 ? 'claim' : 'claims'}${res.checked ? ' · income logged' : ''}`);
  }

  async function unsettle() {
    const ids = selList.filter((e) => e.claimStatus === 'settled').map((e) => e.id);
    await unsettleClaims(ids);
    setSelected(new Set());
    toast(`Moved ${ids.length} back to pending`);
  }

  async function doExport(zip: boolean) {
    const list = selecting ? selList : view === 'pending' ? data!.pending : data!.settledInCycle;
    if (!list.length) return toast('Nothing to export.');
    const label = view === 'pending' && !selecting ? `pending-${now}` : monthLabel(cycleMonth, 'short');
    const r = await exportClaims(refs!, list, label, zip);
    if (r === 'downloaded') toast('Export saved to Downloads');
  }

  return (
    <main class="screen">
      <header class="appbar">
        <h1>Claims</h1>
        <button class="iconbtn" aria-label="Export CSV" onClick={() => doExport(false)}>
          <Icon name="share" />
        </button>
      </header>

      <section class="hero wait">
        <div class="k">Owed to you</div>
        <div class="big num">{money(data.pendingTotal, def)}</div>
        <div class="minis">
          <div class="mini">
            <span>Cutoff{daysLeft >= 0 ? ` · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : ''}</span>
            <b>{fmtDay(currentCycle.to)}</b>
          </div>
          <div class="mini">
            <span>Last reimbursed</span>
            <b class="num">{data.lastReimbursement ? money(data.lastReimbursement.base, def) : '—'}</b>
          </div>
        </div>
      </section>

      <div class="seg" role="group" aria-label="Claim status">
        <button aria-pressed={view === 'pending'} onClick={() => { setView('pending'); setSelected(new Set()); }}>
          Pending · {data.pending.length}
        </button>
        <button aria-pressed={view === 'settled'} onClick={() => { setView('settled'); setSelected(new Set()); }}>
          Settled
        </button>
      </div>

      {view === 'pending' && (
        <>
          {data.pending.length === 0 ? (
            <div class="empty">
              <Icon name="check" />
              <b>All claims settled</b>
              <span>Work expenses marked claimable show up here.</span>
            </div>
          ) : (
            <>
              <p class="small muted">Long-press or tap an icon to select, then settle or export.</p>
              {data.groups.map(([m, list]) => {
                const c = claimCycle(m, cutoff);
                const allSel = list.every((e) => selected.has(e.id));
                return (
                  <section key={m} class="day-group">
                    <h3 class="day-head">
                      <button
                        class="link"
                        onClick={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            list.forEach((e) => (allSel ? n.delete(e.id) : n.add(e.id)));
                            return n;
                          })
                        }
                      >
                        {fmtDay(c.from)} – {fmtDay(c.to, { year: true })} · {allSel ? 'Clear' : 'Select all'}
                      </button>
                      <span class="num">{money(list.reduce((s, e) => s + e.base, 0), def)}</span>
                    </h3>
                    <div class="card list">{list.map(row)}</div>
                  </section>
                );
              })}
            </>
          )}
        </>
      )}

      {view === 'settled' && (
        <>
          <div class="cycle">
            <button class="iconbtn sm" aria-label="Previous cycle" onClick={() => setCycleMonth(addMonths(cycleMonth, -1))}>
              <Icon name="left" />
            </button>
            <div>
              {fmtDay(cycle.from)} – {fmtDay(cycle.to, { year: true })}
              <small class="num">
                {data.settledInCycle.length} settled · {money(data.settledInCycle.reduce((s, e) => s + e.base, 0), def)}
              </small>
            </div>
            <button
              class="iconbtn sm"
              aria-label="Next cycle"
              disabled={cycleMonth >= claimMonthFor(now, cutoff)}
              onClick={() => setCycleMonth(addMonths(cycleMonth, 1))}
            >
              <Icon name="right" />
            </button>
          </div>
          {data.settledInCycle.length === 0 ? (
            <div class="empty">
              <b>No settled claims in this cycle</b>
            </div>
          ) : (
            <div class="card list">{data.settledInCycle.map(row)}</div>
          )}
        </>
      )}

      {selecting && (
        <div class="actionbar" role="toolbar" aria-label="Selected claims">
          <button class="iconbtn" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <Icon name="close" />
          </button>
          <span class="count num">
            {selected.size} · {money(selTotal, def, { whole: selTotal >= 10000 })}
          </span>
          <button class="btn ghost" onClick={() => doExport(true)}>
            ZIP
          </button>
          {view === 'pending' ? (
            <button class="btn primary" onClick={settle}>
              Settle
            </button>
          ) : (
            <button class="btn primary" onClick={unsettle}>
              Unsettle
            </button>
          )}
        </div>
      )}
    </main>
  );
}
