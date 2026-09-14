import type { DateStr, MonthStr } from '../db/types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): DateStr {
  return toDateStr(new Date());
}

export function monthOf(date: DateStr): MonthStr {
  return date.slice(0, 7);
}

export function addMonths(month: MonthStr, n: number): MonthStr {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(month: MonthStr): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Whole days from a to b (b later = positive). */
export function daysBetween(a: DateStr, b: DateStr): number {
  const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Claim cycle for the month the cycle *ends* in.
 * cutoff 25, month 2026-09 → 2026-08-26 .. 2026-09-25 (same rule as Kira).
 */
export function claimCycle(month: MonthStr, cutoffDay: number): { from: DateStr; to: DateStr } {
  const prev = addMonths(month, -1);
  const fromDay = Math.min(cutoffDay + 1, daysInMonth(prev));
  const toDay = Math.min(cutoffDay, daysInMonth(month));
  return { from: `${prev}-${pad(fromDay)}`, to: `${month}-${pad(toDay)}` };
}

/** The claim-cycle month a date falls in. */
export function claimMonthFor(date: DateStr, cutoffDay: number): MonthStr {
  const day = Number(date.slice(8, 10));
  return day > cutoffDay ? addMonths(monthOf(date), 1) : monthOf(date);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "14 Sep", "Mon, 14 Sep", "14 Sep 2026" */
export function fmtDay(date: DateStr, o: { weekday?: boolean; year?: boolean } = {}): string {
  const d = new Date(date + 'T00:00:00');
  const wd = o.weekday ? `${WEEKDAYS[d.getDay()]}, ` : '';
  return `${wd}${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${o.year ? ` ${d.getFullYear()}` : ''}`;
}

/** "September 2026" or "Sep 2026" (fixed names; en-MY would give "Sept"). */
export function monthLabel(month: MonthStr, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS[m - 1];
  return `${style === 'short' ? name.slice(0, 3) : name} ${y}`;
}
