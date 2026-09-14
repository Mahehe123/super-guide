import { useMemo, useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { EntryRow, SwipeToDelete } from '../ui/EntryRow';
import { MonthSwitcher } from '../ui/MonthSwitcher';
import { toast } from '../ui/feedback';
import { entryTitle, subName, useAllEntries, useRefs, type Refs } from '../lib/refs';
import { createStore } from '../lib/store';
import { fmtDay, monthOf, toDateStr, today } from '../lib/dates';
import { money } from '../lib/money';
import { totals } from '../lib/stats';
import { deleteEntries } from '../lib/entries';
import { openOverlay } from '../lib/nav';
import type { Entry } from '../db/types';

/** Shared so Home/Insights can jump to a month or category. */
export const entriesView = createStore<{ month: string; filter: Filter; categoryId: string | null }>({
  month: monthOf(today()),
  filter: 'all',
  categoryId: null,
});

type Filter = 'all' | 'expense' | 'income' | 'work' | 'pending' | 'receipt' | 'trip';

const FILTERS: { id: Filter; label: string; test: (e: Entry) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'expense', label: 'Expense', test: (e) => e.type === 'expense' },
  { id: 'income', label: 'Income', test: (e) => e.type === 'income' },
  { id: 'work', label: 'Work', test: (e) => e.context === 'work' },
  { id: 'pending', label: 'Claim pending', test: (e) => e.claimStatus === 'pending' },
  { id: 'receipt', label: 'Has receipt', test: (e) => e.receiptIds.length > 0 },
  { id: 'trip', label: 'On a trip', test: (e) => !!e.tripId },
];

function matches(refs: Refs, e: Entry, q: string): boolean {
  const cat = refs.catById.get(e.categoryId);
  const hay = [
    entryTitle(refs, e),
    cat?.name,
    subName(refs, e),
    e.note,
    ...e.tags,
    e.tripId ? refs.tripById.get(e.tripId)?.name : '',
    e.amount.toFixed(2),
    e.currency,
  ]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function dayLabel(date: string) {
  const t = today();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const prefix = date === t ? 'Today · ' : date === toDateStr(y) ? 'Yesterday · ' : '';
  return prefix + fmtDay(date, { weekday: true });
}

export function Entries() {
  const refs = useRefs();
  const all = useAllEntries();
  const view = entriesView.use();
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  const list = useMemo(() => {
    if (!all || !refs) return [];
    const f = FILTERS.find((x) => x.id === view.filter)!;
    return all.filter(
      (e) =>
        (searching ? matches(refs, e, query) : e.date.startsWith(view.month)) &&
        f.test(e) &&
        (!view.categoryId || e.categoryId === view.categoryId),
    );
  }, [all, refs, view, query]);

  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of list) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [list]);

  const sum = totals(list);
  const set = (p: Partial<typeof view>) => entriesView.set({ ...view, ...p });

  async function remove(e: Entry) {
    const undo = await deleteEntries([e.id]);
    toast(`Deleted ${refs ? entryTitle(refs, e) : 'entry'}`, { label: 'Undo', run: undo });
  }

  return (
    <main class="screen">
      <header class="appbar">
        <h1>Entries</h1>
        {!searching && <MonthSwitcher month={view.month} onChange={(month) => set({ month })} />}
      </header>

      <label class="search">
        <Icon name="search" />
        <span class="sr-only">Search</span>
        <input
          id="entries-search"
          type="search"
          placeholder="Search notes, tags, amounts"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        {searching && (
          <button class="iconbtn sm" aria-label="Clear search" onClick={() => setQuery('')}>
            <Icon name="close" />
          </button>
        )}
      </label>

      <div class="chips scroll" role="group" aria-label="Filter">
        {view.categoryId && refs && (
          <button class="chip" aria-pressed="true" onClick={() => set({ categoryId: null })}>
            {refs.catById.get(view.categoryId)?.emoji} {refs.catById.get(view.categoryId)?.name}
            <Icon name="close" />
          </button>
        )}
        {FILTERS.map((f) => (
          <button key={f.id} class="chip" aria-pressed={view.filter === f.id} onClick={() => set({ filter: f.id })}>
            {f.label}
          </button>
        ))}
      </div>

      {refs && all && list.length > 0 && (
        <p class="summary-line num">
          {list.length} {list.length === 1 ? 'entry' : 'entries'}
          {searching ? ' across all months' : ''} · <span>Spent {money(sum.expense, refs.settings.defaultCurrency)}</span>
          {sum.income > 0 && (
            <>
              {' '}
              · <span class="pos">In {money(sum.income, refs.settings.defaultCurrency)}</span>
            </>
          )}
        </p>
      )}

      {refs && all && list.length === 0 && (
        <div class="empty">
          <Icon name={searching ? 'search' : 'list'} />
          <b>{searching ? 'No matches' : all.length ? 'Nothing here this month' : 'No entries yet'}</b>
          <span>{searching ? 'Try a different word or amount.' : 'Tap Add to log an expense or income.'}</span>
        </div>
      )}

      {refs &&
        groups.map(([date, rows]) => {
          const t = totals(rows);
          return (
            <section key={date} class="day-group">
              <h3 class="day-head">
                <span>{searching ? fmtDay(date, { weekday: true, year: true }) : dayLabel(date)}</span>
                <span class={t.net > 0 ? 'num pos' : 'num'}>{money(t.net, refs.settings.defaultCurrency, { sign: true })}</span>
              </h3>
              <div class="card list">
                {rows.map((e) => (
                  <SwipeToDelete key={e.id} onDelete={() => remove(e)}>
                    <EntryRow e={e} refs={refs} onClick={() => openOverlay('entry', { id: e.id })} />
                  </SwipeToDelete>
                ))}
              </div>
            </section>
          );
        })}
    </main>
  );
}
