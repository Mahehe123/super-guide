import { describe, expect, it } from 'vitest';
import { mapKira, type KiraData } from './kira';
import { applyKiraImport } from './applyImport';
import { HiyoDB, uid } from '../db/db';

// Small made-up Kira export covering the tricky cases.
const kira: KiraData = {
  settings: { defaultCurrency: 'MYR', claimCutoffDay: 25, claimReminderEnabled: true },
  currencies: [
    { code: 'MYR', rate: 1, isDefault: true },
    { code: 'THB', rate: 0.13 },
  ],
  categories: {
    expense: [
      { id: 'food', name: 'Food', emoji: '🍜', subs: ['Lunch', 'Dinner'] },
      { id: 'hol', name: 'Holiday', emoji: '✈️', subs: ['Japan 2027'] },
      { id: 'bills', name: 'Bills', emoji: '📋', subs: ['Phone'] },
    ],
    income: [{ id: 'clm', name: 'Claims', emoji: '🧾', subs: ['Work Claims'] }],
  },
  transactions: [
    { id: 'a', date: '2027-01-03', type: 'expense', categoryId: 'food', subcategory: 'Lunch', amount: 100, currency: 'THB', convertedAmount: 13, context: 'work', tags: ['Bangkok work trip'], claimable: true, claimStatus: 'settled' },
    { id: 'b', date: '2027-01-04', type: 'expense', categoryId: 'food', subcategory: 'Dinner', amount: 200, currency: 'THB', convertedAmount: 26, context: 'work', tags: ['Bangkok work trip'], claimable: true, claimStatus: 'underpaid' },
    { id: 'c', date: '2027-03-10', type: 'expense', categoryId: 'food', subcategory: 'Lunch', amount: 150, currency: 'THB', convertedAmount: 19.5, context: 'work', tags: ['Bangkok work trip'], claimable: true, claimStatus: 'pending' },
    { id: 'd', date: '2027-02-01', type: 'expense', categoryId: 'hol', subcategory: 'Hotel', amount: 50, currency: 'MYR', convertedAmount: 50, hasReceipt: true },
    { id: 'e', date: '2027-02-02', type: 'expense', categoryId: 'hol', subcategory: 'Japan 2027', amount: 80, currency: 'MYR', convertedAmount: 80 },
    { id: 'f', date: '2027-01-01', type: 'expense', categoryId: 'bills', subcategory: 'Phone', amount: 30, currency: 'MYR', convertedAmount: 30, recurring: true, recurringMonths: 3 },
    { id: 'g', date: '2027-02-01', type: 'expense', categoryId: 'bills', subcategory: 'Phone', amount: 30, currency: 'MYR', convertedAmount: 30, _recurringSourceId: 'f' },
    { id: 'h', date: '2027-01-28', type: 'income', categoryId: 'clm', subcategory: 'Work Claims', amount: 13, currency: 'MYR', convertedAmount: 13, claimMonth: '2027-01' },
  ],
  _receipts: { d: 'data:image/jpeg;base64,/9j/4AAQ' },
};

describe('Kira import', () => {
  const m = mapKira(kira);

  it('keeps amounts, rates and claims', () => {
    expect(m.entries).toHaveLength(8);
    const a = m.entries.find((e) => e.id === 'a')!;
    expect(a.base).toBe(13);
    expect(a.rate).toBeCloseTo(0.13, 6);
    expect(m.entries.find((e) => e.id === 'b')!.claimStatus).toBe('pending'); // underpaid → still owed
    expect(a.claimSettlementId).toBe('h');
    expect(Object.keys(m.receipts)).toEqual(['d']);
  });

  it('keeps removed subcategories as archived', () => {
    const hol = m.categories.find((c) => c.id === 'hol')!;
    expect(hol.subs.find((s) => s.name === 'Hotel')).toMatchObject({ archived: true });
  });

  it('suggests trips split by date gaps and from year subcategories', () => {
    const names = m.trips.map((t) => t.name).sort();
    expect(names).toEqual(['Bangkok work trip · Jan 2027', 'Bangkok work trip · Mar 2027', 'Japan 2027']);
    expect(m.trips.find((t) => t.name.endsWith('Jan 2027'))).toMatchObject({ kind: 'work', entryIds: ['a', 'b'] });
  });

  it('turns recurring series into templates', () => {
    expect(m.recurring).toHaveLength(1);
    expect(m.recurring[0].template).toMatchObject({ amount: 30, startMonth: '2027-01', endMonth: '2027-03', mode: 'auto' });
    expect(m.recurring[0].entryIds).toEqual(['f', 'g']);
  });

  it('writes the chosen trips and recurring bills', async () => {
    const d = new HiyoDB('t-kira-' + uid());
    const res = await applyKiraImport(m, { tripKeys: new Set(m.trips.map((t) => t.key)), recurringKeys: new Set(m.recurring.map((r) => r.key)) }, d);
    expect(res).toMatchObject({ entries: 8, trips: 3, recurring: 1, receipts: 1 });
    const a = await d.entries.get('a');
    expect(a!.tripId).toBeTruthy();
    expect(a!.tags).toEqual([]);
    expect((await d.categories.get('hol'))!.subs.find((s) => s.name === 'Japan 2027')!.archived).toBe(true);
    expect((await d.entries.get('g'))!.recurringId).toBe('rec-f');
    await d.delete();
  });
});
