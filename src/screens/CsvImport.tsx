import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/feedback';
import { db, uid } from '../db/db';
import type { Category, Entry } from '../db/types';
import { useAllEntries, useRefs } from '../lib/refs';
import { detectColumns, parseCsv, planImport, type Field } from '../lib/csv';
import { fmtDay } from '../lib/dates';
import { money } from '../lib/money';
import { closeOverlay } from '../lib/nav';

const FIELDS: { id: Field; label: string; required?: boolean }[] = [
  { id: 'date', label: 'Date', required: true },
  { id: 'amount', label: 'Amount', required: true },
  { id: 'type', label: 'Income / expense' },
  { id: 'category', label: 'Category' },
  { id: 'subcategory', label: 'Subcategory' },
  { id: 'note', label: 'Note' },
  { id: 'currency', label: 'Currency' },
  { id: 'context', label: 'Personal / work' },
  { id: 'tags', label: 'Tags' },
];

export function CsvImportSheet({ file }: { file: File }) {
  const refs = useRefs();
  const all = useAllEntries();
  const [table, setTable] = useState<string[][] | null>(null);
  const [cols, setCols] = useState<Partial<Record<Field, number>>>({});
  const [skipDupes, setSkipDupes] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    file.text().then((t) => {
      const rows = parseCsv(t);
      setTable(rows);
      setCols(detectColumns(rows[0] ?? []));
    });
  }, [file]);

  const plan = useMemo(
    () => (table && refs && all && cols.date !== undefined && cols.amount !== undefined ? planImport(table, cols, refs.categories, all, refs.settings.defaultCurrency) : null),
    [table, cols, refs, all],
  );

  if (!refs || !all || !table) return <Sheet title="Import CSV">{null}</Sheet>;
  const header = table[0] ?? [];
  const def = refs.settings.defaultCurrency;
  const rows = plan ? plan.rows.filter((r) => !(skipDupes && r.duplicate)) : [];
  const dupes = plan ? plan.rows.filter((r) => r.duplicate).length : 0;

  async function run() {
    if (!plan || !rows.length) return;
    setBusy(true);
    const now = Date.now();
    await db.transaction('rw', db.entries, db.categories, db.currencies, async () => {
      // Create missing categories
      const cats = await db.categories.toArray();
      const byKey = new Map(cats.map((c) => [`${c.type}|${c.name.toLowerCase()}`, c]));
      const rates = new Map((await db.currencies.toArray()).map((c) => [c.code, c.rate]));
      for (const nc of plan.newCategories) {
        const c: Category = { id: `cat-${uid()}`, type: nc.type, name: nc.name, emoji: '📦', order: cats.filter((x) => x.type === nc.type).length, subs: [] };
        cats.push(c);
        byKey.set(`${c.type}|${c.name.toLowerCase()}`, c);
      }
      const entries: Entry[] = [];
      for (const r of rows) {
        const cat = byKey.get(`${r.type}|${r.categoryName.toLowerCase()}`)!;
        let sub = r.subName ? cat.subs.find((s) => s.name.toLowerCase() === r.subName.toLowerCase()) : undefined;
        if (r.subName && !sub) {
          sub = { id: `${cat.id}-${uid().slice(-6)}`, name: r.subName };
          cat.subs.push(sub);
        }
        if (!rates.has(r.currency)) {
          rates.set(r.currency, 1);
          await db.currencies.put({ code: r.currency, rate: 1, order: rates.size });
        }
        const rate = r.currency === def ? 1 : rates.get(r.currency)!;
        entries.push({
          id: uid(), date: r.date, type: r.type, amount: r.amount, currency: r.currency, rate, base: r.amount * rate,
          categoryId: cat.id, subId: sub?.id ?? null, context: r.context, claimStatus: null, claimSettledAt: null,
          claimSettlementId: null, tripId: null, note: r.note, tags: r.tags, receiptIds: [], recurringId: null, createdAt: now, updatedAt: now,
        });
      }
      await db.categories.bulkPut(cats);
      await db.entries.bulkAdd(entries);
    });
    closeOverlay();
    const n = plan.newCategories.length;
    toast(`Imported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}${n ? ` and ${n} new ${n === 1 ? 'category' : 'categories'}` : ''}`);
  }

  return (
    <Sheet title="Import CSV">
      <p class="small muted">
        {file.name} · {table.length - 1} rows. Check the columns match, then review below.
      </p>
      <section class="card list">
        {FIELDS.map((f) => (
          <div key={f.id} class="row map-row">
            <span class="mid">
              <span class="t1">
                {f.label}
                {f.required ? ' *' : ''}
              </span>
            </span>
            <label class="inline-select">
              <span class="sr-only">Column for {f.label}</span>
              <select
                id={`map-${f.id}`}
                value={cols[f.id] ?? ''}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setCols({ ...cols, [f.id]: v === '' ? undefined : Number(v) });
                }}
              >
                <option value="">— not in file —</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </section>

      {!plan && <p class="form-error">Choose the Date and Amount columns to continue.</p>}

      {plan && (
        <>
          <div class="stat3">
            <div>
              <span>Ready</span>
              <b class="num">{rows.length}</b>
            </div>
            <div>
              <span>Duplicates</span>
              <b class="num">{dupes}</b>
            </div>
            <div class={plan.errors.length ? 'tint-wait' : ''}>
              <span>Skipped</span>
              <b class="num">{plan.errors.length}</b>
            </div>
          </div>
          {dupes > 0 && (
            <label class="switch-row">
              <span>
                Skip likely duplicates
                <small>Same date, amount and note as an entry you already have</small>
              </span>
              <input type="checkbox" role="switch" checked={skipDupes} onChange={(e) => setSkipDupes(e.currentTarget.checked)} />
            </label>
          )}
          {plan.newCategories.length > 0 && (
            <p class="small">
              New categories will be created: <b>{plan.newCategories.map((c) => c.name).join(', ')}</b>
            </p>
          )}
          {plan.errors.length > 0 && (
            <details class="card">
              <summary class="small">Why {plan.errors.length} rows were skipped</summary>
              <ul class="small muted">
                {plan.errors.slice(0, 20).map((e) => (
                  <li key={e.line}>
                    Row {e.line}: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div class="label">Preview</div>
          <section class="card list">
            {rows.slice(0, 8).map((r) => (
              <div key={r.line} class="row">
                <span class="mid">
                  <span class="t1">{r.note || r.subName || r.categoryName}</span>
                  <span class="t2">
                    {fmtDay(r.date, { year: true })} · {r.categoryName}
                    {r.subName ? ` · ${r.subName}` : ''}
                  </span>
                </span>
                <span class={r.type === 'income' ? 'amt pos' : 'amt'}>
                  {r.type === 'income' ? '+' : '−'}
                  {money(r.amount, r.currency)}
                </span>
              </div>
            ))}
            {rows.length > 8 && <p class="small muted" style={{ padding: '8px 0 12px' }}>and {rows.length - 8} more</p>}
          </section>
          <button class="btn primary block" disabled={busy || !rows.length} onClick={run}>
            {busy ? 'Importing…' : `Add ${rows.length} entries`}
          </button>
        </>
      )}
    </Sheet>
  );
}
