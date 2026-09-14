import type { Category, Currency, DateStr, Entry, EntryType, MonthStr, Recurring } from '../db/types';
import { addMonths, daysInMonth, monthOf, toDateStr } from './dates';

export const inMonth = (e: Entry, month: MonthStr) => e.date.startsWith(month);

export function totals(list: Entry[]) {
  let income = 0;
  let expense = 0;
  for (const e of list) {
    if (e.type === 'income') income += e.base;
    else expense += e.base;
  }
  return { income, expense, net: income - expense };
}

/** Income categories that are reimbursements, not earnings. */
export function isClaimsCategory(c: Category | undefined): boolean {
  return !!c && c.type === 'income' && (c.id === 'clm' || /claim/i.test(c.name));
}

/* ---------- Spending pace ---------- */

export interface Pace {
  day: number;
  thisSpent: number;
  lastSpent: number;
  /** null when last month had no spending to compare */
  pct: number | null;
  /** Category that grew the most vs the same days last month */
  driver: { categoryId: string; delta: number; amount: number } | null;
}

export function pace(entries: Entry[], month: MonthStr, today: DateStr): Pace {
  const isCurrent = monthOf(today) === month;
  const day = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(month);
  const prev = addMonths(month, -1);
  const prevDay = Math.min(day, daysInMonth(prev));
  const pad = (n: number) => String(n).padStart(2, '0');
  const cur = entries.filter((e) => e.type === 'expense' && e.date >= `${month}-01` && e.date <= `${month}-${pad(day)}`);
  const last = entries.filter((e) => e.type === 'expense' && e.date >= `${prev}-01` && e.date <= `${prev}-${pad(prevDay)}`);

  const byCat = (list: Entry[]) => {
    const m = new Map<string, number>();
    for (const e of list) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.base);
    return m;
  };
  const a = byCat(cur);
  const b = byCat(last);
  let driver: Pace['driver'] = null;
  for (const [categoryId, amount] of a) {
    const delta = amount - (b.get(categoryId) ?? 0);
    if (delta > 0 && (!driver || delta > driver.delta)) driver = { categoryId, delta, amount };
  }

  const thisSpent = totals(cur).expense;
  const lastSpent = totals(last).expense;
  return { day, thisSpent, lastSpent, pct: lastSpent > 0 ? (thisSpent - lastSpent) / lastSpent : null, driver };
}

/* ---------- Expected income (salary not in yet) ---------- */

export interface ExpectedIncome {
  amount: number;
  dayFrom: number;
  dayTo: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * For the current month only: if regular income (excluding claim reimbursements)
 * hasn't arrived yet, estimate it from the last 3 months.
 */
export function expectedIncome(
  entries: Entry[],
  categories: Map<string, Category>,
  month: MonthStr,
  today: DateStr,
): ExpectedIncome | null {
  if (monthOf(today) !== month) return null;
  const regular = (e: Entry) => e.type === 'income' && !isClaimsCategory(categories.get(e.categoryId));

  const sums: number[] = [];
  const days: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const m = addMonths(month, -i);
    const list = entries.filter((e) => regular(e) && inMonth(e, m));
    if (!list.length) continue;
    sums.push(totals(list).income);
    // Day the biggest payment landed
    days.push(Number(list.reduce((a, b) => (b.base > a.base ? b : a)).date.slice(8, 10)));
  }
  if (sums.length < 2) return null;

  const expected = median(sums);
  const received = totals(entries.filter((e) => regular(e) && inMonth(e, month))).income;
  if (received >= expected * 0.5) return null;
  return { amount: expected - received, dayFrom: Math.min(...days), dayTo: Math.max(...days) };
}

/* ---------- Claims ---------- */

export function pendingClaims(entries: Entry[]) {
  const list = entries.filter((e) => e.claimStatus === 'pending');
  return { list, total: list.reduce((s, e) => s + e.base, 0), count: list.length };
}

/* ---------- Recurring ---------- */

export interface Occurrence {
  template: Recurring;
  date: DateStr;
  base: number;
}

/** Next unlogged occurrence of each active template (overdue ones included). */
export function nextOccurrences(
  templates: Recurring[],
  entries: Entry[],
  currencies: Map<string, Currency>,
  today: DateStr,
): Occurrence[] {
  const out: Occurrence[] = [];
  const logged = new Set(entries.filter((e) => e.recurringId).map((e) => `${e.recurringId}|${monthOf(e.date)}`));
  for (const t of templates) {
    if (!t.active) continue;
    for (let i = 0; i <= 1; i++) {
      const m = addMonths(monthOf(today), i);
      if (m < t.startMonth || (t.endMonth && m > t.endMonth)) continue;
      if (logged.has(`${t.id}|${m}`) || t.skipped?.includes(m)) continue;
      const day = Math.min(t.dayOfMonth, daysInMonth(m));
      const rate = currencies.get(t.currency)?.rate ?? 1;
      out.push({ template: t, date: `${m}-${String(day).padStart(2, '0')}`, base: t.amount * rate });
      break;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The soonest due date and everything due on it. */
export function nextDue(occ: Occurrence[], type: EntryType = 'expense') {
  const list = occ.filter((o) => o.template.type === type);
  if (!list.length) return null;
  const date = list[0].date;
  const same = list.filter((o) => o.date === date);
  return { date, count: same.length, total: same.reduce((s, o) => s + o.base, 0) };
}

/* ---------- Quick picks ---------- */

export interface QuickPick {
  categoryId: string;
  subId: string | null;
  amount: number;
  currency: string;
  context: Entry['context'];
  count: number;
}

/** Most-used category/subcategory combos of the last 120 days, with their usual amount. */
export function quickPicks(entries: Entry[], type: EntryType, today: DateStr, limit = 6): QuickPick[] {
  const since = new Date(today + 'T00:00:00');
  since.setDate(since.getDate() - 120);
  const from = toDateStr(since);
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.type !== type || e.date < from || e.recurringId) continue;
    const k = `${e.categoryId}|${e.subId ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const mode = <T,>(xs: T[]) => {
    const c = new Map<T, number>();
    let best = xs[0];
    for (const x of xs) {
      const n = (c.get(x) ?? 0) + 1;
      c.set(x, n);
      if (n > (c.get(best) ?? 0)) best = x;
    }
    return best;
  };
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, limit)
    .map((g) => ({
      categoryId: g[0].categoryId,
      subId: g[0].subId,
      amount: mode(g.map((e) => e.amount)),
      currency: mode(g.map((e) => e.currency)),
      context: mode(g.map((e) => e.context)),
      count: g.length,
    }));
}
