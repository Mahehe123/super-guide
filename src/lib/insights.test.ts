import { describe, expect, it } from 'vitest';
import type { Category, Entry, Recurring } from '../db/types';
import { averages, categoryBreakdown, dailySpend, insightsFor, monthSeries, suggestBudgets } from './insights';
import { dueOccurrences } from './recurring';

const TODAY = '2026-09-15';

describe('recurring due list', () => {
  const t: Recurring = {
    id: 'r1', type: 'expense', amount: 20, currency: 'MYR', categoryId: 'bills', subId: null, context: 'personal',
    note: 'Streaming', dayOfMonth: 20, startMonth: '2026-07', endMonth: null, mode: 'auto', active: true, createdAt: 0,
  };
  it('lists unlogged, unskipped months up to today', () => {
    expect(dueOccurrences([t], [], TODAY).map((d) => d.date)).toEqual(['2026-07-20', '2026-08-20']);
    expect(dueOccurrences([{ ...t, skipped: ['2026-07'] }], [], TODAY).map((d) => d.month)).toEqual(['2026-08']);
    expect(dueOccurrences([{ ...t, active: false }], [], TODAY)).toEqual([]);
    expect(dueOccurrences([{ ...t, dayOfMonth: 31, startMonth: '2026-02', endMonth: '2026-02' }], [], TODAY)[0].date).toBe('2026-02-28');
  });
});

describe('insights', () => {
  const e = (date: string, base: number, p: Partial<Entry> = {}): Entry => ({
    id: Math.random().toString(36), date, type: 'expense', amount: base, currency: 'MYR', rate: 1, base, categoryId: 'food',
    subId: null, context: 'personal', claimStatus: null, claimSettledAt: null, claimSettlementId: null, tripId: null, note: '',
    tags: [], receiptIds: [], recurringId: null, createdAt: 0, updatedAt: 0, ...p,
  });
  const inc = (date: string, base: number) => e(date, base, { type: 'income', categoryId: 'pay' });
  const entries = [
    e('2027-01-20', 100), // partial first month (starts after the 7th)
    inc('2027-02-25', 4000), e('2027-02-03', 1000), e('2027-02-10', 500, { categoryId: 'fun' }),
    inc('2027-03-25', 4000), e('2027-03-03', 1200), e('2027-03-10', 3000, { categoryId: 'fun', note: 'Concert' }),
    e('2027-04-02', 900),
  ];
  const cats = new Map<string, Category>([
    ['food', { id: 'food', type: 'expense', name: 'Food', emoji: '', order: 0, subs: [] }],
    ['fun', { id: 'fun', type: 'expense', name: 'Fun', emoji: '', order: 1, subs: [] }],
  ]);

  it('month series and averages skip partial months', () => {
    const s = monthSeries(entries, '2027-04-10');
    expect(s.map((p) => p.month)).toEqual(['2027-01', '2027-02', '2027-03', '2027-04']);
    expect(s.map((p) => p.partial)).toEqual([true, false, false, true]);
    const a = averages(s)!;
    expect(a).toMatchObject({ months: 2, income: 4000, expense: 2850, positive: 1 });
    expect(a.savingsRate).toBeCloseTo(0.2875, 4);
  });

  it('breakdown, calendar and written insights', () => {
    const rows = categoryBreakdown(entries, '2027-03', [{ categoryId: 'food', monthlyLimit: 1000 }]);
    expect(rows[0]).toMatchObject({ categoryId: 'fun', amount: 3000 });
    expect(rows[1]).toMatchObject({ categoryId: 'food', budget: 1000 });
    expect(dailySpend(entries, '2027-03')[9]).toBe(3000);
    const notes = insightsFor(entries, cats, '2027-03', '2027-04-10');
    expect(notes.find((n) => n.id === 'share')!.text).toBe('Fun makes up 71% of spending.');
    expect(notes.find((n) => n.id === 'big')!.text).toMatch(/^Biggest one-off: Concert/);
    expect(notes.find((n) => n.id === 'saved')!.text).toBe('Spent RM 200 more than came in.');
  });

  it('suggests budgets from the last 3 months, rounded up to 50', () => {
    const b = suggestBudgets(entries, '2027-04-10');
    expect(b.get('food')).toBe(800); // (100 + 1000 + 1200) / 3 = 766.67 → 800
    expect(b.get('fun')).toBe(1200); // 3500 / 3 = 1166.67 → 1200
  });
});
