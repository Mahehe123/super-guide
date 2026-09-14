import { describe, expect, it } from 'vitest';
import { HiyoDB, ensureSeed, getSettings, uid } from '../db/db';
import { buildBackup, isHiyoBackup, pruneReceipts, restoreBackup } from './backup';
import { detectColumns, parseAmount, parseCsv, parseDate, planImport } from './csv';
import type { Entry } from '../db/types';

const entry = (p: Partial<Entry>): Entry => ({
  id: uid(), date: '2026-09-01', type: 'expense', amount: 10, currency: 'MYR', rate: 1, base: 10, categoryId: 'food',
  subId: 'food-2', context: 'personal', claimStatus: null, claimSettledAt: null, claimSettlementId: null, tripId: null,
  note: '', tags: [], receiptIds: [], recurringId: null, createdAt: 1, updatedAt: 1, ...p,
});

describe('backup', () => {
  it('round-trips everything including receipt photos', async () => {
    const a = new HiyoDB('t-bk-a-' + uid());
    await ensureSeed(a);
    const e = entry({ receiptIds: ['rc-1'], note: 'Lunch' });
    await a.entries.add(e);
    await a.receipts.add({ id: 'rc-1', entryId: e.id, blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }), createdAt: 1 });
    await a.trips.add({ id: 't1', name: 'SG', kind: 'work', start: '2026-09-01', end: '2026-09-02', currency: null, createdAt: 1 });

    const backup = JSON.parse(JSON.stringify(await buildBackup(true, a)));
    expect(isHiyoBackup(backup)).toBe(true);
    expect(backup.receipts).toHaveLength(1);

    const b = new HiyoDB('t-bk-b-' + uid());
    await restoreBackup(backup, b);
    expect(await b.entries.get(e.id)).toEqual(e);
    expect(await b.trips.count()).toBe(1);
    const rc = await b.receipts.get('rc-1');
    expect([...new Uint8Array(await rc!.blob.arrayBuffer())]).toEqual([1, 2, 3, 250]);
    expect((await getSettings(b)).lastBackupAt).toBeTruthy();

    const light = await buildBackup(false, a);
    expect(light.receipts).toBeUndefined();
    await a.delete();
    await b.delete();
  });

  it('prunes old receipts but keeps pending claims', async () => {
    const d = new HiyoDB('t-prune-' + uid());
    const old = entry({ date: '2025-01-01', receiptIds: ['r-old'] });
    const claim = entry({ date: '2025-01-01', receiptIds: ['r-claim'], claimStatus: 'pending', context: 'work' });
    const recent = entry({ date: '2026-09-01', receiptIds: ['r-new'] });
    await d.entries.bulkAdd([old, claim, recent]);
    await d.receipts.bulkAdd(['r-old', 'r-claim', 'r-new'].map((id, i) => ({ id, entryId: [old, claim, recent][i].id, blob: new Blob(['x']), createdAt: 1 })));
    expect(await pruneReceipts(12, '2026-09-15', d)).toBe(1);
    expect((await d.receipts.toArray()).map((r) => r.id).sort()).toEqual(['r-claim', 'r-new']);
    expect((await d.entries.get(old.id))!.receiptIds).toEqual([]);
    await d.delete();
  });
});

describe('csv', () => {
  it('parses quotes, commas and newlines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
  });

  it('reads Malaysian dates and amounts', () => {
    expect(parseDate('14/09/2026')).toBe('2026-09-14');
    expect(parseDate('2026-09-14')).toBe('2026-09-14');
    expect(parseDate('4-9-26')).toBe('2026-09-04');
    expect(parseDate('14 Sep 2026')).toBe('2026-09-14');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseAmount('RM 1,234.50')).toBe(1234.5);
    expect(parseAmount('-12.00')).toBe(-12);
    expect(parseAmount('(8.00)')).toBe(-8);
  });

  it('plans an import with new categories and duplicates', () => {
    const table = parseCsv('Date,Description,Category,Amount,Type\n14/09/2026,Lunch,Food,10.00,expense\n14/09/2026,Parking,Car,3,expense\nbad,x,Food,1,expense\n15/09/2026,Salary,Salary,5000,income');
    const cols = detectColumns(table[0]);
    expect(cols).toMatchObject({ date: 0, note: 1, category: 2, amount: 3, type: 4 });
    const cats = [
      { id: 'food', type: 'expense' as const, name: 'Food', emoji: '', order: 0, subs: [] },
      { id: 'sal', type: 'income' as const, name: 'Salary', emoji: '', order: 0, subs: [] },
    ];
    // Existing entry has no note (like Kira's), so it matches on date + amount
    const plan = planImport(table, cols, cats, [entry({ date: '2026-09-14', amount: 10, note: '' })], 'MYR');
    expect(plan.rows).toHaveLength(3);
    expect(plan.errors).toEqual([{ line: 4, reason: 'Date “bad” not recognised' }]);
    expect(plan.rows[0].duplicate).toBe(true);
    expect(plan.newCategories).toEqual([{ name: 'Car', type: 'expense' }]);
    expect(plan.rows[2]).toMatchObject({ type: 'income', categoryId: 'sal', amount: 5000 });
  });
});
