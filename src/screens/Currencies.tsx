import { useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { confirmDialog, toast } from '../ui/feedback';
import { db } from '../db/db';
import { useAllEntries, useRefs } from '../lib/refs';
import { COMMON_CURRENCIES, fetchRates, refreshRates } from '../lib/rates';
import { symbolOf } from '../lib/money';
import { timeAgo } from './Settings';

export function CurrenciesSheet() {
  const refs = useRefs();
  const all = useAllEntries();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!refs || !all) return <Sheet title="Currencies" icon="back">{null}</Sheet>;

  const def = refs.settings.defaultCurrency;
  const used = new Map<string, number>();
  for (const e of all) used.set(e.currency, (used.get(e.currency) ?? 0) + 1);

  async function refresh() {
    setBusy(true);
    try {
      const n = await refreshRates();
      toast(n ? `Updated ${n} ${n === 1 ? 'rate' : 'rates'}` : 'Nothing to update');
    } catch {
      toast('Couldn’t reach the rates service. Check your connection and try again.');
    }
    setBusy(false);
  }

  async function add() {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return toast('Use a 3-letter code such as SGD.');
    if (refs!.curByCode.has(c)) return toast(`${c} is already added.`);
    let rate = 1;
    try {
      rate = (await fetchRates(def, [c]))[c] ?? 0;
    } catch {
      rate = 0;
    }
    await db.currencies.add({ code: c, rate: rate || 1, order: refs!.currencies.length });
    setCode('');
    toast(rate ? `Added ${c} at ${rate.toFixed(4)}` : `Added ${c}. Set its rate manually — the rates service didn’t answer.`);
  }

  async function remove(c: string) {
    if (used.get(c)) return toast(`${c} is used by ${used.get(c)} entries, so it stays.`);
    const ok = await confirmDialog({ title: `Remove ${c}?`, confirm: 'Remove', danger: true });
    if (ok) await db.currencies.delete(c);
  }

  async function saveRate(c: string) {
    const v = Number(drafts[c]);
    setDrafts(({ [c]: _, ...rest }) => rest);
    if (!(v > 0)) return;
    await db.currencies.update(c, { rate: v });
    toast(`${c} set to ${v}`);
  }

  return (
    <Sheet title="Currencies" icon="back">
      <p class="small muted">
        Amounts are converted to {def} with these rates when you save an entry. Changing a rate never changes past entries.
      </p>
      <button class="btn tonal block" disabled={busy} onClick={refresh}>
        <Icon name="restore" />
        {busy ? 'Updating…' : `Update rates · last ${timeAgo(refs.settings.ratesUpdatedAt)}`}
      </button>

      <section class="card list">
        {refs.currencies.map((c) => (
          <div key={c.code} class="row">
            <span class="av cur-av">{c.code}</span>
            <span class="mid">
              <span class="t1">
                {c.code === def ? `${c.code} · default` : `1 ${c.code} = ${symbolOf(def)} ${c.rate.toFixed(4)}`}
              </span>
              <span class="t2">{used.get(c.code) ?? 0} entries</span>
            </span>
            {c.code !== def && (
              <>
                <label class="rate-input">
                  <span class="sr-only">{c.code} rate</span>
                  <input
                    id={`rate-${c.code}`}
                    inputMode="decimal"
                    value={drafts[c.code] ?? c.rate.toFixed(4)}
                    onInput={(e) => setDrafts({ ...drafts, [c.code]: e.currentTarget.value })}
                    onBlur={() => drafts[c.code] !== undefined && saveRate(c.code)}
                  />
                </label>
                <button class="iconbtn sm" aria-label={`Remove ${c.code}`} onClick={() => remove(c.code)}>
                  <Icon name="close" />
                </button>
              </>
            )}
          </div>
        ))}
      </section>

      <div class="label">Add a currency</div>
      <div class="add-cur">
        <label class="field grow">
          <span class="sr-only">Currency code</span>
          <input id="cur-code" list="cur-list" value={code} maxLength={3} placeholder="e.g. THB" onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} />
          <datalist id="cur-list">
            {COMMON_CURRENCIES.filter((c) => !refs.curByCode.has(c)).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <button class="btn primary" onClick={add} disabled={code.length !== 3}>
          Add
        </button>
      </div>
      <div class="chips">
        {COMMON_CURRENCIES.filter((c) => !refs.curByCode.has(c))
          .slice(0, 10)
          .map((c) => (
            <button key={c} class="chip" onClick={() => setCode(c)}>
              {c}
            </button>
          ))}
      </div>
      {all.length > 0 && <p class="small muted">Default currency is {def}. It can’t be changed once entries exist, because every total is kept in it.</p>}
    </Sheet>
  );
}
