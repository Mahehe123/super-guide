import type {
  Category,
  ClaimStatus,
  Currency,
  Entry,
  EntryType,
  Recurring,
  Settings,
  Subcategory,
  TripKind,
} from '../db/types';
import { addMonths, claimCycle, daysBetween, monthLabel, monthOf, today } from '../lib/dates';

/* ---------- Kira's shape (backup v2 / localStorage kira_data_v1) ---------- */

export interface KiraTx {
  id: string;
  date: string;
  type: EntryType;
  categoryId: string;
  subcategory?: string;
  amount: number;
  currency: string;
  convertedAmount: number;
  context?: 'personal' | 'work';
  notes?: string;
  tags?: string[];
  recurring?: boolean;
  recurringMonths?: number;
  claimable?: boolean;
  claimMonth?: string | null;
  claimStatus?: string | null;
  receiptPhoto?: string | null;
  hasReceipt?: boolean;
  createdAt?: number;
  _recurringSourceId?: string;
}

export interface KiraData {
  settings: {
    defaultCurrency?: string;
    claimCutoffDay?: number;
    claimReminderEnabled?: boolean;
    ratesUpdatedAt?: number;
  };
  currencies: { code: string; rate: number; isDefault?: boolean }[];
  categories: Record<EntryType, { id: string; name: string; emoji: string; subs: string[] }[]>;
  transactions: KiraTx[];
  _receipts?: Record<string, string>;
}

export const KIRA_STORAGE_KEY = 'kira_data_v1';

export function isKiraData(x: unknown): x is KiraData {
  const d = x as KiraData;
  return (
    !!d &&
    Array.isArray(d.transactions) &&
    Array.isArray(d.currencies) &&
    !!d.categories &&
    Array.isArray(d.categories.expense)
  );
}

/* ---------- Mapped result ---------- */

export interface TripSuggestion {
  key: string;
  name: string;
  kind: TripKind;
  start: string;
  end: string;
  entryIds: string[];
  total: number;
  /** Tag that produced it (removed from entries on import), or null for a Holiday subcategory */
  fromTag: string | null;
  /** Subcategory that produced it (archived on import) */
  fromSub: { categoryId: string; subId: string } | null;
}

export interface RecurringSuggestion {
  key: string;
  template: Recurring;
  label: string;
  /** Kira entries that belong to this series (source + generated copies) */
  entryIds: string[];
  stillRunning: boolean;
}

export interface KiraMapped {
  entries: Entry[];
  categories: Category[];
  currencies: Currency[];
  settings: Partial<Settings>;
  /** entryId → data URI */
  receipts: Record<string, string>;
  trips: TripSuggestion[];
  recurring: RecurringSuggestion[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function claimStatusOf(t: KiraTx): ClaimStatus | null {
  if (t.type !== 'expense' || !t.claimable) return null;
  // Kira also had "underpaid"; in Hiyo that is still money owed.
  return t.claimStatus === 'settled' ? 'settled' : 'pending';
}

/** Pure conversion. `receipts` are Kira data URIs keyed by transaction id. */
export function mapKira(data: KiraData, receipts: Record<string, string> = data._receipts ?? {}): KiraMapped {
  const defaultCurrency = data.settings.defaultCurrency ?? data.currencies.find((c) => c.isDefault)?.code ?? 'MYR';
  const cutoff = data.settings.claimCutoffDay ?? 25;
  const now = Date.now();

  /* Categories — subcategory names become stable ids */
  const categories: Category[] = [];
  const subIndex = new Map<string, Map<string, string>>(); // catId → name → subId
  for (const type of ['expense', 'income'] as const) {
    (data.categories[type] ?? []).forEach((c, order) => {
      const subs: Subcategory[] = c.subs.map((name, i) => ({ id: `${c.id}-s${i + 1}`, name }));
      categories.push({ id: c.id, type, name: c.name, emoji: c.emoji, order, subs });
      subIndex.set(c.id, new Map(subs.map((s) => [s.name, s.id])));
    });
  }
  const catById = new Map(categories.map((c) => [c.id, c]));

  function subIdFor(catId: string, name: string | undefined): string | null {
    if (!name) return null;
    const cat = catById.get(catId);
    const idx = subIndex.get(catId);
    if (!cat || !idx) return null;
    let id = idx.get(name);
    if (!id) {
      // Entry uses a subcategory that was later removed in Kira: keep it, archived.
      id = `${catId}-s${cat.subs.length + 1}`;
      cat.subs.push({ id, name, archived: true });
      idx.set(name, id);
    }
    return id;
  }

  /* Entries */
  const entries: Entry[] = data.transactions.map((t) => {
    // Full precision like Kira; rounding happens only when displayed.
    const base = t.convertedAmount ?? t.amount;
    const rate = t.currency === defaultCurrency || !t.amount ? 1 : t.convertedAmount / t.amount;
    const hasReceipt = !!receipts[t.id] || !!t.receiptPhoto;
    return {
      id: t.id,
      date: t.date,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      rate,
      base,
      categoryId: t.categoryId,
      subId: subIdFor(t.categoryId, t.subcategory),
      context: t.context ?? 'personal',
      claimStatus: claimStatusOf(t),
      claimSettledAt: null,
      claimSettlementId: null,
      tripId: null,
      note: (t.notes ?? '').trim(),
      tags: [...new Set((t.tags ?? []).map((s) => s.trim()).filter(Boolean))],
      receiptIds: hasReceipt ? [`rc-${t.id}`] : [],
      recurringId: null,
      createdAt: t.createdAt ?? now,
      updatedAt: now,
    };
  });
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const allReceipts: Record<string, string> = {};
  for (const t of data.transactions) {
    const uri = receipts[t.id] ?? t.receiptPhoto;
    if (uri) allReceipts[t.id] = uri;
  }

  /* Claims — link each Kira claims-income month to the settled expenses of that cycle */
  for (const inc of data.transactions) {
    if (inc.type !== 'income' || inc.categoryId !== 'clm' || !inc.claimMonth) continue;
    const { from, to } = claimCycle(inc.claimMonth, cutoff);
    for (const e of entries) {
      if (e.claimStatus === 'settled' && !e.claimSettlementId && e.date >= from && e.date <= to) {
        e.claimSettlementId = inc.id;
        e.claimSettledAt = inc.date;
      }
    }
  }

  /* Currencies */
  const currencies: Currency[] = data.currencies.map((c, order) => ({
    code: c.code,
    rate: c.code === defaultCurrency ? 1 : c.rate,
    order,
  }));

  return {
    entries,
    categories,
    currencies,
    settings: {
      defaultCurrency,
      claimCutoffDay: cutoff,
      claimReminder: data.settings.claimReminderEnabled ?? true,
      ratesUpdatedAt: data.settings.ratesUpdatedAt ?? null,
    },
    receipts: allReceipts,
    trips: suggestTrips(entries, categories),
    recurring: suggestRecurring(data.transactions, entryById, catById),
  };
}

/* ---------- Trip suggestions ---------- */

const TRIP_GAP_DAYS = 7;
const YEAR_RE = /\b(19|20)\d{2}\b/;

function tripKind(name: string): TripKind {
  if (/work|business|customer/i.test(name)) return 'work';
  if (YEAR_RE.test(name)) return 'holiday';
  return 'other';
}

function summarize(list: Entry[]) {
  const dates = list.map((e) => e.date).sort();
  return {
    start: dates[0],
    end: dates[dates.length - 1],
    entryIds: list.map((e) => e.id),
    total: round2(list.reduce((s, e) => s + (e.type === 'expense' ? e.base : 0), 0)),
  };
}

export function suggestTrips(entries: Entry[], categories: Category[]): TripSuggestion[] {
  const out: TripSuggestion[] = [];

  // 1. Tags that name a trip: "... trip" (split by gaps) or "... 2026" (kept whole)
  const byTag = new Map<string, Entry[]>();
  for (const e of entries) for (const tag of e.tags) if (/\btrip\b/i.test(tag) || YEAR_RE.test(tag)) {
    byTag.set(tag, [...(byTag.get(tag) ?? []), e]);
  }
  for (const [tag, list] of byTag) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const groups: Entry[][] = [];
    const split = /\btrip\b/i.test(tag);
    for (const e of list) {
      const last = groups[groups.length - 1];
      if (last && (!split || daysBetween(last[last.length - 1].date, e.date) <= TRIP_GAP_DAYS)) last.push(e);
      else groups.push([e]);
    }
    for (const g of groups) {
      const s = summarize(g);
      out.push({
        key: `tag:${tag}:${s.start}`,
        name: groups.length > 1 ? `${tag} · ${monthLabel(monthOf(s.start), 'short')}` : tag,
        kind: tripKind(tag),
        fromTag: tag,
        fromSub: null,
        ...s,
      });
    }
  }

  // 2. Holiday subcategories that are really trips ("Japan 2027")
  for (const c of categories) {
    if (c.type !== 'expense') continue;
    for (const sub of c.subs) {
      if (!YEAR_RE.test(sub.name)) continue;
      const list = entries.filter((e) => e.categoryId === c.id && e.subId === sub.id);
      const s = list.length
        ? summarize(list)
        : { start: `${sub.name.match(YEAR_RE)![0]}-01-01`, end: '', entryIds: [], total: 0 };
      out.push({
        key: `sub:${sub.id}`,
        name: sub.name,
        kind: 'holiday',
        fromTag: null,
        fromSub: { categoryId: c.id, subId: sub.id },
        ...s,
        end: s.end || s.start,
      });
    }
  }

  return out.sort((a, b) => b.start.localeCompare(a.start));
}

/* ---------- Recurring suggestions ---------- */

export function suggestRecurring(
  txs: KiraTx[],
  entryById: Map<string, Entry>,
  catById: Map<string, Category>,
): RecurringSuggestion[] {
  const thisMonth = monthOf(today());
  const out: RecurringSuggestion[] = [];
  for (const src of txs) {
    if (!src.recurring || src._recurringSourceId) continue;
    const e = entryById.get(src.id)!;
    const months = src.recurringMonths ?? 0;
    const startMonth = monthOf(src.date);
    const endMonth = months > 0 ? addMonths(startMonth, months - 1) : null;
    const copies = txs.filter((t) => t._recurringSourceId === src.id).map((t) => t.id);
    const cat = catById.get(e.categoryId);
    const subName = cat?.subs.find((s) => s.id === e.subId)?.name;
    const template: Recurring = {
      id: `rec-${src.id}`,
      type: e.type,
      amount: e.amount,
      currency: e.currency,
      categoryId: e.categoryId,
      subId: e.subId,
      context: e.context,
      note: e.note,
      dayOfMonth: Math.min(Number(src.date.slice(8, 10)), 28),
      startMonth,
      endMonth,
      // Kira auto-created fixed-length series; open-ended ones were only reminders.
      mode: months > 0 ? 'auto' : 'confirm',
      active: true,
      claimable: e.claimStatus !== null,
      createdAt: e.createdAt,
    };
    out.push({
      key: src.id,
      template,
      label: subName ?? cat?.name ?? 'Recurring',
      entryIds: [src.id, ...copies],
      stillRunning: endMonth === null || endMonth >= thisMonth,
    });
  }
  return out;
}
