import { useMemo } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { MonthSwitcher } from '../ui/MonthSwitcher';
import { Meter, NetChart, SpendCalendar } from '../ui/charts';
import { useAllEntries, useRefs } from '../lib/refs';
import { useLive } from '../lib/useLive';
import { createStore } from '../lib/store';
import { fmtDay, monthLabel, monthOf, today } from '../lib/dates';
import { amountOnly, money } from '../lib/money';
import { averages, categoryBreakdown, contextSplit, dailySpend, insightsFor, monthSeries, topSubcategories } from '../lib/insights';
import { inMonth, totals } from '../lib/stats';
import { goTab, openOverlay } from '../lib/nav';
import { db } from '../db/db';
import { entriesView } from './Entries';

export const insightsView = createStore<{ mode: 'months' | 'month'; month: string }>({
  mode: 'months',
  month: monthOf(today()),
});

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function Insights() {
  const view = insightsView.use();
  return (
    <main class="screen">
      <header class="appbar">
        <h1>Insights</h1>
        {view.mode === 'month' && <MonthSwitcher month={view.month} onChange={(month) => insightsView.set({ ...view, month })} />}
      </header>
      <div class="seg" role="group" aria-label="View">
        <button aria-pressed={view.mode === 'months'} onClick={() => insightsView.set({ ...view, mode: 'months' })}>
          All months
        </button>
        <button aria-pressed={view.mode === 'month'} onClick={() => insightsView.set({ ...view, mode: 'month' })}>
          {monthLabel(view.month, 'short')}
        </button>
      </div>
      {view.mode === 'months' ? <MonthsView /> : <MonthView month={view.month} />}
    </main>
  );
}

function MonthsView() {
  const refs = useRefs();
  const all = useAllEntries();
  const view = insightsView.use();
  const now = today();
  const series = useMemo(() => (all ? monthSeries(all, now) : []), [all]);
  const avg = useMemo(() => averages(series), [series]);
  const tripTotals = useMemo(() => {
    const m = new Map<string, { total: number; pending: number; count: number }>();
    for (const e of all ?? []) {
      if (!e.tripId) continue;
      const r = m.get(e.tripId) ?? { total: 0, pending: 0, count: 0 };
      if (e.type === 'expense') r.total += e.base;
      if (e.claimStatus === 'pending') r.pending++;
      r.count++;
      m.set(e.tripId, r);
    }
    return m;
  }, [all]);

  if (!refs || !all) return null;
  const def = refs.settings.defaultCurrency;
  if (!series.length)
    return (
      <div class="empty">
        <Icon name="chart" />
        <b>Nothing to chart yet</b>
        <span>Insights appear once you log some entries.</span>
      </div>
    );

  const sel = series.find((p) => p.month === view.month) ?? series[series.length - 1];
  const open = (month: string) => insightsView.set({ mode: 'month', month });

  return (
    <>
      <section class="card">
        <div class="label">Net by month</div>
        <NetChart series={series} selected={sel.month} onSelect={(month) => insightsView.set({ ...view, month })} />
        <div class="chart-readout">
          <div>
            <b>{monthLabel(sel.month)}</b>
            {sel.partial && <span class="muted"> · {sel.month === monthOf(now) ? 'in progress' : 'partial data'}</span>}
            <div class="num small">
              In {money(sel.income, def)} · Out {money(sel.expense, def)} ·{' '}
              <b class={sel.net >= 0 ? 'pos' : 'over'}>{money(sel.net, def, { sign: true })}</b>
            </div>
          </div>
          <button class="btn text" onClick={() => open(sel.month)}>
            Details
          </button>
        </div>
      </section>

      {avg && (
        <div class="stat3">
          <div>
            <span>Avg income</span>
            <b class="num">{money(avg.income, def, { whole: true })}</b>
          </div>
          <div>
            <span>Avg spend</span>
            <b class="num">{money(avg.expense, def, { whole: true })}</b>
          </div>
          <div>
            <span>Saved</span>
            <b class={avg.savingsRate !== null && avg.savingsRate >= 0 ? 'num pos' : 'num over'}>
              {avg.savingsRate === null ? '—' : pct(avg.savingsRate)}
            </b>
          </div>
        </div>
      )}
      {avg && (
        <p class="small muted">
          Positive in {avg.positive} of {avg.months} full {avg.months === 1 ? 'month' : 'months'}. Months marked * are
          incomplete and left out of averages.
        </p>
      )}

      <section class="card list">
        <div class="table-head" aria-hidden="true">
          <span>Month</span>
          <span>In</span>
          <span>Out</span>
          <span>Net</span>
        </div>
        {[...series].reverse().map((p) => (
          <button key={p.month} class="table-row num" onClick={() => open(p.month)}>
            <span>
              {monthLabel(p.month, 'short')}
              {p.partial ? '*' : ''}
            </span>
            <span>{amountOnly(p.income, { whole: true })}</span>
            <span>{amountOnly(p.expense, { whole: true })}</span>
            <span class={p.net >= 0 ? 'pos' : 'over'}>{amountOnly(p.net, { whole: true, sign: true })}</span>
          </button>
        ))}
      </section>

      <div class="label list-head">
        Trips
        <button class="btn text" onClick={() => openOverlay('trips')}>
          {refs.trips.length ? `All ${refs.trips.length}` : 'Add trip'}
        </button>
      </div>
      {refs.trips.length > 0 && (
        <section class="card list">
          {refs.trips.slice(0, 4).map((t) => {
            const s = tripTotals.get(t.id);
            return (
              <button key={t.id} class="row" onClick={() => openOverlay('trip', { id: t.id })}>
                <span class="av">
                  <Icon name="flight" size={20} />
                </span>
                <span class="mid">
                  <span class="t1">{t.name}</span>
                  <span class="t2">
                    {fmtDay(t.start)}
                    {t.end && t.end !== t.start ? ` – ${fmtDay(t.end, { year: true })}` : ` ${t.start.slice(0, 4)}`}
                    {s?.pending ? <span class="pill wait">{s.pending} pending</span> : null}
                  </span>
                </span>
                <span class="amt">{money(s?.total ?? 0, def, { whole: true })}</span>
              </button>
            );
          })}
        </section>
      )}

      <div class="label">Planning</div>
      <div class="link-grid">
        <button class="card link-card" onClick={() => openOverlay('budgets')}>
          <Icon name="wallet" />
          <span>Budgets</span>
        </button>
        <button class="card link-card" onClick={() => openOverlay('recurring')}>
          <Icon name="repeat" />
          <span>Recurring bills</span>
        </button>
      </div>
    </>
  );
}

function MonthView({ month }: { month: string }) {
  const refs = useRefs();
  const all = useAllEntries();
  const budgets = useLive(() => db.budgets.toArray());
  const now = today();

  const d = useMemo(() => {
    if (!all || !refs || !budgets) return null;
    return {
      t: totals(all.filter((e) => inMonth(e, month))),
      rows: categoryBreakdown(all, month, budgets),
      subs: topSubcategories(all, month, 5),
      days: dailySpend(all, month),
      split: contextSplit(all, month),
      notes: insightsFor(all, refs.catById, month, now, refs.settings.defaultCurrency),
    };
  }, [all, refs, budgets, month]);

  if (!refs || !d) return null;
  const def = refs.settings.defaultCurrency;
  const max = Math.max(1, ...d.rows.map((r) => Math.max(r.amount, r.budget ?? 0)));
  const running = month === monthOf(now);
  const budgeted = d.rows.filter((r) => r.budget);
  const budgetTotal = budgeted.reduce((s, r) => s + (r.budget ?? 0), 0);
  const budgetSpent = budgeted.reduce((s, r) => s + r.amount, 0);

  const showCategory = (categoryId: string) => {
    entriesView.set({ month, filter: 'expense', categoryId });
    goTab('entries');
  };

  if (d.t.income === 0 && d.t.expense === 0)
    return (
      <div class="empty">
        <Icon name="chart" />
        <b>No entries in {monthLabel(month)}</b>
      </div>
    );

  return (
    <>
      <div class="stat3">
        <div>
          <span>Income</span>
          <b class="num">{money(d.t.income, def, { whole: true })}</b>
        </div>
        <div>
          <span>Spent</span>
          <b class="num">{money(d.t.expense, def, { whole: true })}</b>
        </div>
        <div>
          <span>{running ? 'Net so far' : 'Net'}</span>
          <b class={d.t.net >= 0 ? 'num pos' : 'num over'}>{money(d.t.net, def, { whole: true, sign: true })}</b>
        </div>
      </div>

      {d.notes.length > 0 && (
        <ul class="insights">
          {d.notes.map((n) => (
            <li key={n.id} class={`insight ${n.tone}`}>
              <Icon name={n.tone === 'watch' ? 'time' : n.tone === 'good' ? 'check' : 'bulb'} size={18} />
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      <section class="card list">
        <div class="label list-head">
          Where it went
          <button class="btn text" onClick={() => openOverlay('budgets')}>
            {budgeted.length ? 'Edit budgets' : 'Set budgets'}
          </button>
        </div>
        {budgeted.length > 0 && (
          <p class="small muted budget-sum num">
            Budgets: {money(budgetSpent, def, { whole: true })} of {money(budgetTotal, def, { whole: true })} used
          </p>
        )}
        {d.rows.map((r) => {
          const c = refs.catById.get(r.categoryId);
          const over = r.budget !== null && r.amount > r.budget;
          return (
            <button key={r.categoryId} class="cat-row" onClick={() => showCategory(r.categoryId)}>
              <span class="av" aria-hidden="true">
                {c?.emoji}
              </span>
              <span class="mid">
                <span class="cat-row-top">
                  <span class="t1">{c?.name ?? 'Other'}</span>
                  <span class="amt num">{money(r.amount, def)}</span>
                </span>
                <Meter value={r.amount} max={r.budget ?? max} over={over} />
                <span class="t2 num">
                  {r.count} {r.count === 1 ? 'entry' : 'entries'}
                  {r.budget !== null
                    ? over
                      ? ` · over budget by ${money(r.amount - r.budget, def, { whole: true })}`
                      : ` · ${money(r.budget - r.amount, def, { whole: true })} left of ${money(r.budget, def, { whole: true })}`
                    : r.avg3 > 0
                      ? ` · 3-mo avg ${money(r.avg3, def, { whole: true })}`
                      : ''}
                </span>
              </span>
            </button>
          );
        })}
      </section>

      <section class="card">
        <div class="label">Personal vs work</div>
        <div class="split num">
          <div>
            <span>Personal</span>
            <b>{money(d.split.personal, def)}</b>
          </div>
          <div>
            <span>Work</span>
            <b>{money(d.split.work, def)}</b>
            {d.split.claimable > 0 && <small>{money(d.split.claimable, def)} claimable</small>}
          </div>
        </div>
      </section>

      {d.subs.length > 0 && (
        <section class="card list">
          <div class="label list-head">Top subcategories</div>
          {d.subs.map((s) => {
            const c = refs.catById.get(s.categoryId);
            return (
              <div key={`${s.categoryId}|${s.subId}`} class="row">
                <span class="av" aria-hidden="true">
                  {c?.emoji}
                </span>
                <span class="mid">
                  <span class="t1">{c?.subs.find((x) => x.id === s.subId)?.name ?? c?.name}</span>
                  <span class="t2">
                    {s.count}× · avg {money(s.amount / s.count, def)}
                  </span>
                </span>
                <span class="amt num">{money(s.amount, def)}</span>
              </div>
            );
          })}
        </section>
      )}

      <section class="card">
        <div class="label">Daily spending</div>
        <SpendCalendar month={month} days={d.days} currency={def} />
      </section>
    </>
  );
}
