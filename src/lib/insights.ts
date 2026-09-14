import type { Budget, Category, DateStr, Entry, MonthStr } from '../db/types';
import { addMonths, daysInMonth, fmtDay, monthOf } from './dates';
import { money } from './money';
import { inMonth, totals } from './stats';

/* ---------- Month series ---------- */

export interface MonthPoint {
  month: MonthStr;
  income: number;
  expense: number;
  net: number;
  /** Current month, or the first month the data only partly covers */
  partial: boolean;
}

export function monthSeries(entries: Entry[], today: DateStr, max = 12): MonthPoint[] {
  if (!entries.length) return [];
  const dates = entries.map((e) => e.date).sort();
  const first = monthOf(dates[0]);
  const last = monthOf(today) > monthOf(dates[dates.length - 1]) ? monthOf(today) : monthOf(dates[dates.length - 1]);
  const months: MonthStr[] = [];
  for (let m = last; m >= first && months.length < max; m = addMonths(m, -1)) months.unshift(m);
  return months.map((month) => {
    const t = totals(entries.filter((e) => inMonth(e, month)));
    // A month is partial if it's still running, or data starts after its 7th.
    const partial = month === monthOf(today) || (month === first && Number(dates[0].slice(8, 10)) > 7);
    return { month, ...t, partial };
  });
}

export function averages(series: MonthPoint[]) {
  const full = series.filter((p) => !p.partial && (p.income > 0 || p.expense > 0));
  if (!full.length) return null;
  const income = full.reduce((s, p) => s + p.income, 0) / full.length;
  const expense = full.reduce((s, p) => s + p.expense, 0) / full.length;
  return {
    months: full.length,
    income,
    expense,
    savingsRate: income > 0 ? (income - expense) / income : null,
    positive: full.filter((p) => p.net >= 0).length,
  };
}

/* ---------- Category breakdown ---------- */

export interface CategoryRow {
  categoryId: string;
  amount: number;
  count: number;
  /** Average of the 3 months before */
  avg3: number;
  budget: number | null;
}

export function categoryBreakdown(entries: Entry[], month: MonthStr, budgets: Budget[] = []): CategoryRow[] {
  const budgetBy = new Map(budgets.map((b) => [b.categoryId, b.monthlyLimit]));
  const rows = new Map<string, CategoryRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { categoryId: id, amount: 0, count: 0, avg3: 0, budget: budgetBy.get(id) ?? null }));
    return r;
  };
  const prev = [1, 2, 3].map((i) => addMonths(month, -i));
  for (const e of entries) {
    if (e.type !== 'expense') continue;
    if (inMonth(e, month)) {
      const r = row(e.categoryId);
      r.amount += e.base;
      r.count++;
    } else if (prev.some((m) => inMonth(e, m))) {
      row(e.categoryId).avg3 += e.base / 3;
    }
  }
  for (const [id, limit] of budgetBy) if (!rows.has(id) && limit > 0) row(id);
  return [...rows.values()].filter((r) => r.amount > 0 || r.budget).sort((a, b) => b.amount - a.amount);
}

export function topSubcategories(entries: Entry[], month: MonthStr, n = 5) {
  const m = new Map<string, { categoryId: string; subId: string | null; amount: number; count: number }>();
  for (const e of entries) {
    if (e.type !== 'expense' || !inMonth(e, month)) continue;
    const k = `${e.categoryId}|${e.subId}`;
    const r = m.get(k) ?? { categoryId: e.categoryId, subId: e.subId, amount: 0, count: 0 };
    r.amount += e.base;
    r.count++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

/** Spending per day of month (index 0 = day 1). */
export function dailySpend(entries: Entry[], month: MonthStr): number[] {
  const days = new Array(daysInMonth(month)).fill(0);
  for (const e of entries) if (e.type === 'expense' && inMonth(e, month)) days[Number(e.date.slice(8, 10)) - 1] += e.base;
  return days;
}

export function contextSplit(entries: Entry[], month: MonthStr) {
  const list = entries.filter((e) => e.type === 'expense' && inMonth(e, month));
  const work = list.filter((e) => e.context === 'work').reduce((s, e) => s + e.base, 0);
  const total = list.reduce((s, e) => s + e.base, 0);
  return { personal: total - work, work, claimable: list.filter((e) => e.claimStatus).reduce((s, e) => s + e.base, 0) };
}

/* ---------- Written insights ---------- */

export interface Insight {
  id: string;
  tone: 'good' | 'watch' | 'info';
  text: string;
}

export function insightsFor(
  entries: Entry[],
  cats: Map<string, Category>,
  month: MonthStr,
  today: DateStr,
  currency = 'MYR',
): Insight[] {
  const out: Insight[] = [];
  const monthList = entries.filter((e) => inMonth(e, month));
  const exp = monthList.filter((e) => e.type === 'expense');
  if (!exp.length) return out;
  const t = totals(monthList);
  const running = month === monthOf(today);
  const name = (id: string) => cats.get(id)?.name ?? 'Other';

  // 1. Where most of it went
  const rows = categoryBreakdown(entries, month);
  const top = rows[0];
  if (top && t.expense > 0) {
    const share = top.amount / t.expense;
    if (share >= 0.25)
      out.push({ id: 'share', tone: 'info', text: `${name(top.categoryId)} makes up ${Math.round(share * 100)}% of spending${running ? ' so far' : ''}.` });
  }

  // 2. Biggest shifts vs the 3-month average (only meaningful for complete months or big moves)
  const shifts = rows
    .filter((r) => r.avg3 > 0 && Math.abs(r.amount - r.avg3) >= 150)
    .map((r) => ({ ...r, change: (r.amount - r.avg3) / r.avg3 }))
    .filter((r) => (running ? r.change > 0.3 : Math.abs(r.change) > 0.3))
    .sort((a, b) => Math.abs(b.amount - b.avg3) - Math.abs(a.amount - a.avg3));
  for (const s of shifts.slice(0, 2)) {
    const up = s.change > 0;
    out.push({
      id: `shift-${s.categoryId}`,
      tone: up ? 'watch' : 'good',
      text: `${name(s.categoryId)} ${up ? 'up' : 'down'} ${Math.round(Math.abs(s.change) * 100)}% on your 3-month average (${money(s.amount, currency, { whole: true })} vs ${money(s.avg3, currency, { whole: true })}).`,
    });
  }

  // 3. Largest one-off (ignoring recurring bills)
  const big = exp.filter((e) => !e.recurringId).sort((a, b) => b.base - a.base)[0];
  if (big && big.base >= t.expense * 0.1) {
    const label = big.note || cats.get(big.categoryId)?.subs.find((s) => s.id === big.subId)?.name || name(big.categoryId);
    out.push({ id: 'big', tone: 'info', text: `Biggest one-off: ${label}, ${money(big.base, currency)} on ${fmtDay(big.date)}.` });
  }

  // 4. Savings rate for a finished month
  if (!running && t.income > 0) {
    const rate = t.net / t.income;
    out.push({
      id: 'saved',
      tone: rate >= 0 ? 'good' : 'watch',
      text: rate >= 0 ? `You kept ${Math.round(rate * 100)}% of your income.` : `Spent ${money(-t.net, currency, { whole: true })} more than came in.`,
    });
  }

  // 5. No-spend days (excluding days not yet lived)
  const days = dailySpend(entries, month);
  const lived = running ? Number(today.slice(8, 10)) : days.length;
  const zero = days.slice(0, lived).filter((d) => d === 0).length;
  if (zero >= 3) out.push({ id: 'nospend', tone: 'good', text: `${zero} no-spend ${zero === 1 ? 'day' : 'days'}${running ? ' so far' : ''}.` });

  return out;
}

/* ---------- Budgets ---------- */

/** Suggested monthly limit per category: average of the last 3 complete months, rounded up to RM 50. */
export function suggestBudgets(entries: Entry[], today: DateStr): Map<string, number> {
  const months = [1, 2, 3].map((i) => addMonths(monthOf(today), -i));
  const sums = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== 'expense' || !months.some((m) => inMonth(e, m))) continue;
    sums.set(e.categoryId, (sums.get(e.categoryId) ?? 0) + e.base);
  }
  const out = new Map<string, number>();
  for (const [id, sum] of sums) {
    const avg = sum / 3;
    if (avg >= 20) out.set(id, Math.ceil(avg / 50) * 50);
  }
  return out;
}
