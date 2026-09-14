import type { Category, Entry, EntryType } from '../db/types';
import { toCsv } from './files';

/* ---------- Parsing ---------- */

/** RFC-4180-ish parser: quotes, escaped quotes, commas/newlines inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export type Field = 'date' | 'amount' | 'type' | 'category' | 'subcategory' | 'note' | 'currency' | 'context' | 'tags';

const MATCH: Record<Field, RegExp> = {
  date: /^(date|day|transaction date|txn date)$/i,
  amount: /^(amount|value|total|sum|price)( \(.*\))?$/i,
  type: /^(type|kind|income\/expense|direction)$/i,
  category: /^(category|cat|group)$/i,
  subcategory: /^(sub ?category|subcat|sub)$/i,
  note: /^(note|notes|description|details|memo|remarks?|title|merchant)$/i,
  currency: /^(currency|ccy|cur)$/i,
  context: /^(context|personal\/work|work)$/i,
  tags: /^(tags?|labels?)$/i,
};

/** Guess which column holds which field from the header row. */
export function detectColumns(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const name = h.trim();
    for (const f of Object.keys(MATCH) as Field[]) {
      // Prefer "Amount" over "Amount (MYR)" when both exist
      if (out[f] === undefined && MATCH[f].test(name)) out[f] = i;
    }
  });
  return out;
}

/** Accepts 2026-09-14, 14/09/2026, 14-9-26, 14.09.2026, 14 Sep 2026. Returns YYYY-MM-DD or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return valid(+m[3], +m[2], +m[1]); // day first (Malaysia)
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})/);
  if (m) {
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
    if (mon >= 0) return valid(+m[3], mon + 1, +m[1]);
  }
  return null;
}

export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/[^\d.,()\-−]/g, '');
  if (!s) return null;
  const neg = /^[-−]|^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()\-−,]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/* ---------- Import planning ---------- */

export interface CsvRow {
  line: number;
  date: string;
  type: EntryType;
  amount: number;
  currency: string;
  categoryName: string;
  categoryId: string | null;
  subName: string;
  note: string;
  context: Entry['context'];
  tags: string[];
  duplicate: boolean;
}

export interface CsvPlan {
  rows: CsvRow[];
  errors: { line: number; reason: string }[];
  /** Category names in the file that don't exist yet */
  newCategories: { name: string; type: EntryType }[];
}

export function planImport(
  table: string[][],
  cols: Partial<Record<Field, number>>,
  categories: Category[],
  existing: Entry[],
  defaultCurrency: string,
): CsvPlan {
  const rows: CsvRow[] = [];
  const errors: CsvPlan['errors'] = [];
  const newCats = new Map<string, EntryType>();
  // Same day, type and amount, and the note or subcategory lines up (an entry without a note matches on subcategory).
  const titles = new Map<string, Set<string>>();
  const remember = (key: string, words: string[]) => {
    const set = titles.get(key) ?? new Set<string>();
    words.filter(Boolean).forEach((w) => set.add(w.toLowerCase()));
    if (!words.some(Boolean)) set.add('');
    titles.set(key, set);
  };
  for (const e of existing) {
    const sub = categories.find((c) => c.id === e.categoryId)?.subs.find((s) => s.id === e.subId)?.name ?? '';
    remember(`${e.date}|${e.type}|${e.amount.toFixed(2)}`, [e.note, sub]);
  }
  const isDuplicate = (key: string, note: string, sub: string) => {
    const set = titles.get(key);
    if (!set) return false;
    return set.has('') || set.has(note.toLowerCase()) || (!!sub && set.has(sub.toLowerCase()));
  };
  const get = (r: string[], f: Field) => (cols[f] === undefined ? '' : (r[cols[f]!] ?? '').trim());

  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = parseDate(get(r, 'date'));
    const amt = parseAmount(get(r, 'amount'));
    if (!date) return errors.push({ line, reason: `Date “${get(r, 'date')}” not recognised` });
    if (amt === null || amt === 0) return errors.push({ line, reason: `Amount “${get(r, 'amount')}” not recognised` });

    const typeRaw = get(r, 'type').toLowerCase();
    const categoryName = get(r, 'category') || 'Others';
    // No type column: a category that only exists as income means income; everything else is spending.
    const type: EntryType = typeRaw
      ? /^(in|income|credit|cr)/.test(typeRaw)
        ? 'income'
        : 'expense'
      : categories.some((c) => c.type === 'income' && c.name.toLowerCase() === categoryName.toLowerCase()) &&
          !categories.some((c) => c.type === 'expense' && c.name.toLowerCase() === categoryName.toLowerCase())
        ? 'income'
        : 'expense';
    const cat = categories.find((c) => c.type === type && c.name.toLowerCase() === categoryName.toLowerCase());
    if (!cat) newCats.set(`${type}|${categoryName.toLowerCase()}`, type);
    const note = get(r, 'note');
    const amount = Math.abs(amt);
    const key = `${date}|${type}|${amount.toFixed(2)}`;
    const subName = get(r, 'subcategory');
    const duplicate = isDuplicate(key, note, subName);
    rows.push({
      line,
      date,
      type,
      amount,
      currency: (get(r, 'currency') || defaultCurrency).toUpperCase(),
      categoryName,
      categoryId: cat?.id ?? null,
      subName,
      note,
      context: /work/i.test(get(r, 'context')) ? 'work' : 'personal',
      tags: get(r, 'tags').split(/[;|]/).map((t) => t.trim()).filter(Boolean),
      duplicate,
    });
    remember(key, [note, subName]);
  });

  const newCategories = [...newCats.entries()].map(([k, type]) => ({
    type,
    name: rows.find((r) => `${r.type}|${r.categoryName.toLowerCase()}` === k)!.categoryName,
  }));
  return { rows, errors, newCategories };
}

/* ---------- Export ---------- */

export function entriesToCsv(
  entries: Entry[],
  cats: Map<string, Category>,
  tripName: (id: string) => string,
  def: string,
): string {
  const rows: (string | number)[][] = [
    ['Date', 'Type', 'Category', 'Subcategory', 'Amount', 'Currency', 'Rate', `Amount (${def})`, 'Context', 'Claim status', 'Trip', 'Note', 'Tags'],
  ];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = cats.get(e.categoryId);
    rows.push([
      e.date,
      e.type,
      c?.name ?? '',
      c?.subs.find((s) => s.id === e.subId)?.name ?? '',
      e.amount.toFixed(2),
      e.currency,
      e.rate,
      e.base.toFixed(2),
      e.context,
      e.claimStatus ?? '',
      e.tripId ? tripName(e.tripId) : '',
      e.note,
      e.tags.join('; '),
    ]);
  }
  return toCsv(rows);
}
