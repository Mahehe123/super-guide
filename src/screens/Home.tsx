import { useMemo, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { EntryRow } from '../ui/EntryRow';
import { MonthSwitcher } from '../ui/MonthSwitcher';
import { useAllEntries, useRefs } from '../lib/refs';
import { claimCycle, claimMonthFor, daysBetween, fmtDay, monthOf, today } from '../lib/dates';
import { money } from '../lib/money';
import { expectedIncome, inMonth, nextDue, nextOccurrences, pace, pendingClaims, totals } from '../lib/stats';
import { goTab, openOverlay } from '../lib/nav';
import { hasKiraOnDevice } from '../migrate/applyImport';
import { KiraImportCard } from './KiraImport';
import { entriesView } from './Entries';
import { DueConfirmCard } from './Recurring';
import { insightsView } from './Insights';
import { Meter } from '../ui/charts';
import { useLive } from '../lib/useLive';
import { db } from '../db/db';
import { categoryBreakdown } from '../lib/insights';
import { backUpNow, timeAgo } from './Settings';

/** "1 Oct" — fixed month names (en-MY formats September as "Sept"). */
const shortDate = (d: string) => fmtDay(d);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function Home() {
  const refs = useRefs();
  const all = useAllEntries();
  const now = today();
  const [month, setMonth] = useState(monthOf(now));
  const isCurrent = month === monthOf(now);
  const budgets = useLive(() => db.budgets.toArray());

  const s = useMemo(() => {
    if (!refs || !all) return null;
    const monthList = all.filter((e) => inMonth(e, month));
    const t = totals(monthList);
    const expected = expectedIncome(all, refs.catById, month, now);
    const p = pace(all, month, now);
    const claims = pendingClaims(all);
    const due = nextDue(nextOccurrences(refs.recurring, all, refs.curByCode, now));
    const activeTrip = refs.trips.find((tr) => tr.start <= now && (tr.end ?? tr.start) >= now);
    const budgetRows = budgets?.length ? categoryBreakdown(all, month, budgets).filter((r) => r.budget) : [];
    const budget = budgetRows.length
      ? {
          limit: budgetRows.reduce((a, r) => a + (r.budget ?? 0), 0),
          spent: budgetRows.reduce((a, r) => a + r.amount, 0),
          over: budgetRows.filter((r) => r.amount > (r.budget ?? 0)).sort((a, b) => b.amount - (b.budget ?? 0) - (a.amount - (a.budget ?? 0))),
        }
      : null;
    return { t, expected, p, claims, due, activeTrip, budget, recent: monthList.slice(0, 5), count: monthList.length };
  }, [refs, all, month, budgets]);

  if (!refs || !all || !s) return <main class="screen" />;
  const def = refs.settings.defaultCurrency;
  const cutoff = refs.settings.claimCutoffDay;
  const cycle = claimCycle(claimMonthFor(now, cutoff), cutoff);
  const daysLeft = daysBetween(now, cycle.to);
  const driverCat = s.p.driver ? refs.catById.get(s.p.driver.categoryId) : undefined;

  return (
    <main class="screen">
      <header class="appbar">
        <h1>Hiyo</h1>
        <MonthSwitcher month={month} onChange={setMonth} />
        <button class="iconbtn" aria-label="Settings" onClick={() => openOverlay('settings')}>
          <Icon name="tune" />
        </button>
      </header>

      {!refs.settings.kiraImportedAt && all.length === 0 && <KiraImportCard onDevice={hasKiraOnDevice()} />}

      {all.length > 0 && (!refs.settings.lastBackupAt || Date.now() - refs.settings.lastBackupAt > 7 * 86_400_000) && (
        <section class="card notice warn backup-nudge">
          <Icon name="backup" />
          <span class="grow">
            <b>{refs.settings.lastBackupAt ? `Last backup ${timeAgo(refs.settings.lastBackupAt)}` : 'No backup yet'}</b>
            <span class="small">Your data lives only on this phone.</span>
          </span>
          <button class="btn" onClick={() => backUpNow()}>
            Back up
          </button>
        </section>
      )}

      <section class="hero" aria-label="Month summary">
        <div class="k">{isCurrent ? `Net so far · 1–${Number(now.slice(8, 10))} ${fmtDay(now).split(' ')[1]}` : 'Net for the month'}</div>
        <div class="big num">{money(s.t.net, def, { sign: true })}</div>
        {s.expected && (
          <div class="hero-note">
            <Icon name="time" size={18} />
            <span>
              Income usually lands {ordinal(s.expected.dayFrom)}
              {s.expected.dayTo !== s.expected.dayFrom ? `–${ordinal(s.expected.dayTo)}` : ''}. Expected net{' '}
              <b class="num">{money(s.t.net + s.expected.amount, def, { sign: true })}</b>
            </span>
          </div>
        )}
        <div class="minis">
          <button class="mini" onClick={() => { entriesView.set({ month, filter: 'income', categoryId: null }); goTab('entries'); }}>
            <span>Income</span>
            <b class="num">{money(s.t.income, def)}</b>
          </button>
          <button class="mini" onClick={() => { entriesView.set({ month, filter: 'expense', categoryId: null }); goTab('entries'); }}>
            <span>Spent</span>
            <b class="num">{money(s.t.expense, def)}</b>
          </button>
        </div>
      </section>

      {s.p.lastSpent > 0 && s.p.thisSpent > 0 && (
        <section class="card">
          <div class="label">{isCurrent ? `Spending pace · day ${s.p.day}` : 'Compared with the month before'}</div>
          <div class="pace">
            {[
              { k: 'Last', v: s.p.lastSpent, cls: 'fill soft' },
              { k: 'This', v: s.p.thisSpent, cls: 'fill strong' },
            ].map((r) => {
              const max = Math.max(s.p.lastSpent, s.p.thisSpent);
              return (
                <div class="pace-row" key={r.k}>
                  <span>{r.k}</span>
                  <div class="track">
                    <div class={r.cls} style={{ width: `${Math.max(8, (r.v / max) * 100)}%` }}>
                      <span class="num">{money(r.v, def, { whole: true })}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {s.p.pct !== null && (
            <p class="pace-msg">
              <b class={s.p.pct > 0.05 ? 'over' : s.p.pct < -0.05 ? 'pos' : ''}>
                {s.p.pct > 0 ? '+' : ''}
                {Math.round(s.p.pct * 100)}%
              </b>{' '}
              vs the same days last month
              {s.p.pct > 0.05 && driverCat && s.p.driver && (
                <>
                  {' '}
                  · mostly {driverCat.name} (+{money(s.p.driver.delta, def, { whole: true })})
                </>
              )}
            </p>
          )}
        </section>
      )}

      {s.budget && (
        <button class="card budget-card" onClick={() => { insightsView.set({ mode: 'month', month }); goTab('insights'); }}>
          <div class="label">
            Budgets
            <span class="num">
              {money(s.budget.spent, def, { whole: true })} of {money(s.budget.limit, def, { whole: true })}
            </span>
          </div>
          <Meter value={s.budget.spent} max={s.budget.limit} over={s.budget.spent > s.budget.limit} />
          <p class="small">
            {s.budget.over.length === 0
              ? 'Every budgeted category is within its limit.'
              : `Over: ${s.budget.over
                  .slice(0, 2)
                  .map((r) => `${refs.catById.get(r.categoryId)?.name} +${money(r.amount - (r.budget ?? 0), def, { whole: true })}`)
                  .join(', ')}${s.budget.over.length > 2 ? ` +${s.budget.over.length - 2} more` : ''}`}
          </p>
        </button>
      )}

      {isCurrent && (s.claims.count > 0 || s.due) && (
        <div class="tiles">
          {s.claims.count > 0 && (
            <button class="tile wait" onClick={() => goTab('claims')}>
              <span>Claims pending</span>
              <b class="num">{money(s.claims.total, def)}</b>
              <small>
                {s.claims.count} {s.claims.count === 1 ? 'entry' : 'entries'} · cutoff {shortDate(cycle.to)}
                {refs.settings.claimReminder && daysLeft >= 0 && daysLeft <= 5 ? ` · ${daysLeft === 0 ? 'today' : `${daysLeft}d left`}` : ''}
              </small>
            </button>
          )}
          {s.due && (
            <button class="tile brand" onClick={() => openOverlay('recurring')}>
              <span>{s.due.date < now ? 'Overdue' : `Due ${shortDate(s.due.date)}`}</span>
              <b class="num">{money(s.due.total, def)}</b>
              <small>
                {s.due.count} recurring {s.due.count === 1 ? 'bill' : 'bills'}
              </small>
            </button>
          )}
        </div>
      )}

      {isCurrent && <DueConfirmCard />}

      {isCurrent && s.activeTrip && (
        <button class="card trip-now" onClick={() => openOverlay('trip', { id: s.activeTrip!.id })}>
          <span class="av">
            <Icon name="flight" />
          </span>
          <span class="mid">
            <span class="label">On a trip now</span>
            <span class="t1">{s.activeTrip.name}</span>
          </span>
          <Icon name="right" class="muted" />
        </button>
      )}

      <section class="card list">
        <div class="label list-head">
          {isCurrent ? 'Recent' : 'Latest in month'}
          {s.count > 0 && (
            <button class="btn text" onClick={() => { entriesView.set({ month, filter: 'all', categoryId: null }); goTab('entries'); }}>
              See all {s.count}
            </button>
          )}
        </div>
        {s.recent.length === 0 ? (
          <p class="small muted" style={{ padding: '4px 0 14px' }}>
            No entries this month yet.
          </p>
        ) : (
          s.recent.map((e) => <EntryRow key={e.id} e={e} refs={refs} showDate onClick={() => openOverlay('entry', { id: e.id })} />)
        )}
      </section>
    </main>
  );
}
