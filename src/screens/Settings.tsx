import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Icon, type IconName } from '../ui/Icon';
import { confirmDialog, confirmWithOption, toast } from '../ui/feedback';
import { db, updateSettings } from '../db/db';
import { useAllEntries, useRefs } from '../lib/refs';
import { useLive } from '../lib/useLive';
import { backupFilename, buildBackup, isHiyoBackup, restoreBackup } from '../lib/backup';
import { entriesToCsv } from '../lib/csv';
import { shareFile } from '../lib/files';
import { closeOverlay, openOverlay } from '../lib/nav';
import { today } from '../lib/dates';
import { isKiraData } from '../migrate/kira';
import { startKiraImport } from './KiraImport';

export function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** Share a backup file; records the time unless the share was cancelled. */
export async function backUpNow(withReceipts?: boolean) {
  let receipts = withReceipts;
  if (receipts === undefined) {
    const count = await db.receipts.count();
    const res = await confirmWithOption({
      title: 'Back up now',
      body: 'Choose Google Drive, Files or a chat in the share sheet to keep a copy off this phone.',
      confirm: 'Back up',
      option: count ? { label: `Include ${count} receipt photos (bigger file)`, checked: true } : undefined,
    });
    if (!res.ok) return;
    receipts = count > 0 && res.checked;
  }
  const backup = await buildBackup(!!receipts);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const result = await shareFile(blob, backupFilename(!!receipts), 'Hiyo backup');
  if (result === 'cancelled') return;
  await updateSettings({ lastBackupAt: Date.now() });
  const mb = (blob.size / 1_048_576).toFixed(1);
  toast(result === 'downloaded' ? `Backup saved to Downloads (${mb} MB)` : `Backup shared (${mb} MB)`);
}

async function restoreFrom(file: File) {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('That file isn’t a backup. Choose a hiyo-backup .json file.');
  }
  if (isKiraData(data)) return startKiraImport('file', file);
  if (!isHiyoBackup(data)) return toast('That file isn’t a Hiyo backup.');
  const existing = await db.entries.count();
  const ok = await confirmDialog({
    title: 'Restore this backup?',
    body: `Backup from ${new Date(data.exportedAt).toLocaleString('en-MY')} with ${data.entries.length} entries${data.receipts ? ` and ${data.receipts.length} receipts` : ''}.\n\nThis replaces the ${existing} entries on this phone.`,
    confirm: 'Restore',
    danger: true,
  });
  if (!ok) return;
  try {
    const r = await restoreBackup(data);
    toast(`Restored ${r.entries} entries`);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Restore failed. Nothing was changed.');
  }
}

function Row({ icon, title, sub, onClick, children }: { icon: IconName; title: string; sub?: string; onClick?: () => void; children?: preact.ComponentChildren }) {
  const body = (
    <>
      <span class="av">
        <Icon name={icon} size={20} />
      </span>
      <span class="mid">
        <span class="t1">{title}</span>
        {sub && <span class="t2">{sub}</span>}
      </span>
      {children ?? (onClick && <Icon name="right" class="muted" />)}
    </>
  );
  return onClick ? (
    <button class="row" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div class="row">{body}</div>
  );
}

export function SettingsSheet() {
  const refs = useRefs();
  const all = useAllEntries();
  const receipts = useLive(() => db.receipts.count());
  const [storage, setStorage] = useState<{ used: number; persisted: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      setStorage({ used: est?.usage ?? 0, persisted });
    })();
  }, [all?.length]);

  if (!refs || !all) return <Sheet title="Settings" icon="back">{null}</Sheet>;
  const s = refs.settings;

  async function exportCsv() {
    const csv = entriesToCsv(all!, refs!.catById, (id) => refs!.tripById.get(id)?.name ?? '', s.defaultCurrency);
    const r = await shareFile(new Blob([csv], { type: 'text/csv' }), `hiyo-entries-${today()}.csv`, 'Hiyo entries');
    if (r === 'downloaded') toast('CSV saved to Downloads');
  }

  async function clearAll() {
    const first = await confirmDialog({
      title: 'Delete all data?',
      body: `This removes ${all!.length} entries, ${receipts ?? 0} receipts, trips, budgets and recurring bills from this phone.`,
      confirm: 'Continue',
      danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'Are you sure?',
      body: s.lastBackupAt ? `Your last backup was ${timeAgo(s.lastBackupAt)}.` : 'You have never backed up. This cannot be undone.',
      confirm: 'Delete everything',
      danger: true,
    });
    if (!second) return;
    await db.transaction('rw', [db.entries, db.receipts, db.trips, db.recurring, db.budgets], async () => {
      await Promise.all([db.entries.clear(), db.receipts.clear(), db.trips.clear(), db.recurring.clear(), db.budgets.clear()]);
    });
    closeOverlay();
    toast('All entries deleted');
  }

  const fileInput = (accept: string, onFile: (f: File) => void, label: string) => (
    <input
      type="file"
      accept={accept}
      class="sr-only"
      aria-label={label}
      onChange={(e) => {
        const f = e.currentTarget.files?.[0];
        if (f) onFile(f);
        e.currentTarget.value = '';
      }}
    />
  );

  return (
    <Sheet title="Settings" icon="back">
      <div class="label">Backup</div>
      <section class="card list">
        <Row icon="backup" title="Back up now" sub={`Last backup ${timeAgo(s.lastBackupAt)} · shares a file to Drive, Files or chat`} onClick={() => backUpNow()} />
        <label class="row">
          <span class="av">
            <Icon name="restore" size={20} />
          </span>
          <span class="mid">
            <span class="t1">Restore from backup</span>
            <span class="t2">A hiyo-backup file, or a kira-backup.json</span>
          </span>
          <Icon name="right" class="muted" />
          {fileInput('application/json,.json', restoreFrom, 'Choose backup file')}
        </label>
      </section>

      <div class="label">Money</div>
      <section class="card list">
        <Row icon="category" title="Categories" sub={`${refs.categories.filter((c) => !c.archived).length} categories`} onClick={() => openOverlay('categories')} />
        <Row
          icon="money"
          title="Currencies"
          sub={`${refs.currencies.map((c) => c.code).join(', ')} · rates ${s.ratesUpdatedAt ? `updated ${timeAgo(s.ratesUpdatedAt)}` : 'not updated yet'}`}
          onClick={() => openOverlay('currencies')}
        />
        <Row icon="repeat" title="Recurring bills" sub={`${refs.recurring.filter((r) => r.active).length} active`} onClick={() => openOverlay('recurring')} />
        <Row icon="wallet" title="Budgets" onClick={() => openOverlay('budgets')} />
        <Row icon="flight" title="Trips" sub={`${refs.trips.length} trips`} onClick={() => openOverlay('trips')} />
      </section>

      <div class="label">Claims</div>
      <section class="card list">
        <Row icon="calendar" title="Claim cutoff day" sub="Cycles run from the day after, to this day next month">
          <label class="inline-select">
            <span class="sr-only">Claim cutoff day</span>
            <select id="set-cutoff" value={s.claimCutoffDay} onChange={(e) => updateSettings({ claimCutoffDay: Number(e.currentTarget.value) })}>
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        </Row>
        <Row icon="time" title="Cutoff reminder" sub="Shows the days left on Home in the last 5 days of a cycle">
          <input type="checkbox" role="switch" aria-label="Cutoff reminder" checked={s.claimReminder} onChange={(e) => updateSettings({ claimReminder: e.currentTarget.checked })} />
        </Row>
      </section>

      <div class="label">Data</div>
      <section class="card list">
        <Row icon="download" title="Export entries (CSV)" sub={`${all.length} entries, for Excel or Google Sheets`} onClick={exportCsv} />
        <label class="row">
          <span class="av">
            <Icon name="upload" size={20} />
          </span>
          <span class="mid">
            <span class="t1">Import from CSV</span>
            <span class="t2">Bank or spreadsheet export; you’ll review before anything is added</span>
          </span>
          <Icon name="right" class="muted" />
          {fileInput('.csv,text/csv', (f) => openOverlay('csv-import', { file: f }), 'Choose CSV file')}
        </label>
        <Row icon="camera" title="Keep receipt photos" sub={`${receipts ?? 0} photos · photos on pending claims are always kept`}>
          <label class="inline-select">
            <span class="sr-only">Keep receipt photos</span>
            <select
              id="set-retention"
              value={s.receiptRetentionMonths ?? ''}
              onChange={(e) => updateSettings({ receiptRetentionMonths: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
            >
              <option value="">Forever</option>
              <option value="24">2 years</option>
              <option value="12">1 year</option>
              <option value="6">6 months</option>
            </select>
          </label>
        </Row>
      </section>

      <div class="label">This phone</div>
      <section class="card list">
        <Row
          icon="info"
          title={storage ? `${(storage.used / 1_048_576).toFixed(1)} MB used` : 'Storage'}
          sub={
            storage?.persisted
              ? 'Protected: Android won’t clear Hiyo’s data to free space'
              : 'Not yet protected. Install Hiyo to the home screen so Android keeps its data.'
          }
        />
        <button class="row danger-row" onClick={clearAll}>
          <span class="av">
            <Icon name="delete" size={20} />
          </span>
          <span class="mid">
            <span class="t1">Delete all data</span>
            <span class="t2">Keeps categories and currencies</span>
          </span>
        </button>
      </section>
      <p class="small muted center">Hiyo {__APP_VERSION__} · everything stays on this phone</p>
    </Sheet>
  );
}
