import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';
import { closeOverlay } from '../lib/nav';

/** Full-screen page that slides over the tabs. Back (gesture or button) closes it. */
export function Sheet({
  title,
  actions,
  children,
  icon = 'close',
}: {
  title: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
  icon?: 'close' | 'back';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div class="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <div class="screen">
        <header class="appbar">
          <button class="iconbtn" onClick={closeOverlay} aria-label={icon === 'close' ? 'Close' : 'Back'}>
            <Icon name={icon} />
          </button>
          <h2>{title}</h2>
          {actions}
        </header>
        {children}
      </div>
    </div>
  );
}
