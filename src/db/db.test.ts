import { afterEach, describe, expect, it } from 'vitest';
import { HiyoDB, ensureSeed, getSettings, uid, updateSettings } from './db';
import type { Entry } from './types';

let d: HiyoDB;

afterEach(async () => {
  await d.delete();
});

function entry(p: Partial<Entry> = {}): Entry {
  const now = Date.now();
  return {
    id: uid(),
    date: '2026-09-14',
    type: 'expense',
    amount: 22.3,
    currency: 'THB',
    rate: 0.13,
    base: 2.9,
    categoryId: 'food',
    subId: 'food-2',
    context: 'work',
    claimStatus: 'pending',
    claimSettledAt: null,
    claimSettlementId: null,
    tripId: null,
    note: 'Client lunch',
    tags: [],
    receiptIds: [],
    recurringId: null,
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

describe('HiyoDB', () => {
  it('seeds a fresh database once', async () => {
    d = new HiyoDB('t-seed-' + uid());
    await ensureSeed(d);
    await ensureSeed(d);
    expect(await d.categories.count()).toBe(12);
    expect(await d.currencies.count()).toBe(1);
    expect((await getSettings(d)).claimCutoffDay).toBe(25);
  });

  it('round-trips entries and queries by index', async () => {
    d = new HiyoDB('t-rt-' + uid());
    const e = entry();
    await d.entries.add(e);
    await d.entries.add(entry({ date: '2026-08-02', claimStatus: null, type: 'income' }));
    expect(await d.entries.get(e.id)).toEqual(e);
    expect(await d.entries.where('claimStatus').equals('pending').count()).toBe(1);
    const sept = await d.entries
      .where('[type+date]')
      .between(['expense', '2026-09-01'], ['expense', '2026-09-31'])
      .toArray();
    expect(sept.map((x) => x.id)).toEqual([e.id]);
  });

  it('merges settings patches', async () => {
    d = new HiyoDB('t-set-' + uid());
    await updateSettings({ lastBackupAt: 123 }, d);
    const s = await getSettings(d);
    expect(s.lastBackupAt).toBe(123);
    expect(s.defaultCurrency).toBe('MYR');
  });
});
