import { db as defaultDb, getSettings, type HiyoDB } from '../db/db';
import type { Receipt, Trip } from '../db/types';
import { KIRA_STORAGE_KEY, isKiraData, type KiraData, type KiraMapped } from './kira';

export interface ImportChoices {
  tripKeys: Set<string>;
  recurringKeys: Set<string>;
}

export async function dataUriToBlob(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}

/** Replaces everything in Hiyo with the mapped Kira data. */
export async function applyKiraImport(mapped: KiraMapped, choices: ImportChoices, d: HiyoDB = defaultDb) {
  const entries = mapped.entries.map((e) => ({ ...e, tags: [...e.tags] }));
  const categories = mapped.categories.map((c) => ({ ...c, subs: c.subs.map((s) => ({ ...s })) }));
  const byId = new Map(entries.map((e) => [e.id, e]));

  /* Trips */
  const trips: Trip[] = [];
  for (const s of mapped.trips) {
    if (!choices.tripKeys.has(s.key)) continue;
    const trip: Trip = {
      id: `trip-${s.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      name: s.name,
      kind: s.kind,
      start: s.start,
      end: s.end,
      currency: null,
      createdAt: Date.now(),
    };
    trips.push(trip);
    for (const id of s.entryIds) {
      const e = byId.get(id);
      if (!e) continue;
      e.tripId = trip.id;
      if (s.fromTag) e.tags = e.tags.filter((t) => t !== s.fromTag);
    }
    if (s.fromSub) {
      const sub = categories.find((c) => c.id === s.fromSub!.categoryId)?.subs.find((x) => x.id === s.fromSub!.subId);
      if (sub) sub.archived = true;
    }
  }

  /* Recurring */
  const recurring = mapped.recurring
    .filter((r) => choices.recurringKeys.has(r.key))
    .map((r) => {
      for (const id of r.entryIds) {
        const e = byId.get(id);
        if (e) e.recurringId = r.template.id;
      }
      return { ...r.template, active: r.stillRunning };
    });

  /* Receipts → Blobs (converted before the transaction; IndexedDB transactions can't await fetch) */
  const receipts: Receipt[] = [];
  for (const [entryId, uri] of Object.entries(mapped.receipts)) {
    try {
      receipts.push({ id: `rc-${entryId}`, entryId, blob: await dataUriToBlob(uri), createdAt: Date.now() });
    } catch {
      const e = byId.get(entryId);
      if (e) e.receiptIds = [];
    }
  }

  const settings = { ...(await getSettings(d)), ...mapped.settings, kiraImportedAt: Date.now() };

  await d.transaction(
    'rw',
    [d.entries, d.categories, d.currencies, d.trips, d.recurring, d.receipts, d.budgets, d.meta],
    async () => {
      await Promise.all([
        d.entries.clear(),
        d.categories.clear(),
        d.currencies.clear(),
        d.trips.clear(),
        d.recurring.clear(),
        d.receipts.clear(),
        d.budgets.clear(),
      ]);
      await d.categories.bulkAdd(categories);
      await d.currencies.bulkAdd(mapped.currencies);
      await d.trips.bulkAdd(trips);
      await d.recurring.bulkAdd(recurring);
      await d.entries.bulkAdd(entries);
      await d.receipts.bulkAdd(receipts);
      await d.meta.put({ key: 'settings', value: settings });
    },
  );

  return { entries: entries.length, trips: trips.length, recurring: recurring.length, receipts: receipts.length };
}

/* ---------- Reading Kira on this device (same origin: mahehe123.github.io) ---------- */

export function hasKiraOnDevice(): boolean {
  try {
    return !!localStorage.getItem(KIRA_STORAGE_KEY);
  } catch {
    return false;
  }
}

function readKiraReceiptsDb(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const out: Record<string, string> = {};
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open('kira_receipts');
    } catch {
      return resolve(out);
    }
    // Don't create Kira's database if it doesn't exist.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => resolve(out);
    req.onsuccess = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains('receipts')) {
        idb.close();
        return resolve(out);
      }
      const cursor = idb.transaction('receipts', 'readonly').objectStore('receipts').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) {
          idb.close();
          return resolve(out);
        }
        const v = c.value as { txId: string; dataUri: string };
        if (v?.txId && v.dataUri) out[v.txId] = v.dataUri;
        c.continue();
      };
      cursor.onerror = () => resolve(out);
    };
  });
}

/** Kira's live data from this phone, including receipts. Read-only: Kira is left untouched. */
export async function readKiraFromDevice(): Promise<KiraData | null> {
  const raw = localStorage.getItem(KIRA_STORAGE_KEY);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (!isKiraData(data)) return null;
  data._receipts = { ...(data._receipts ?? {}), ...(await readKiraReceiptsDb()) };
  return data;
}

export async function readKiraFile(file: File): Promise<KiraData> {
  const data = JSON.parse(await file.text());
  if (!isKiraData(data)) throw new Error('This file isn’t a Kira backup. Choose the kira-backup.json exported from Kira.');
  return data;
}
