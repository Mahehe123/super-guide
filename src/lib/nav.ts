import { createStore } from './store';

/**
 * Navigation built on browser history so Android's back gesture behaves:
 *  - back closes the top overlay (sheet/dialog) first
 *  - then returns from another tab to Home
 *  - then leaves the app
 */
export const TABS = ['home', 'entries', 'claims', 'insights'] as const;
export type Tab = (typeof TABS)[number];

export type Overlay = { kind: string; props?: Record<string, unknown> };

type NavState = { tab: Tab; overlays: Overlay[] };

type HistState = { tab: Tab; depth: number } | null;

function tabFromHash(): Tab {
  const t = location.hash.replace(/^#\/?/, '').split('/')[0];
  return (TABS as readonly string[]).includes(t) ? (t as Tab) : 'home';
}

export const nav = createStore<NavState>({ tab: 'home', overlays: [] });

export function initNav() {
  const tab = tabFromHash();
  // Always keep a Home entry at the bottom of the stack.
  history.replaceState({ tab: 'home', depth: 0 } satisfies HistState, '', '#/home');
  if (tab !== 'home') history.pushState({ tab, depth: 0 } satisfies HistState, '', `#/${tab}`);
  nav.set({ tab, overlays: [] });

  window.addEventListener('popstate', (e) => {
    const st = e.state as HistState;
    const cur = nav.get();
    const tab = st?.tab ?? tabFromHash();
    const depth = st?.depth ?? 0;
    nav.set({ tab, overlays: cur.overlays.slice(0, depth) });
    backDone();
  });
}

/*
 * Back navigations are serialised: a second history.back() fired before the first
 * popstate arrives can be dropped or merged by the browser (seen on slower phones),
 * which left a sheet open after "Delete". Each back waits for the previous one.
 */
let inFlight = false;
let queued = 0;
let waiters: Array<() => void> = [];
let safety: ReturnType<typeof setTimeout> | undefined;

function doBack() {
  inFlight = true;
  clearTimeout(safety);
  // If the browser never answers (nothing to go back to), don't hang.
  safety = setTimeout(backDone, 1000);
  history.back();
}

function backDone() {
  clearTimeout(safety);
  inFlight = false;
  if (queued > 0) {
    queued--;
    doBack();
    return;
  }
  const w = waiters;
  waiters = [];
  w.forEach((f) => f());
}

export function goTab(tab: Tab) {
  const cur = nav.get();
  if (cur.tab === tab && cur.overlays.length === 0) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const st = history.state as HistState;
  if (tab === 'home' && cur.tab !== 'home' && st && st.depth === 0) {
    if (!inFlight) doBack();
    return;
  }
  const next: HistState = { tab, depth: 0 };
  if (cur.tab === 'home') history.pushState(next, '', `#/${tab}`);
  else history.replaceState(next, '', `#/${tab}`);
  nav.set({ tab, overlays: [] });
  window.scrollTo(0, 0);
}

export function openOverlay(kind: string, props?: Record<string, unknown>) {
  const cur = nav.get();
  const overlays = [...cur.overlays, { kind, props }];
  history.pushState({ tab: cur.tab, depth: overlays.length } satisfies HistState, '', location.hash);
  nav.set({ ...cur, overlays });
}

/** Close the top overlay (same as pressing back). Resolves once it has closed. */
export function closeOverlay(): Promise<void> {
  const stillOpen = nav.get().overlays.length - (inFlight ? 1 : 0) - queued;
  if (stillOpen <= 0) return Promise.resolve();
  const done = new Promise<void>((resolve) => waiters.push(resolve));
  if (inFlight) queued++;
  else doBack();
  return done;
}
