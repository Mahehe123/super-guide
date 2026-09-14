import { describe, expect, it } from 'vitest';
import type { Category, Entry, Recurring } from '../db/types';
import { expectedIncome, nextDue, nextOccurrences, pace, pendingClaims, quickPicks, totals } from './stats';
import { claimCycle, claimMonthFor } from './dates';

const e = (p: Partial<Entry>): Entry => ({
  id: Math.random().toString(36), date: '2027-03-01', type: 'expense', currency: 'MYR', rate: 1, base: 10,
  categoryId: 'food', subId: 'food-1', context: 'personal', claimStatus: null, claimSettledAt: null, claimSettlementId: null,
  tripId: null, note: '', tags: [], receiptIds: [], recurringId: null, createdAt: 0, updatedAt: 0, ...p,
  amount: p.amount ?? p.base ?? 10,
});

const cats = new Map<string, Category>([
  ['pay', { id: 'pay', type: 'income', name: 'Salary', emoji: '', order: 0, subs: [] }],
  ['clm', { id: 'clm', type: 'income', name: 'Claims', emoji: '', order: 1, subs: [] }],
]);

describe('claim cycles', () => {
  it('follows the cutoff day', () => {
    expect(claimCycle('2026-09', 25)).toEqual({ from: '2026-08-26', to: '2026-09-25' });
    expect(claimCycle('2026-03', 30)).toEqual({ from: '2026-02-28', to: '2026-03-30' });
    expect(claimMonthFor('2026-09-26', 25)).toBe('2026-10');
    expect(claimMonthFor('2026-09-25', 25)).toBe('2026-09');
  });
});

describe('home stats', () => {
  const pay = (date: string, base: number) => e({ date, type: 'income', categoryId: 'pay', amount: base, base });
  const entries = [
    pay('2027-01-24', 5000), pay('2027-02-26', 5200), pay('2027-03-25', 5100),
    e({ date: '2027-03-30', type: 'income', categoryId: 'clm', base: 300 }), // reimbursement: not "income"
    e({ date: '2027-03-02', base: 100 }), e({ date: '2027-03-09', base: 300, categoryId: 'fun' }),
    e({ date: '2027-04-02', base: 150 }), e({ date: '2027-04-05', base: 20, subId: 'food-1', amount: 20 }),
    e({ date: '2027-04-06', base: 20, subId: 'food-1', amount: 20 }), e({ date: '2027-04-08', base: 400, categoryId: 'fun', claimStatus: 'pending' }),
  ];

  it('totals', () => {
    expect(totals(entries.filter((x) => x.date.startsWith('2027-03')))).toMatchObject({ income: 5400, expense: 400, net: 5000 });
  });

  it('expects income that has not arrived, ignoring reimbursements', () => {
    expect(expectedIncome(entries, cats, '2027-04', '2027-04-10')).toEqual({ amount: 5100, dayFrom: 24, dayTo: 26 });
    expect(expectedIncome(entries, cats, '2027-03', '2027-04-10')).toBeNull();
  });

  it('pace compares the same days and names the driver', () => {
    const p = pace(entries, '2027-04', '2027-04-10');
    expect(p.day).toBe(10);
    expect(p.thisSpent).toBe(590);
    expect(p.lastSpent).toBe(400);
    expect(p.driver!.categoryId).toBe('fun');
  });

  it('claims, recurring and quick picks', () => {
    expect(pendingClaims(entries)).toMatchObject({ total: 400, count: 1 });
    const t: Recurring = { id: 'r', type: 'expense', amount: 50, currency: 'MYR', categoryId: 'bills', subId: null, context: 'personal', note: '', dayOfMonth: 1, startMonth: '2027-01', endMonth: null, mode: 'auto', active: true, createdAt: 0 };
    const logged = [e({ date: '2027-04-01', recurringId: 'r' })];
    const due = nextDue(nextOccurrences([t], logged, new Map(), '2027-04-10'))!;
    expect(due).toEqual({ date: '2027-05-01', count: 1, total: 50 });
    expect(quickPicks(entries, 'expense', '2027-04-10')[0]).toMatchObject({ categoryId: 'food', amount: 20 });
  });
});
