import type { DateStr, Entry, Trip, TripKind } from '../db/types';
import { daysBetween, fmtDay, monthLabel, monthOf } from './dates';

const YEAR_RE = /\b(19|20)\d{2}\b/;
/** Entries more than this many days apart are treated as separate trips. */
export const TRIP_GAP_DAYS = 7;

/** "Bangkok work trip", "Japan 2027" */
export function looksLikeTrip(tag: string): boolean {
  return /\btrip\b/i.test(tag) || YEAR_RE.test(tag);
}

export function tripKindFor(name: string): TripKind {
  if (/work|business|customer|client/i.test(name)) return 'work';
  if (YEAR_RE.test(name) || /holiday|vacation|trip/i.test(name)) return 'holiday';
  return 'other';
}

export function findTripByName(trips: Trip[], name: string): Trip | undefined {
  const n = name.trim().toLowerCase();
  return trips.find((t) => t.name.trim().toLowerCase() === n);
}

export interface TagTripSuggestion {
  key: string;
  tag: string;
  name: string;
  kind: TripKind;
  start: DateStr;
  end: DateStr;
  entryIds: string[];
}

/** Split date-sorted entries wherever there's a gap longer than TRIP_GAP_DAYS. */
export function splitByGaps<T extends { date: DateStr }>(list: T[]): T[][] {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const groups: T[][] = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    if (last && daysBetween(last[last.length - 1].date, e.date) <= TRIP_GAP_DAYS) last.push(e);
    else groups.push([e]);
  }
  return groups;
}

/**
 * Tags that look like trips, used on entries not yet in a trip, and not already a trip's name.
 * "... trip" tags are split by date gaps; year tags ("Japan 2027") stay whole.
 */
export function tagTripSuggestions(entries: Entry[], trips: Trip[]): TagTripSuggestion[] {
  const byTag = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.tripId) continue;
    for (const tag of e.tags) if (looksLikeTrip(tag) && !findTripByName(trips, tag)) byTag.set(tag, [...(byTag.get(tag) ?? []), e]);
  }
  const out: TagTripSuggestion[] = [];
  for (const [tag, list] of byTag) {
    const groups = /\btrip\b/i.test(tag) ? splitByGaps(list) : [[...list].sort((a, b) => a.date.localeCompare(b.date))];
    // Separate trips get "· Aug 2026"; two in the same month get their start day instead.
    const months = groups.map((g) => monthOf(g[0].date));
    const sameMonth = new Set(months).size < months.length;
    for (const g of groups) {
      const start = g[0].date;
      const suffix = sameMonth ? fmtDay(start, { year: true }) : monthLabel(monthOf(start), 'short');
      const name = groups.length > 1 ? `${tag} · ${suffix}` : tag;
      if (findTripByName(trips, name)) continue;
      out.push({ key: `${tag}|${start}`, tag, name, kind: tripKindFor(tag), start, end: g[g.length - 1].date, entryIds: g.map((e) => e.id) });
    }
  }
  return out.sort((a, b) => b.start.localeCompare(a.start));
}
