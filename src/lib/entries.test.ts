import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import type { Entry, Recurring } from '../db/types';
import { deleteEntries } from './entries';
import { backfillClaimable, runAutoRecurring } from './recurring';

afterAll(() => db.delete());

const template: Recurring = {
  id: 'rec-net', type: 'expense', amount: 99, currency: 'MYR', categoryId: 'bills', subId: null, context: 'work',
  note: 'Internet', dayOfMonth: 1, startMonth: '2027-01', endMonth: '2027-12', mode: 'auto', active: true, createdAt: 0,
};
const logged = (month: string, p: Partial<Entry> = {}): Entry => ({
  id: `e-${month}`, date: `${month}-01`, type: 'expense', amount: 99, currency: 'MYR', rate: 1, base: 99, categoryId: 'bills',
  subId: null, context: 'work', claimStatus: 'pending', claimSettledAt: null, claimSettlementId: null, tripId: null, note: '',
  tags: [], receiptIds: [], recurringId: 'rec-net', createdAt: 0, updatedAt: 0, ...p,
});

describe('deleting an entry made by a recurring bill', () => {
  it('logs new months of a claimable work bill as pending claims', async () => {
    await db.recurring.put({ ...template, id: 'rec-claim', claimable: true, startMonth: '2027-05', endMonth: '2027-05' });
    expect(await runAutoRecurring('2027-05-02')).toBe(1);
    const [e] = await db.entries.where('recurringId').equals('rec-claim').toArray();
    expect(e.claimStatus).toBe('pending');
    await db.recurring.delete('rec-claim');
    await db.entries.delete(e.id);
  });

  it('backfills the claim setting on older bills from their entries', async () => {
    await db.recurring.put({ ...template, id: 'rec-old' });
    await db.entries.put(logged('2026-12', { id: 'e-old', recurringId: 'rec-old' }));
    await backfillClaimable();
    expect((await db.recurring.get('rec-old'))!.claimable).toBe(true);
    await db.recurring.delete('rec-old');
    await db.entries.delete('e-old');
  });

  it('stays deleted after the app reopens, and Undo brings it back', async () => {
    await db.recurring.put(template);
    await db.entries.bulkPut([logged('2027-01'), logged('2027-02'), logged('2027-03')]);

    const undo = await deleteEntries(['e-2027-02']);
    expect((await db.recurring.get('rec-net'))!.skipped).toEqual(['2027-02']);

    // Simulate opening Hiyo again on 15 Mar 2027: nothing should be re-logged.
    expect(await runAutoRecurring('2027-03-15')).toBe(0);
    expect(await db.entries.where('recurringId').equals('rec-net').count()).toBe(2);

    await undo();
    expect((await db.entries.get('e-2027-02'))!.claimStatus).toBe('pending');
    expect((await db.recurring.get('rec-net'))!.skipped ?? []).toEqual([]);
  });
});
