import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { Entry } from '../db/types';
import { entryTitle, subName, type Refs } from '../lib/refs';
import { money } from '../lib/money';
import { fmtDay } from '../lib/dates';
import { Icon } from './Icon';

const num2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Home currency: "−10.00". Foreign: "−THB 200.00" with "RM 26.00" underneath. */
function fmtAmount(e: Entry, def: string) {
  const sign = e.type === 'income' ? '+' : '−';
  if (e.currency === def) return { main: `${sign}${num2.format(e.amount)}`, sub: null };
  return { main: `${sign}${e.currency} ${num2.format(e.amount)}`, sub: money(e.base, def) };
}

export function EntryRow({
  e,
  refs,
  showDate,
  onClick,
  selected,
  noAvatar,
  compact,
  hideTrip,
}: {
  e: Entry;
  refs: Refs;
  showDate?: boolean;
  onClick?: () => void;
  selected?: boolean;
  /** Avatar rendered outside by the caller (e.g. a select toggle) */
  noAvatar?: boolean;
  /** Hide work/claim pills (already implied by the screen) */
  compact?: boolean;
  hideTrip?: boolean;
}) {
  const cat = refs.catById.get(e.categoryId);
  const title = entryTitle(refs, e);
  const secondary = e.note ? [cat?.name, subName(refs, e)].filter(Boolean).join(' · ') : cat?.name;
  const trip = e.tripId && !hideTrip ? refs.tripById.get(e.tripId) : undefined;
  const amt = fmtAmount(e, refs.settings.defaultCurrency);

  return (
    <button type="button" class={selected ? 'row entry sel' : 'row entry'} onClick={onClick}>
      {!noAvatar && (
        <span class="av" aria-hidden="true">
          {cat?.emoji ?? '•'}
        </span>
      )}
      <span class="mid">
        <span class="t1">{title}</span>
        <span class="t2">
          {showDate && <span>{fmtDay(e.date)} ·</span>}
          <span>{secondary}</span>
          {!compact && e.context === 'work' && <span class="pill work">Work</span>}
          {!compact && e.claimStatus === 'pending' && <span class="pill wait">Pending</span>}
          {!compact && e.claimStatus === 'settled' && <span class="pill ok">Settled</span>}
          {trip && (
            <span class="pill tag trip">
              <Icon name="flight" size={11} /> {trip.name}
            </span>
          )}
          {e.tags.slice(0, 2).map((t) => (
            <span class="pill tag" key={t}>
              {t}
            </span>
          ))}
          {e.receiptIds.length > 0 && <Icon name="attach" size={14} class="muted" />}
        </span>
      </span>
      <span class={e.type === 'income' ? 'amt pos' : 'amt'}>
        {amt.main}
        {amt.sub && <small>{amt.sub}</small>}
      </span>
    </button>
  );
}

/** Swipe left past 40% to delete. Vertical scrolling is left alone. */
export function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: ComponentChildren }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; swiping: boolean; id: number } | null>(null);
  const width = useRef(1);

  return (
    <div
      class="swipe"
      onPointerDown={(ev) => {
        if (ev.pointerType === 'mouse') return;
        start.current = { x: ev.clientX, y: ev.clientY, swiping: false, id: ev.pointerId };
        width.current = (ev.currentTarget as HTMLElement).offsetWidth;
      }}
      onPointerMove={(ev) => {
        const s = start.current;
        if (!s) return;
        const mx = ev.clientX - s.x;
        const my = ev.clientY - s.y;
        if (!s.swiping) {
          if (Math.abs(my) > 10) return void (start.current = null);
          if (mx < -12) {
            s.swiping = true;
            try {
              (ev.currentTarget as HTMLElement).setPointerCapture(s.id);
            } catch {
              /* pointer already released */
            }
          } else return;
        }
        setDx(Math.min(0, mx));
      }}
      onPointerUp={() => {
        const s = start.current;
        start.current = null;
        if (s?.swiping && dx < -width.current * 0.4) onDelete();
        setDx(0);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
      onClickCapture={(ev) => {
        if (dx !== 0) ev.stopPropagation();
      }}
    >
      <div class="swipe-bg" aria-hidden="true" style={{ opacity: Math.min(1, -dx / 80) }}>
        <Icon name="delete" /> Delete
      </div>
      <div class="swipe-fg" style={{ transform: dx ? `translateX(${dx}px)` : undefined }}>
        {children}
      </div>
    </div>
  );
}
