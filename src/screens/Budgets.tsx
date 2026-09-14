import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/feedback';
import { db } from '../db/db';
import { useAllEntries, useRefs } from '../lib/refs';
import { useLive } from '../lib/useLive';
import { suggestBudgets } from '../lib/insights';
import { inMonth } from '../lib/stats';
import { monthOf, today } from '../lib/dates';
import { amountOnly, money, symbolOf } from '../lib/money';
import { closeOverlay } from '../lib/nav';

export function BudgetsSheet() {
  const refs = useRefs();
  const all = useAllEntries();
  const saved = useLive(() => db.budgets.toArray());
  const [values, setValues] = useState<Record<string, string> | null>(null);

  const suggest = useMemo(() => (all ? suggestBudgets(all, today()) : new Map<string, number>()), [all]);
  const spent = useMemo(() => {
    const m = new Map<string, number>();
    const month = monthOf(today());
    for (const e of all ?? []) if (e.type === 'expense' && inMonth(e, month)) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.base);
    return m;
  }, [all]);

  useEffect(() => {
    if (saved && values === null) setValues(Object.fromEntries(saved.map((b) => [b.categoryId, String(b.monthlyLimit)])));
  }, [saved]);

  if (!refs || !values) return <Sheet title="Budgets" icon="back">{null}</Sheet>;
  const def = refs.settings.defaultCurrency;
  const cats = refs.categories.filter((c) => c.type === 'expense' && !c.archived);
  const total = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0);

  async function save() {
    const rows = Object.entries(values!)
      .map(([categoryId, v]) => ({ categoryId, monthlyLimit: Math.round(Number(v.replace(/,/g, '')) * 100) / 100 }))
      .filter((b) => b.monthlyLimit > 0);
    await db.transaction('rw', db.budgets, async () => {
      await db.budgets.clear();
      await db.budgets.bulkAdd(rows);
    });
    closeOverlay();
    toast(rows.length ? `Saved ${rows.length} budgets` : 'Budgets cleared');
  }

  return (
    <Sheet title="Budgets" icon="back">
      <p class="small muted">
        Monthly limits per category. Suggestions are your average of the last 3 months, rounded up to {symbolOf(def)} 50.
        Leave a box empty for no budget.
      </p>
      <div class="btn-row">
        <button
          class="btn tonal"
          disabled={suggest.size === 0}
          onClick={() => setValues({ ...values, ...Object.fromEntries([...suggest].map(([k, v]) => [k, String(v)])) })}
        >
          Use all suggestions
        </button>
        <button class="btn text" onClick={() => setValues({})}>
          Clear all
        </button>
      </div>

      <section class="card list">
        {cats.map((c) => {
          const s = suggest.get(c.id);
          const v = values[c.id] ?? '';
          return (
            <div key={c.id} class="row budget-row">
              <span class="av" aria-hidden="true">
                {c.emoji}
              </span>
              <span class="mid">
                <span class="t1">{c.name}</span>
                <span class="t2 num">
                  This month {money(spent.get(c.id) ?? 0, def, { whole: true })}
                  {s && v !== String(s) && (
                    <button class="pill tag as-btn" onClick={() => setValues({ ...values, [c.id]: String(s) })}>
                      Suggest {amountOnly(s, { whole: true })}
                    </button>
                  )}
                </span>
              </span>
              <label class="budget-input">
                <span class="sr-only">{c.name} budget</span>
                <input
                  id={`budget-${c.id}`}
                  inputMode="decimal"
                  placeholder={s ? amountOnly(s, { whole: true }) : '—'}
                  value={v}
                  onInput={(e) => setValues({ ...values, [c.id]: e.currentTarget.value.replace(/[^\d.]/g, '') })}
                />
              </label>
            </div>
          );
        })}
      </section>

      <div class="savebar">
        <button class="btn primary" onClick={save}>
          Save · {money(total, def, { whole: true })} / month
        </button>
      </div>
    </Sheet>
  );
}
