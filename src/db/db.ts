import Dexie, { type EntityTable } from 'dexie';
import {
  DEFAULT_SETTINGS,
  type Budget,
  type Category,
  type Currency,
  type Entry,
  type Receipt,
  type Recurring,
  type Settings,
  type Trip,
} from './types';
import { DEFAULT_CATEGORIES } from './defaults';

type SettingRow = { key: 'settings'; value: Settings };

export class HiyoDB extends Dexie {
  entries!: EntityTable<Entry, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  currencies!: EntityTable<Currency, 'code'>;
  trips!: EntityTable<Trip, 'id'>;
  recurring!: EntityTable<Recurring, 'id'>;
  budgets!: EntityTable<Budget, 'categoryId'>;
  receipts!: EntityTable<Receipt, 'id'>;
  meta!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'hiyo') {
    super(name);
    this.version(1).stores({
      entries: 'id, date, type, categoryId, tripId, claimStatus, recurringId, [type+date]',
      categories: 'id, type, order',
      currencies: 'code, order',
      trips: 'id, start',
      recurring: 'id, active',
      budgets: 'categoryId',
      receipts: 'id, entryId',
      meta: 'key',
    });
  }
}

export const db = new HiyoDB();

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function getSettings(d: HiyoDB = db): Promise<Settings> {
  const row = await d.meta.get('settings');
  return { ...DEFAULT_SETTINGS, ...row?.value };
}

export async function updateSettings(patch: Partial<Settings>, d: HiyoDB = db): Promise<Settings> {
  return d.transaction('rw', d.meta, async () => {
    const next = { ...(await getSettings(d)), ...patch };
    await d.meta.put({ key: 'settings', value: next });
    return next;
  });
}

/** First run: default categories + MYR. Never touches a database that already has data. */
export async function ensureSeed(d: HiyoDB = db): Promise<void> {
  await d.transaction('rw', d.categories, d.currencies, d.meta, async () => {
    if ((await d.categories.count()) === 0) await d.categories.bulkAdd(DEFAULT_CATEGORIES);
    if ((await d.currencies.count()) === 0) await d.currencies.add({ code: 'MYR', rate: 1, order: 0 });
    if (!(await d.meta.get('settings'))) await d.meta.put({ key: 'settings', value: DEFAULT_SETTINGS });
  });
}

/** Ask Chrome not to evict Hiyo's data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
