const SYMBOL: Record<string, string> = { MYR: 'RM', SGD: 'S$', USD: 'US$', JPY: '¥', CNY: 'CN¥', HKD: 'HK$', TWD: 'NT$', EUR: '€', GBP: '£' };

const fmt2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });

export function symbolOf(code: string): string {
  return SYMBOL[code] ?? code;
}

/** "RM 1,234.56" — `sign` adds + / − */
export function money(n: number, currency = 'MYR', opts: { sign?: boolean; whole?: boolean } = {}): string {
  const abs = (opts.whole ? fmt0 : fmt2).format(Math.abs(n));
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${symbolOf(currency)} ${abs}`;
}

/** Number without currency: "1,234" / "+1,234" / "−1,234.50" */
export function amountOnly(n: number, opts: { sign?: boolean; whole?: boolean } = {}): string {
  const abs = (opts.whole ? fmt0 : fmt2).format(Math.abs(n));
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  return sign + abs;
}

/** Compact for charts: 13.7k */
export function compact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '+';
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${abs.toFixed(0)}`;
}

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}
