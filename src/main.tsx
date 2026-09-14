import { render } from 'preact';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { closeOverlay, initNav, nav, openOverlay } from './lib/nav';
import { ensureSeed, getSettings, requestPersistence } from './db/db';
import { runAutoRecurring } from './lib/recurring';
import { pruneReceipts } from './lib/backup';
import { refreshRatesIfStale } from './lib/rates';
import { today } from './lib/dates';
import { toast } from './ui/feedback';

let lastRecurringRun = '';

/** Log "auto" recurring bills that fell due. Runs at start and whenever the app returns on a new day. */
async function catchUpRecurring() {
  const day = today();
  if (day === lastRecurringRun) return;
  lastRecurringRun = day;
  try {
    const n = await runAutoRecurring(day);
    if (n > 0) toast(`Logged ${n} recurring ${n === 1 ? 'bill' : 'bills'}`);
  } catch (err) {
    console.error('[recurring]', err);
  }
}

function setupUpdates() {
  const update = registerSW({
    onNeedRefresh() {
      // Don't interrupt someone halfway through an entry; offer it when they're back on a tab.
      const offer = () => toast('A new version of Hiyo is ready', { label: 'Update', run: () => update(true) }, { sticky: true });
      if (nav.get().overlays.length === 0) offer();
      else {
        const t = setInterval(() => {
          if (nav.get().overlays.length === 0) {
            clearInterval(t);
            offer();
          }
        }, 2000);
      }
    },
    onOfflineReady() {
      toast('Hiyo now works offline');
    },
  });
}

async function boot() {
  // Home-screen shortcut "Add entry" opens /?add=1
  const params = new URLSearchParams(location.search);
  const wantsAdd = params.has('add');
  if (wantsAdd) history.replaceState(null, '', location.pathname + location.hash);

  initNav();
  await ensureSeed();
  render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
    document.getElementById('app')!,
  );
  if (wantsAdd) openOverlay('entry');

  requestPersistence().catch(() => {});
  catchUpRecurring();
  refreshRatesIfStale();
  getSettings()
    .then((s) => s.receiptRetentionMonths && pruneReceipts(s.receiptRetentionMonths, today()))
    .catch(() => {});

  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && catchUpRecurring());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.get().overlays.length) closeOverlay();
  });
  if (import.meta.env.PROD) setupUpdates();
}

boot();
