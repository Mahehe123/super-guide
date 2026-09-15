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
import { backfillClaimable, runAutoRecurring } from './lib/recurring';
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

  // Register updates first, so a fixed version can still arrive even if startup below fails.
  if (import.meta.env.PROD) setupUpdates();

  const root = document.getElementById('app')!;
  let rendered = false;
  const onFatal = (err: unknown) => {
    if (!rendered) render(<BootError error={err} />, root);
  };
  window.addEventListener('error', (e) => onFatal(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => onFatal(e.reason));

  try {
    initNav();
    await withTimeout(ensureSeed(), 10_000, 'The database didn’t respond within 10 seconds.');
    render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>,
      root,
    );
    rendered = true;
  } catch (err) {
    onFatal(err);
    return;
  }
  if (wantsAdd) openOverlay('entry');

  requestPersistence().catch(() => {});
  backfillClaimable()
    .catch(() => 0)
    .then(() => catchUpRecurring());
  refreshRatesIfStale();
  getSettings()
    .then((s) => s.receiptRetentionMonths && pruneReceipts(s.receiptRetentionMonths, today()))
    .catch(() => {});

  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && catchUpRecurring());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.get().overlays.length) closeOverlay();
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

/** Shown instead of a blank page when Hiyo can't start. Data stays in IndexedDB untouched. */
function BootError({ error }: { error: unknown }) {
  const text = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  return (
    <main class="screen crash" role="alert">
      <h1>Hiyo couldn’t start</h1>
      <p>Your entries are still saved on this phone. Try these in order:</p>
      <button class="btn primary block" onClick={() => location.replace(location.pathname)}>
        Reload
      </button>
      <button
        class="btn block"
        onClick={async () => {
          // Drop a stuck offline copy of the app (never touches your data), then reload fresh.
          const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
          await Promise.all(regs.map((r) => r.unregister()));
          for (const k of (await caches?.keys?.()) ?? []) await caches.delete(k);
          location.replace(location.pathname);
        }}
      >
        Reload latest version
      </button>
      <p class="small muted">If it still fails, send a screenshot of the text below.</p>
      <pre>{text.slice(0, 1200)}</pre>
    </main>
  );
}

boot();
