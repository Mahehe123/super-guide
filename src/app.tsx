import { Icon, type IconName } from './ui/Icon';
import { ToastHost } from './ui/feedback';
import { useLive } from './lib/useLive';
import { db } from './db/db';
import { goTab, nav, openOverlay, type Tab } from './lib/nav';
import { Home } from './screens/Home';
import { Entries } from './screens/Entries';
import { Claims } from './screens/Claims';
import { Insights } from './screens/Insights';
import { OverlayHost } from './screens/overlays';

const TAB_META: Record<Tab, { label: string; icon: IconName }> = {
  home: { label: 'Home', icon: 'home' },
  entries: { label: 'Entries', icon: 'list' },
  claims: { label: 'Claims', icon: 'receipt' },
  insights: { label: 'Insights', icon: 'chart' },
};

const SCREENS: Record<Tab, () => preact.JSX.Element> = {
  home: Home,
  entries: Entries,
  claims: Claims,
  insights: Insights,
};

export function App() {
  const { tab, overlays } = nav.use();
  const Screen = SCREENS[tab];
  const showFab = tab === 'home' || tab === 'entries';
  const covered = overlays.length > 0;
  const pendingClaims = useLive(() => db.entries.where('claimStatus').equals('pending').count()) ?? 0;

  return (
    <>
      <div aria-hidden={covered} inert={covered}>
        <Screen />
        {showFab && (
          <button class="fab" onClick={() => openOverlay('entry')}>
            <Icon name="add" />
            Add
          </button>
        )}
        <nav class="tabs" aria-label="Main">
          {(Object.keys(TAB_META) as Tab[]).map((t) => (
            <button key={t} aria-current={t === tab ? 'page' : undefined} onClick={() => goTab(t)}>
              <span class="ind">
                <Icon name={TAB_META[t].icon} />
                {t === 'claims' && pendingClaims > 0 && (
                  <span class="badge num" aria-label={`${pendingClaims} pending`}>
                    {pendingClaims}
                  </span>
                )}
              </span>
              {TAB_META[t].label}
            </button>
          ))}
        </nav>
      </div>
      <OverlayHost overlays={overlays} />
      <ToastHost />
    </>
  );
}
