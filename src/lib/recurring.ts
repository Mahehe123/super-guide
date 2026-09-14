import { db, uid } from '../db/db';
import type { Currency, DateStr, Entry, MonthStr, Recurring } from '../db/types';
import { addMonths, daysInMonth, monthOf, toDateStr } from './dates';

const pad = (n: number) => String(n).padStart(2, '0');

export function occurrenceDate(t: Recurring, month: MonthStr): DateStr {
  return `${month}-${pad(Math.min(t.dayOfMonth, daysInMonth(month)))}`;
}

function runsIn(t: Recurring, month: MonthStr) {
  return month >= t.startMonth && (!t.endMonth || month <= t.endMonth);
}

export interface Due {
  template: Recurring;
  month: MonthStr;
  date: DateStr;
}

/**
 * Occurrences on or before today that haven't been logged or skipped.
 * Looks back at most 12 months so a long break doesn't flood the list.
 */
export function dueOccurrences(templates: Recurring[], entries: Entry[], today: DateStr): Due[] {
  const logged = new Set(entries.filter((e) => e.recurringId).map((e) => `${e.recurringId}|${monthOf(e.date)}`));
  const out: Due[] = [];
  const now = monthOf(today);
  for (const t of templates) {
    if (!t.active) continue;
    for (let i = 11; i >= 0; i--) {
      const m = addMonths(now, -i);
      if (!runsIn(t, m)) continue;
      const date = occurrenceDate(t, m);
      if (date > today || logged.has(`${t.id}|${m}`) || t.skipped?.includes(m)) continue;
      out.push({ template: t, month: m, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function entryFromTemplate(t: Recurring, date: DateStr, currencies: Map<string, Currency>, def: string): Entry {
  const rate = t.currency === def ? 1 : (currencies.get(t.currency)?.rate ?? 1);
  const now = Date.now();
  return {
    id: uid(),
    date,
    type: t.type,
    amount: t.amount,
    currency: t.currency,
    rate,
    base: t.amount * rate,
    categoryId: t.categoryId,
    subId: t.subId,
    context: t.context,
    claimStatus: null,
    claimSettledAt: null,
    claimSettlementId: null,
    tripId: null,
    note: t.note,
    tags: [],
    receiptIds: [],
    recurringId: t.id,
    createdAt: now,
    updatedAt: now,
  };
}

/** Creates entries for due "auto" templates. Returns how many were logged. */
export async function runAutoRecurring(today: DateStr): Promise<number> {
  return db.transaction('rw', [db.recurring, db.entries, db.currencies, db.meta], async () => {
    const templates = (await db.recurring.toArray()).filter((t) => t.mode === 'auto');
    if (!templates.length) return 0;
    const ids = templates.map((t) => t.id);
    const entries = await db.entries.where('recurringId').anyOf(ids).toArray();
    const due = dueOccurrences(templates, entries, today);
    if (!due.length) return 0;
    const currencies = new Map((await db.currencies.toArray()).map((c) => [c.code, c]));
    const settings = await db.meta.get('settings');
    const def = settings?.value.defaultCurrency ?? 'MYR';
    await db.entries.bulkAdd(due.map((d) => entryFromTemplate(d.template, d.date, currencies, def)));
    return due.length;
  });
}

export async function logOccurrence(d: Due, amount?: number) {
  const currencies = new Map((await db.currencies.toArray()).map((c) => [c.code, c]));
  const settings = await db.meta.get('settings');
  const e = entryFromTemplate(d.template, d.date, currencies, settings?.value.defaultCurrency ?? 'MYR');
  if (amount !== undefined && amount > 0) {
    e.amount = amount;
    e.base = amount * e.rate;
  }
  await db.entries.add(e);
  return e;
}

export async function skipOccurrence(d: Due) {
  const t = await db.recurring.get(d.template.id);
  if (!t) return;
  await db.recurring.update(t.id, { skipped: [...new Set([...(t.skipped ?? []), d.month])] });
}

export function newTemplate(p: Partial<Recurring> & Pick<Recurring, 'type' | 'amount' | 'currency' | 'categoryId'>): Recurring {
  const today = new Date();
  return {
    id: `rec-${uid()}`,
    subId: null,
    context: 'personal',
    note: '',
    dayOfMonth: Math.min(today.getDate(), 28),
    startMonth: monthOf(toDateStr(today)),
    endMonth: null,
    mode: 'auto',
    active: true,
    createdAt: Date.now(),
    ...p,
  };
}
