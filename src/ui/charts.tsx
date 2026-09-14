import { useState } from 'preact/hooks';
import type { MonthStr } from '../db/types';
import type { MonthPoint } from '../lib/insights';
import { monthLabel } from '../lib/dates';
import { compact, money } from '../lib/money';

/* Chart colors: validated pair (CVD ΔE 12.8). Values are always direct-labelled. */
const POS = '#3F7F6A';
const NEG = '#D08A2E';

/** Net per month, bars above/below a zero line. Tap a bar to select it. */
export function NetChart({
  series,
  selected,
  onSelect,
}: {
  series: MonthPoint[];
  selected: MonthStr | null;
  onSelect: (m: MonthStr) => void;
}) {
  const W = 340;
  const H = 210;
  const top = 22;
  const bottom = 36; // room for below-bar labels + month names
  const plotH = H - top - bottom;
  const maxUp = Math.max(0, ...series.map((p) => p.net));
  const maxDown = Math.max(0, ...series.map((p) => -p.net));
  const span = maxUp + maxDown || 1;
  const zeroY = top + (plotH * maxUp) / span;
  const slot = (W - 8) / Math.max(series.length, 1);
  const barW = Math.min(24, slot * 0.56);
  const y = (v: number) => (plotH * Math.abs(v)) / span;

  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((p) => `${monthLabel(p.month, 'short')} ${money(p.net, 'MYR', { sign: true, whole: true })}`).join(', ')}>
      <defs>
        <pattern id="hatch-pos" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#d9e8e2" />
          <rect width="2.5" height="6" fill={POS} />
        </pattern>
        <pattern id="hatch-neg" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#f7e6cf" />
          <rect width="2.5" height="6" fill={NEG} />
        </pattern>
      </defs>
      <line x1="4" x2={W - 4} y1={zeroY} y2={zeroY} stroke="var(--outline-s)" stroke-width="1" />
      {series.map((p, i) => {
        const cx = 4 + slot * i + slot / 2;
        const h = Math.max(2, y(p.net));
        const up = p.net >= 0;
        const r = Math.min(4, h / 2, barW / 2);
        const x = cx - barW / 2;
        // 4px rounded data-end, square at the zero line
        const d = up
          ? `M${x},${zeroY} V${zeroY - h + r} Q${x},${zeroY - h} ${x + r},${zeroY - h} H${x + barW - r} Q${x + barW},${zeroY - h} ${x + barW},${zeroY - h + r} V${zeroY} Z`
          : `M${x},${zeroY} V${zeroY + h - r} Q${x},${zeroY + h} ${x + r},${zeroY + h} H${x + barW - r} Q${x + barW},${zeroY + h} ${x + barW},${zeroY + h - r} V${zeroY} Z`;
        const fill = p.partial ? `url(#hatch-${up ? 'pos' : 'neg'})` : up ? POS : NEG;
        const dim = selected && selected !== p.month;
        const labelY = up ? zeroY - h - 6 : zeroY + h + 13;
        return (
          <g key={p.month} opacity={dim ? 0.45 : 1}>
            <path d={d} fill={fill} />
            {(p.income > 0 || p.expense > 0) && (
              <text x={cx} y={labelY} text-anchor="middle" class="v">
                {compact(p.net)}
              </text>
            )}
            <text x={cx} y={H - 6} text-anchor="middle" class={selected === p.month ? 'm on' : 'm'}>
              {monthLabel(p.month, 'short').slice(0, 3)}
              {p.partial ? '*' : ''}
            </text>
            <rect
              x={cx - slot / 2}
              y={0}
              width={slot}
              height={H}
              fill="transparent"
              class="hit"
              tabIndex={0}
              role="button"
              aria-label={`${monthLabel(p.month)}: net ${money(p.net, 'MYR', { sign: true })}`}
              onClick={() => onSelect(p.month)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(p.month)}
            />
          </g>
        );
      })}
    </svg>
  );
}

/* Sequential single-hue ramp (brand red), light → dark */
const RAMP = ['#f7eae7', '#f6cfc8', '#eb9a8f', '#cf5b50', '#9e2a25'];

/** Calendar of daily spending. Tap a day to read its total. */
export function SpendCalendar({
  month,
  days,
  currency,
  onPick,
}: {
  month: MonthStr;
  days: number[];
  currency: string;
  onPick?: (date: string) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [y, m] = month.split('-').map(Number);
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const nonZero = days.filter((d) => d > 0).sort((a, b) => a - b);
  const q = (p: number) => nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.8)];
  const level = (v: number) => (v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);

  return (
    <div class="calendar">
      <div class="cal-grid" role="grid" aria-label={`Daily spending, ${monthLabel(month)}`}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={`h${i}`} class="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: firstDow }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((v, i) => {
          const lv = level(v);
          return (
            <button
              key={i}
              class={picked === i ? 'cal-day on' : 'cal-day'}
              style={{ background: RAMP[lv], color: lv >= 3 ? '#fff' : 'var(--text)' }}
              aria-label={`${i + 1} ${monthLabel(month, 'short')}: ${money(v, currency)}`}
              onClick={() => setPicked(picked === i ? null : i)}
              onDblClick={() => onPick?.(`${month}-${String(i + 1).padStart(2, '0')}`)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div class="cal-foot">
        <span class="num">
          {picked !== null
            ? `${picked + 1} ${monthLabel(month, 'short').slice(0, 3)} · ${money(days[picked], currency)}`
            : 'Tap a day to see its total'}
        </span>
        <span class="cal-legend" aria-hidden="true">
          Less
          {RAMP.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

/** Single-series horizontal bar used in lists. Over-budget turns the bar amber. */
export function Meter({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span class="meter" aria-hidden="true">
      <span class={over ? 'meter-fill over' : 'meter-fill'} style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%` }} />
    </span>
  );
}
