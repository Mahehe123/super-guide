import { db, updateSettings } from '../db/db';

const SOURCES = [
  (base: string) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base}.json`,
  (base: string) => `https://latest.currency-api.pages.dev/v1/currencies/${base}.json`,
];

/** Default-currency units per 1 unit of each code, e.g. { SGD: 3.19 } for MYR. */
export async function fetchRates(defaultCurrency: string, codes: string[]): Promise<Record<string, number>> {
  const base = defaultCurrency.toLowerCase();
  let lastErr: unknown;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url(base), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const table = json[base] as Record<string, number>;
      const out: Record<string, number> = {};
      for (const code of codes) {
        const perBase = table[code.toLowerCase()];
        if (perBase > 0) out[code] = 1 / perBase;
      }
      return out;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Rates unavailable');
}

/** Updates stored rates. New entries use them; existing entries keep the rate they were logged with. */
export async function refreshRates(): Promise<number> {
  const settings = (await db.meta.get('settings'))?.value;
  const def = settings?.defaultCurrency ?? 'MYR';
  const currencies = await db.currencies.toArray();
  const foreign = currencies.filter((c) => c.code !== def).map((c) => c.code);
  if (!foreign.length) return 0;
  const rates = await fetchRates(def, foreign);
  await db.transaction('rw', db.currencies, async () => {
    for (const c of currencies) if (rates[c.code]) await db.currencies.update(c.code, { rate: rates[c.code] });
  });
  await updateSettings({ ratesUpdatedAt: Date.now() });
  return Object.keys(rates).length;
}

/** Quietly refresh once a day when online. */
export async function refreshRatesIfStale() {
  if (!navigator.onLine) return;
  const s = (await db.meta.get('settings'))?.value;
  if (s?.ratesUpdatedAt && Date.now() - s.ratesUpdatedAt < 24 * 3600_000) return;
  try {
    await refreshRates();
  } catch {
    /* offline or source down; try again next launch */
  }
}

export const COMMON_CURRENCIES = [
  'MYR', 'SGD', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HKD', 'TWD', 'THB', 'IDR', 'PHP', 'VND', 'KRW', 'AUD', 'NZD', 'INR', 'AED', 'CHF', 'CAD',
];
