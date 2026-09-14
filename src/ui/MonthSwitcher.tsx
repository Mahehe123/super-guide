import type { MonthStr } from '../db/types';
import { addMonths, monthLabel, monthOf, today } from '../lib/dates';
import { Icon } from './Icon';

export function MonthSwitcher({ month, onChange }: { month: MonthStr; onChange: (m: MonthStr) => void }) {
  const isCurrent = month >= monthOf(today());
  return (
    <div class="monthsw" role="group" aria-label="Month">
      <button class="iconbtn sm" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))}>
        <Icon name="left" />
      </button>
      <span class="num">{monthLabel(month, 'short')}</span>
      <button
        class="iconbtn sm"
        aria-label="Next month"
        disabled={isCurrent}
        onClick={() => onChange(addMonths(month, 1))}
      >
        <Icon name="right" />
      </button>
    </div>
  );
}
