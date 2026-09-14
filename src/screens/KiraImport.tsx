import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/feedback';
import { closeOverlay, openOverlay } from '../lib/nav';
import { createStore } from '../lib/store';
import { money } from '../lib/money';
import { monthLabel } from '../lib/dates';
import { db } from '../db/db';
import { mapKira, type KiraData, type KiraMapped } from '../migrate/kira';
import { applyKiraImport, readKiraFile, readKiraFromDevice } from '../migrate/applyImport';

type Source = { kind: 'device' } | { kind: 'file'; data: KiraData };

const pending = createStore<Source | null>(null);

export async function startKiraImport(source: 'device' | 'file', file?: File) {
  if (source === 'file') {
    try {
      pending.set({ kind: 'file', data: await readKiraFile(file!) });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t read that file.');
      return;
    }
  } else {
    pending.set({ kind: 'device' });
  }
  openOverlay('kira-import');
}

/** Hidden file input + button, for "Choose kira-backup.json". */
export function KiraFileButton({ class: cls = 'btn' }: { class?: string }) {
  return (
    <label class={cls}>
      <input
        type="file"
        accept="application/json,.json"
        class="sr-only"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) startKiraImport('file', f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />
      Choose backup file
    </label>
  );
}

const fmtDate = (d: string) => `${Number(d.slice(8, 10))} ${monthLabel(d.slice(0, 7), 'short').slice(0, 3)}`;

function dateRange(a: string, b: string) {
  if (a === b) return `${fmtDate(a)} ${a.slice(0, 4)}`;
  return `${fmtDate(a)} – ${fmtDate(b)} ${b.slice(0, 4)}`;
}

export function KiraImportSheet() {
  const source = pending.use();
  const [mapped, setMapped] = useState<KiraMapped | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(0);
  const [trips, setTrips] = useState<Set<string>>(new Set());
  const [recurring, setRecurring] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = source?.kind === 'file' ? source.data : await readKiraFromDevice();
        if (!data) throw new Error('No Kira data found on this phone. Choose your kira-backup.json instead.');
        const m = mapKira(data);
        setMapped(m);
        setTrips(new Set(m.trips.map((t) => t.key)));
        setRecurring(new Set(m.recurring.filter((r) => r.stillRunning && r.template.mode === 'auto').map((r) => r.key)));
        setExisting(await db.entries.count());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Couldn’t read Kira data.');
      }
    })();
  }, [source]);

  const summary = useMemo(() => {
    if (!mapped) return null;
    const dates = mapped.entries.map((e) => e.date).sort();
    return {
      from: dates[0],
      to: dates[dates.length - 1],
      pending: mapped.entries.filter((e) => e.claimStatus === 'pending').reduce((s, e) => s + e.base, 0),
    };
  }, [mapped]);

  const toggle = (set: Set<string>, update: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };

  async function runImport() {
    if (!mapped) return;
    setBusy(true);
    try {
      const res = await applyKiraImport(mapped, { tripKeys: trips, recurringKeys: recurring });
      pending.set(null);
      closeOverlay();
      toast(`Imported ${res.entries} entries, ${res.receipts} receipts and ${res.trips} trips`);
    } catch (err) {
      console.error(err);
      setBusy(false);
      setError('Import failed and nothing was changed. Try again, or use the backup file.');
    }
  }

  return (
    <Sheet title="Import from Kira">
      {error && (
        <div class="card notice warn" role="alert">
          <Icon name="bulb" />
          <span>{error}</span>
        </div>
      )}
      {!mapped && !error && <div class="empty">Reading Kira data…</div>}
      {mapped && summary && (
        <>
          <section class="hero">
            <div class="k">Found in {source?.kind === 'file' ? 'backup file' : 'Kira on this phone'}</div>
            <div class="big num">{mapped.entries.length} entries</div>
            <div class="minis">
              <div class="mini">
                <span>Dates</span>
                <b>{dateRange(summary.from, summary.to)}</b>
              </div>
              <div class="mini">
                <span>Receipts</span>
                <b class="num">{Object.keys(mapped.receipts).length} photos</b>
              </div>
              <div class="mini">
                <span>Categories</span>
                <b class="num">{mapped.categories.length}</b>
              </div>
              <div class="mini">
                <span>Claims owed</span>
                <b class="num">{money(summary.pending)}</b>
              </div>
            </div>
          </section>

          <p class="muted small">Kira stays untouched. Your settings come across too: {mapped.settings.defaultCurrency}, claim cutoff on the {mapped.settings.claimCutoffDay}th.</p>

          <div class="label">Turn these into trips · {trips.size} of {mapped.trips.length}</div>
          <div class="card list">
            {mapped.trips.map((t) => (
              <label class="check-row" key={t.key}>
                <input type="checkbox" checked={trips.has(t.key)} onChange={() => toggle(trips, setTrips, t.key)} />
                <span class="av">
                  <Icon name="flight" size={20} />
                </span>
                <span class="mid">
                  <span class="t1">{t.name}</span>
                  <span class="t2">
                    {dateRange(t.start, t.end)} · {t.entryIds.length} {t.entryIds.length === 1 ? 'entry' : 'entries'} ·{' '}
                    {t.fromTag ? 'from tag' : 'from Holiday subcategory'}
                  </span>
                </span>
                <span class="amt num">{money(t.total, 'MYR', { whole: true })}</span>
              </label>
            ))}
          </div>

          <div class="label">Recurring bills · {recurring.size} of {mapped.recurring.length}</div>
          <div class="card list">
            {mapped.recurring.map((r) => (
              <label class="check-row" key={r.key}>
                <input
                  type="checkbox"
                  checked={recurring.has(r.key)}
                  onChange={() => toggle(recurring, setRecurring, r.key)}
                />
                <span class="av">
                  <Icon name="repeat" size={20} />
                </span>
                <span class="mid">
                  <span class="t1">{r.label}</span>
                  <span class="t2">
                    {r.template.endMonth
                      ? `${r.stillRunning ? 'Until' : 'Ended'} ${monthLabel(r.template.endMonth, 'short')}`
                      : 'No end date · asks before logging'}
                    {' · '}day {r.template.dayOfMonth}
                  </span>
                </span>
                <span class="amt num">{money(r.template.amount, r.template.currency)}</span>
              </label>
            ))}
          </div>

          {existing > 0 && (
            <div class="card notice warn" role="note">
              <Icon name="bulb" />
              <span>Hiyo already has {existing} entries on this phone. Importing replaces them.</span>
            </div>
          )}

          <button class="btn primary block" disabled={busy} onClick={runImport}>
            {busy ? 'Importing…' : `Import ${mapped.entries.length} entries`}
          </button>
        </>
      )}
      {error && !mapped && <KiraFileButton class="btn tonal block" />}
    </Sheet>
  );
}

/** Home card shown until Kira data has been imported. */
export function KiraImportCard({ onDevice }: { onDevice: boolean }) {
  return (
    <section class="card import-card">
      <div class="label">Moving from Kira?</div>
      <p>
        {onDevice
          ? 'Kira data was found on this phone. Bring over your entries, receipts, claims and categories in one go.'
          : 'Bring over your entries, receipts and claims from a kira-backup.json file.'}
      </p>
      <div class="btn-row">
        {onDevice && (
          <button class="btn primary" onClick={() => startKiraImport('device')}>
            Import from Kira
          </button>
        )}
        <KiraFileButton class={onDevice ? 'btn' : 'btn primary'} />
      </div>
    </section>
  );
}
