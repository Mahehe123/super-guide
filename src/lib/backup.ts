import { db as defaultDb, getSettings, type HiyoDB } from '../db/db';
import type { Budget, Category, Currency, Entry, Recurring, Settings, Trip } from '../db/types';

export const BACKUP_VERSION = 1;

export interface HiyoBackup {
  app: 'hiyo';
  version: number;
  exportedAt: string;
  settings: Settings;
  categories: Category[];
  currencies: Currency[];
  trips: Trip[];
  recurring: Recurring[];
  budgets: Budget[];
  entries: Entry[];
  /** Omitted in a "without receipts" backup */
  receipts?: { id: string; entryId: string; type: string; data: string; createdAt: number }[];
}

export function isHiyoBackup(x: unknown): x is HiyoBackup {
  const b = x as HiyoBackup;
  return !!b && b.app === 'hiyo' && Array.isArray(b.entries) && Array.isArray(b.categories);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function buildBackup(withReceipts: boolean, d: HiyoDB = defaultDb): Promise<HiyoBackup> {
  const [settings, categories, currencies, trips, recurring, budgets, entries] = await Promise.all([
    getSettings(d),
    d.categories.toArray(),
    d.currencies.toArray(),
    d.trips.toArray(),
    d.recurring.toArray(),
    d.budgets.toArray(),
    d.entries.toArray(),
  ]);
  const backup: HiyoBackup = {
    app: 'hiyo',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    categories,
    currencies,
    trips,
    recurring,
    budgets,
    entries,
  };
  if (withReceipts) {
    backup.receipts = [];
    for (const r of await d.receipts.toArray()) {
      backup.receipts.push({ id: r.id, entryId: r.entryId, type: r.blob.type || 'image/jpeg', data: await blobToBase64(r.blob), createdAt: r.createdAt });
    }
  }
  return backup;
}

/** Replaces all data with the backup. Receipts already on the phone are kept if the backup has none. */
export async function restoreBackup(b: HiyoBackup, d: HiyoDB = defaultDb) {
  if (!isHiyoBackup(b)) throw new Error('This file isn’t a Hiyo backup.');
  if (b.version > BACKUP_VERSION) throw new Error('This backup is from a newer version of Hiyo. Update the app first.');
  const receipts = b.receipts?.map((r) => ({ id: r.id, entryId: r.entryId, blob: base64ToBlob(r.data, r.type), createdAt: r.createdAt }));

  await d.transaction('rw', [d.entries, d.categories, d.currencies, d.trips, d.recurring, d.budgets, d.receipts, d.meta], async () => {
    await Promise.all([d.entries.clear(), d.categories.clear(), d.currencies.clear(), d.trips.clear(), d.recurring.clear(), d.budgets.clear()]);
    await d.categories.bulkAdd(b.categories);
    await d.currencies.bulkAdd(b.currencies);
    await d.trips.bulkAdd(b.trips ?? []);
    await d.recurring.bulkAdd(b.recurring ?? []);
    await d.budgets.bulkAdd(b.budgets ?? []);
    await d.entries.bulkAdd(b.entries);
    if (receipts) {
      await d.receipts.clear();
      await d.receipts.bulkAdd(receipts);
    } else {
      // Drop photos that no longer belong to any entry.
      const ids = new Set(b.entries.map((e) => e.id));
      const orphans = (await d.receipts.toArray()).filter((r) => !ids.has(r.entryId)).map((r) => r.id);
      await d.receipts.bulkDelete(orphans);
    }
    await d.meta.put({ key: 'settings', value: { ...b.settings, lastBackupAt: b.settings.lastBackupAt ?? Date.parse(b.exportedAt) } });
  });
  return { entries: b.entries.length, receipts: receipts?.length ?? null };
}

export function backupFilename(withReceipts: boolean, now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `hiyo-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}${withReceipts ? '' : '-no-receipts'}.json`;
}

/** Delete receipt photos for entries older than N months, keeping any on pending claims. */
export async function pruneReceipts(months: number, today: string, d: HiyoDB = defaultDb): Promise<number> {
  const cut = new Date(today + 'T00:00:00');
  cut.setMonth(cut.getMonth() - months);
  const pad = (n: number) => String(n).padStart(2, '0');
  const cutoff = `${cut.getFullYear()}-${pad(cut.getMonth() + 1)}-${pad(cut.getDate())}`;
  return d.transaction('rw', d.entries, d.receipts, async () => {
    const old = await d.entries
      .where('date')
      .below(cutoff)
      .filter((e) => e.receiptIds.length > 0 && e.claimStatus !== 'pending')
      .toArray();
    const ids = old.flatMap((e) => e.receiptIds);
    if (!ids.length) return 0;
    await d.receipts.bulkDelete(ids);
    await d.entries.bulkPut(old.map((e) => ({ ...e, receiptIds: [] })));
    return ids.length;
  });
}
