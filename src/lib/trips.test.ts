import { describe, expect, it } from 'vitest';
import type { Entry, Trip } from '../db/types';
import { findTripByName, looksLikeTrip, tagTripSuggestions, tripKindFor } from './trips';

const e = (id: string, date: string, tags: string[], p: Partial<Entry> = {}): Entry => ({
  id, date, type: 'expense', amount: 10, currency: 'MYR', rate: 1, base: 10, categoryId: 'food', subId: null, context: 'work',
  claimStatus: null, claimSettledAt: null, claimSettlementId: null, tripId: null, note: '', tags, receiptIds: [],
  recurringId: null, createdAt: 0, updatedAt: 0, ...p,
});

describe('trip tags', () => {
  it('recognises trip-like tags', () => {
    expect(looksLikeTrip('Bangkok work trip')).toBe(true);
    expect(looksLikeTrip('Japan 2027')).toBe(true);
    expect(looksLikeTrip('Team lunch')).toBe(false);
    expect(tripKindFor('Bangkok work trip')).toBe('work');
    expect(tripKindFor('Japan 2027')).toBe('holiday');
  });

  it('suggests trips from tags, split by gaps, skipping existing trips and grouped entries', () => {
    const trips: Trip[] = [{ id: 't1', name: 'Japan 2027', kind: 'holiday', start: '2027-04-01', end: '2027-04-08', currency: null, createdAt: 0 }];
    const entries = [
      e('a', '2027-01-03', ['Bangkok work trip']),
      e('b', '2027-01-05', ['Bangkok work trip', 'Client']),
      e('c', '2027-03-10', ['Bangkok work trip']),
      e('d', '2027-04-02', ['Japan 2027']),
      e('x', '2027-01-04', ['Bangkok work trip'], { tripId: 't9' }),
      e('y', '2027-01-04', ['Team lunch']),
    ];
    const s = tagTripSuggestions(entries, trips);
    expect(s.map((x) => [x.name, x.start, x.end, x.entryIds.join('')])).toEqual([
      ['Bangkok work trip · Mar 2027', '2027-03-10', '2027-03-10', 'c'],
      ['Bangkok work trip · Jan 2027', '2027-01-03', '2027-01-05', 'ab'],
    ]);
    expect(findTripByName(trips, ' japan 2027 ')?.id).toBe('t1');
  });

  it('names two separate trips in the same month by start day', () => {
    const s = tagTripSuggestions([e('p', '2027-08-01', ['Beach trip']), e('q', '2027-08-03', ['Beach trip']), e('r', '2027-08-20', ['Beach trip'])], []);
    expect(s.map((x) => x.name).sort()).toEqual(['Beach trip · 1 Aug 2027', 'Beach trip · 20 Aug 2027']);
  });
});
