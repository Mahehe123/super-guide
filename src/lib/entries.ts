import { db, uid } from '../db/db';
import type { DateStr, Entry, Receipt, Recurring } from '../db/types';
import { isClaimsCategory } from './stats';

export type EntryDraft = Omit<Entry, 'id' | 'createdAt' | 'updatedAt' | 'base' | 'receiptIds'> & {
  id?: string;
  receiptIds?: string[];
};

/** Create or update an entry, adding new receipt photos and removing dropped ones. */
export async function saveEntry(draft: EntryDraft, newReceipts: Blob[] = [], removeReceiptIds: string[] = []) {
  const now = Date.now();
  return db.transaction('rw', db.entries, db.receipts, async () => {
    const existing = draft.id ? await db.entries.get(draft.id) : undefined;
    const id = existing?.id ?? uid();
    const added: Receipt[] = newReceipts.map((blob) => ({ id: `rc-${uid()}`, entryId: id, blob, createdAt: now }));
    const keep = (draft.receiptIds ?? existing?.receiptIds ?? []).filter((r) => !removeReceiptIds.includes(r));
    const entry: Entry = {
      ...draft,
      id,
      base: draft.amount * draft.rate,
      receiptIds: [...keep, ...added.map((r) => r.id)],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (removeReceiptIds.length) await db.receipts.bulkDelete(removeReceiptIds);
    if (added.length) await db.receipts.bulkAdd(added);
    await db.entries.put(entry);
    return entry;
  });
}

/** Deletes entries and their receipts. Returns an undo function. */
/**
 * Deletes entries and their receipts. Returns an undo function.
 * An entry made by a recurring bill marks that month as skipped, so the bill
 * isn't logged again the next time Hiyo opens.
 */
export async function deleteEntries(ids: string[]): Promise<() => Promise<void>> {
  const { entries, receipts, templatesBefore } = await db.transaction('rw', db.entries, db.receipts, db.recurring, async () => {
    const entries = (await db.entries.bulkGet(ids)).filter((e): e is Entry => !!e);
    const receipts = await db.receipts.where('entryId').anyOf(ids).toArray();
    const recIds = [...new Set(entries.map((e) => e.recurringId).filter((x): x is string => !!x))];
    const templatesBefore = (await db.recurring.bulkGet(recIds)).filter((t): t is Recurring => !!t);
    for (const t of templatesBefore) {
      const months = entries.filter((e) => e.recurringId === t.id).map((e) => e.date.slice(0, 7));
      await db.recurring.update(t.id, { skipped: [...new Set([...(t.skipped ?? []), ...months])] });
    }
    await db.receipts.bulkDelete(receipts.map((r) => r.id));
    await db.entries.bulkDelete(ids);
    return { entries, receipts, templatesBefore };
  });
  return async () => {
    await db.transaction('rw', db.entries, db.receipts, db.recurring, async () => {
      await db.entries.bulkPut(entries);
      await db.receipts.bulkPut(receipts);
      await db.recurring.bulkPut(templatesBefore);
    });
  };
}

/**
 * Marks claims settled. Optionally logs the reimbursement as Claims income
 * and links each claim to it.
 */
export async function settleClaims(ids: string[], opts: { logIncome: boolean; date: DateStr; currency: string }) {
  return db.transaction('rw', db.entries, db.categories, async () => {
    const claims = (await db.entries.bulkGet(ids)).filter((e): e is Entry => !!e);
    const total = claims.reduce((s, e) => s + e.base, 0);
    let settlementId: string | null = null;

    if (opts.logIncome && total > 0) {
      const cats = await db.categories.where('type').equals('income').toArray();
      const cat = cats.find(isClaimsCategory) ?? cats[0];
      const sub = cat?.subs.find((s) => !s.archived && /work/i.test(s.name)) ?? cat?.subs.find((s) => !s.archived);
      const now = Date.now();
      settlementId = uid();
      await db.entries.add({
        id: settlementId,
        date: opts.date,
        type: 'income',
        amount: Math.round(total * 100) / 100,
        currency: opts.currency,
        rate: 1,
        base: Math.round(total * 100) / 100,
        categoryId: cat?.id ?? 'clm',
        subId: sub?.id ?? null,
        context: 'work',
        claimStatus: null,
        claimSettledAt: null,
        claimSettlementId: null,
        tripId: null,
        note: `Reimbursement for ${claims.length} ${claims.length === 1 ? 'claim' : 'claims'}`,
        tags: [],
        receiptIds: [],
        recurringId: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.entries.bulkPut(
      claims.map((e) => ({
        ...e,
        claimStatus: 'settled' as const,
        claimSettledAt: opts.date,
        claimSettlementId: settlementId,
        updatedAt: Date.now(),
      })),
    );
    return { total, settlementId };
  });
}

export async function unsettleClaims(ids: string[]) {
  await db.entries
    .where('id')
    .anyOf(ids)
    .modify({ claimStatus: 'pending', claimSettledAt: null, claimSettlementId: null, updatedAt: Date.now() });
}
