import type { Category, EntryType } from './types';

function cat(type: EntryType, id: string, name: string, emoji: string, subs: string[], order: number): Category {
  return {
    id,
    type,
    name,
    emoji,
    order,
    subs: subs.map((s, i) => ({ id: `${id}-${i + 1}`, name: s })),
  };
}

/** Starter categories for a fresh install (a Kira import replaces these). */
export const DEFAULT_CATEGORIES: Category[] = [
  cat('expense', 'food', 'Food', '🍜', ['Breakfast', 'Lunch', 'Dinner', 'Eating Out', 'Drinks'], 0),
  cat('expense', 'home', 'Household', '🏠', ['Grocery', 'Utilities', 'Maintenance', 'Cleaning'], 1),
  cat('expense', 'tpt', 'Transport', '🚗', ['Petrol', 'Touch n go', 'Taxi', 'Parking'], 2),
  cat('expense', 'shop', 'Shopping', '🛍️', ['Clothing', 'Electronics', 'Personal Care', 'Online'], 3),
  cat('expense', 'bills', 'Bills', '📋', ['Phone', 'Internet', 'Subscriptions'], 4),
  cat('expense', 'hlth', 'Health', '💊', ['Clinic', 'Pharmacy', 'Insurance'], 5),
  cat('expense', 'fun', 'Entertainment', '🎬', ['Movies', 'Games', 'Events'], 6),
  cat('expense', 'hol', 'Holiday', '✈️', ['Flights', 'Hotel', 'Activities'], 7),
  cat('expense', 'oth_e', 'Others', '📦', ['Miscellaneous'], 8),
  cat('income', 'sal', 'Salary', '💰', ['Monthly Salary', 'Bonus'], 0),
  cat('income', 'clm', 'Claims', '🧾', ['Work Claims'], 1),
  cat('income', 'oth_i', 'Others', '📥', ['Gift', 'Refund', 'Miscellaneous'], 2),
];
