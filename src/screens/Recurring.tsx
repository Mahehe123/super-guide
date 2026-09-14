import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { confirmDialog, toast } from '../ui/feedback';
import { db } from '../db/db';
import type { Context, EntryType, Recurring } from '../db/types';
import { useAllEntries, useRefs, type Refs } from '../lib/refs';
import { fmtDay, monthLabel, monthOf, today } from '../lib/dates';
import { money } from '../lib/money';
import { nextOccurrences } from '../lib/stats';
import { dueOccurrences, logOccurrence, newTemplate, skipOccurrence, type Due } from '../lib/recurring';
import { closeOverlay, openOverlay } from '../lib/nav';

const label = (refs: Refs, t: Recurring) =>
  t.note || refs.catById.get(t.categoryId)?.subs.find((s) => s.id === t.subId)?.name || refs.catById.get(t.categoryId)?.name || 'Recurring';

/** Home card: bills set to "ask me" that are due. */
export function DueConfirmCard() {
  const refs = useRefs();
  const all = useAllEntries();
  const due = useMemo(
    () => (refs && all ? dueOccurrences(refs.recurring.filter((t) => t.mode === 'confirm'), all, today()) : []),
    [refs, all],
  );
  if (!refs || !due.length) return null;
  const d = due[0];

  return (
    <section class="card due-card">
      <div class="label">
        Recurring · due {fmtDay(d.date)}
        {due.length > 1 && <span class="muted">+{due.length - 1} more</span>}
      </div>
      <div class="row">
        <span class="av" aria-hidden="true">
          {refs.catById.get(d.template.categoryId)?.emoji}
        </span>
        <span class="mid">
          <span class="t1">{label(refs, d.template)}</span>
          <span class="t2">{monthLabel(d.month)}</span>
        </span>
        <span class="amt num">{money(d.template.amount, d.template.currency)}</span>
      </div>
      <div class="btn-row">
        <button class="btn primary" onClick={() => log(d)}>
          Log it
        </button>
        <button class="btn" onClick={() => skip(d)}>
          Skip this month
        </button>
      </div>
    </section>
  );

  async function log(x: Due) {
    await logOccurrence(x);
    toast(`Logged ${label(refs!, x.template)}`);
  }
  async function skip(x: Due) {
    await skipOccurrence(x);
    toast(`Skipped ${label(refs!, x.template)} for ${monthLabel(x.month, 'short')}`);
  }
}

export function RecurringSheet() {
  const refs = useRefs();
  const all = useAllEntries();
  if (!refs || !all) return <Sheet title="Recurring bills" icon="back">{null}</Sheet>;

  const now = today();
  const def = refs.settings.defaultCurrency;
  const due = dueOccurrences(refs.recurring, all, now);
  const next = new Map(nextOccurrences(refs.recurring, all, refs.curByCode, now).map((o) => [o.template.id, o]));
  const active = refs.recurring.filter((t) => t.active && (!t.endMonth || t.endMonth >= monthOf(now)));
  const inactive = refs.recurring.filter((t) => !active.includes(t));
  const monthly = (type: EntryType) =>
    active.filter((t) => t.type === type).reduce((s, t) => s + t.amount * (t.currency === def ? 1 : (refs.curByCode.get(t.currency)?.rate ?? 1)), 0);

  const row = (t: Recurring) => {
    const n = next.get(t.id);
    return (
      <button key={t.id} class="row" onClick={() => openOverlay('recurring-edit', { id: t.id })}>
        <span class="av" aria-hidden="true">
          {refs.catById.get(t.categoryId)?.emoji}
        </span>
        <span class="mid">
          <span class="t1">{label(refs, t)}</span>
          <span class="t2">
            {!t.active
              ? 'Paused'
              : t.endMonth && t.endMonth < monthOf(now)
                ? `Ended ${monthLabel(t.endMonth, 'short')}`
                : n
                  ? `Next ${fmtDay(n.date)}`
                  : 'Up to date'}
            {t.active && t.endMonth && t.endMonth >= monthOf(now) ? ` · until ${monthLabel(t.endMonth, 'short')}` : ''}
            <span class={t.mode === 'auto' ? 'pill tag' : 'pill wait'}>{t.mode === 'auto' ? 'Auto' : 'Asks'}</span>
          </span>
        </span>
        <span class={t.type === 'income' ? 'amt num pos' : 'amt num'}>{money(t.amount, t.currency)}</span>
      </button>
    );
  };

  return (
    <Sheet
      title="Recurring bills"
      icon="back"
      actions={
        <button class="iconbtn" aria-label="New recurring" onClick={() => openOverlay('recurring-edit')}>
          <Icon name="add" />
        </button>
      }
    >
      <div class="stat3">
        <div>
          <span>Bills / month</span>
          <b class="num">{money(monthly('expense'), def, { whole: true })}</b>
        </div>
        <div>
          <span>Income / month</span>
          <b class="num">{money(monthly('income'), def, { whole: true })}</b>
        </div>
        <div>
          <span>Active</span>
          <b class="num">{active.length}</b>
        </div>
      </div>
      <p class="small muted">
        <b>Auto</b> bills are logged on their day when you open Hiyo. <b>Asks</b> bills wait on Home for you to confirm.
      </p>

      {due.length > 0 && (
        <section class="card list">
          <div class="label list-head">Waiting for you</div>
          {due.map((d) => (
            <div key={`${d.template.id}|${d.month}`} class="row">
              <span class="mid">
                <span class="t1">{label(refs, d.template)}</span>
                <span class="t2">
                  {fmtDay(d.date, { year: true })} · {money(d.template.amount, d.template.currency)}
                </span>
              </span>
              <button class="btn text" onClick={async () => { await skipOccurrence(d); toast('Skipped'); }}>
                Skip
              </button>
              <button class="btn tonal" onClick={async () => { await logOccurrence(d); toast('Logged'); }}>
                Log
              </button>
            </div>
          ))}
        </section>
      )}

      {active.length > 0 ? (
        <section class="card list">{active.map(row)}</section>
      ) : (
        <div class="empty">
          <Icon name="repeat" />
          <b>No recurring bills</b>
          <span>Add loans, insurance, subscriptions or salary so they log themselves.</span>
        </div>
      )}

      {inactive.length > 0 && (
        <>
          <div class="label">Paused or ended</div>
          <section class="card list">{inactive.map(row)}</section>
        </>
      )}
    </Sheet>
  );
}

export function RecurringForm({ id, from }: { id?: string; from?: Partial<Recurring> }) {
  const refs = useRefs();
  const [t, setT] = useState<Recurring | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      db.recurring.get(id).then((x) => {
        if (!x) return closeOverlay();
        setT(x);
        setAmountStr(String(x.amount));
      });
    } else if (refs) {
      const cat = refs.categories.find((c) => c.type === (from?.type ?? 'expense') && !c.archived)!;
      const base = newTemplate({ type: 'expense', amount: 0, currency: refs.settings.defaultCurrency, categoryId: cat.id, ...from });
      setT(base);
      setAmountStr(base.amount ? String(base.amount) : '');
    }
  }, [id, !!refs]);

  if (!refs || !t) return <Sheet title={id ? 'Edit recurring' : 'New recurring'}>{null}</Sheet>;
  const set = (p: Partial<Recurring>) => setT({ ...t, ...p });
  const cats = refs.categories.filter((c) => c.type === t.type && (!c.archived || c.id === t.categoryId));
  const subs = refs.catById.get(t.categoryId)?.subs.filter((s) => !s.archived || s.id === t.subId) ?? [];

  async function save() {
    const amount = Number(amountStr.replace(/,/g, ''));
    if (!(amount > 0)) return setError('Enter an amount above zero.');
    if (t!.endMonth && t!.endMonth < t!.startMonth) return setError('The last month is before the first month.');
    await db.recurring.put({ ...t!, amount });
    closeOverlay();
    toast(id ? 'Recurring updated' : 'Recurring added');
  }

  async function remove() {
    const ok = await confirmDialog({
      title: 'Delete this recurring bill?',
      body: 'Entries it already logged stay. Nothing new will be logged.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await db.transaction('rw', db.recurring, db.entries, async () => {
      await db.entries.where('recurringId').equals(t!.id).modify({ recurringId: null });
      await db.recurring.delete(t!.id);
    });
    closeOverlay();
    toast('Recurring deleted');
  }

  return (
    <Sheet
      title={id ? 'Edit recurring' : 'New recurring'}
      actions={
        id && (
          <button class="iconbtn" aria-label="Delete recurring" onClick={remove}>
            <Icon name="delete" />
          </button>
        )
      }
    >
      <div class="seg" role="group" aria-label="Type">
        {(['expense', 'income'] as const).map((k) => (
          <button
            key={k}
            aria-pressed={t.type === k}
            onClick={() => {
              const c = refs.categories.find((x) => x.type === k && !x.archived);
              set({ type: k, categoryId: c?.id ?? t.categoryId, subId: null });
            }}
          >
            {k === 'expense' ? 'Bill / expense' : 'Income'}
          </button>
        ))}
      </div>
      <div class="two-col">
        <label class="field">
          <span>Amount</span>
          <input id="rec-amount" inputMode="decimal" value={amountStr} placeholder="0.00" onInput={(e) => setAmountStr(e.currentTarget.value.replace(/[^\d.,]/g, ''))} />
        </label>
        <label class="field">
          <span>Currency</span>
          <select id="rec-currency" value={t.currency} onChange={(e) => set({ currency: e.currentTarget.value })}>
            {refs.currencies.map((c) => (
              <option key={c.code}>{c.code}</option>
            ))}
          </select>
        </label>
      </div>
      <label class="field">
        <span>Name</span>
        <input id="rec-note" value={t.note} placeholder="e.g. House loan" onInput={(e) => set({ note: e.currentTarget.value })} />
      </label>
      <div class="two-col">
        <label class="field">
          <span>Category</span>
          <select id="rec-cat" value={t.categoryId} onChange={(e) => set({ categoryId: e.currentTarget.value, subId: null })}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Subcategory</span>
          <select id="rec-sub" value={t.subId ?? ''} onChange={(e) => set({ subId: e.currentTarget.value || null })}>
            <option value="">None</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="seg" role="group" aria-label="Personal or work">
        {(['personal', 'work'] as Context[]).map((c) => (
          <button key={c} aria-pressed={t.context === c} onClick={() => set({ context: c })}>
            {c === 'personal' ? 'Personal' : 'Work'}
          </button>
        ))}
      </div>
      <div class="three-col">
        <label class="field">
          <span>Day of month</span>
          <select id="rec-day" value={t.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.currentTarget.value) })}>
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>First month</span>
          <input id="rec-start" type="month" value={t.startMonth} onChange={(e) => e.currentTarget.value && set({ startMonth: e.currentTarget.value })} />
        </label>
        <label class="field">
          <span>Last month</span>
          <input id="rec-end" type="month" value={t.endMonth ?? ''} min={t.startMonth} onChange={(e) => set({ endMonth: e.currentTarget.value || null })} />
        </label>
      </div>
      <div class="seg" role="group" aria-label="How to log">
        <button aria-pressed={t.mode === 'auto'} onClick={() => set({ mode: 'auto' })}>
          Log automatically
        </button>
        <button aria-pressed={t.mode === 'confirm'} onClick={() => set({ mode: 'confirm' })}>
          Ask me first
        </button>
      </div>
      <label class="switch-row">
        <span>
          Active
          <small>Paused bills don’t log or show as due</small>
        </span>
        <input type="checkbox" role="switch" checked={t.active} onChange={(e) => set({ active: e.currentTarget.checked })} />
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <button class="btn primary block" onClick={save}>
        {id ? 'Save' : 'Add recurring'}
      </button>
    </Sheet>
  );
}
