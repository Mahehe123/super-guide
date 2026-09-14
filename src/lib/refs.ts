import { db, getSettings } from '../db/db';
import type { Category, Currency, Entry, Recurring, Settings, Trip } from '../db/types';
import { useLive } from './useLive';

export interface Refs {
  categories: Category[];
  catById: Map<string, Category>;
  currencies: Currency[];
  curByCode: Map<string, Currency>;
  trips: Trip[];
  tripById: Map<string, Trip>;
  recurring: Recurring[];
  settings: Settings;
}

/** Reference data every screen needs, kept live. */
export function useRefs(): Refs | undefined {
  return useLive(async () => {
    const [categories, currencies, trips, recurring, settings] = await Promise.all([
      db.categories.orderBy('order').toArray(),
      db.currencies.orderBy('order').toArray(),
      db.trips.orderBy('start').reverse().toArray(),
      db.recurring.toArray(),
      getSettings(),
    ]);
    return {
      categories,
      catById: new Map(categories.map((c) => [c.id, c])),
      currencies,
      curByCode: new Map(currencies.map((c) => [c.code, c])),
      trips,
      tripById: new Map(trips.map((t) => [t.id, t])),
      recurring,
      settings,
    };
  });
}

export function useAllEntries(): Entry[] | undefined {
  return useLive(() => db.entries.orderBy('date').reverse().toArray());
}

export function subName(refs: Refs, e: Pick<Entry, 'categoryId' | 'subId'>): string | undefined {
  return refs.catById.get(e.categoryId)?.subs.find((s) => s.id === e.subId)?.name;
}

/** Row title: note if written, else subcategory, else category. */
export function entryTitle(refs: Refs, e: Entry): string {
  return e.note || subName(refs, e) || refs.catById.get(e.categoryId)?.name || 'Entry';
}
