import { useEffect, useRef, useState } from 'preact/hooks';
import { createStore } from '../lib/store';
import { closeOverlay, openOverlay } from '../lib/nav';

/* ---------- Toast ---------- */
type ToastState = { id: number; text: string; action?: { label: string; run: () => void } } | null;

const toastStore = createStore<ToastState>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;

export function toast(text: string, action?: { label: string; run: () => void }, opts: { sticky?: boolean } = {}) {
  clearTimeout(toastTimer);
  toastStore.set({ id: ++toastSeq, text, action });
  if (!opts.sticky) toastTimer = setTimeout(() => toastStore.set(null), action ? 6000 : 2800);
}

export function ToastHost() {
  const t = toastStore.use();
  if (!t) return null;
  return (
    <div class={t.action ? 'toast' : 'toast solo'} role="status" key={t.id}>
      <span>{t.text}</span>
      {t.action && (
        <button
          class="btn text"
          onClick={() => {
            t.action!.run();
            toastStore.set(null);
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

/* ---------- Confirm dialog (an overlay, so Android back cancels it) ---------- */
export type ConfirmOpts = {
  title: string;
  body?: string;
  confirm?: string;
  danger?: boolean;
  /** Optional checkbox, e.g. "Also log the reimbursement" */
  option?: { label: string; checked: boolean };
};
export type ConfirmResult = { ok: boolean; checked: boolean };

let seq = 0;
const resolvers = new Map<number, (r: ConfirmResult) => void>();

export function confirmWithOption(opts: ConfirmOpts): Promise<ConfirmResult> {
  const id = ++seq;
  return new Promise((resolve) => {
    resolvers.set(id, resolve);
    openOverlay('confirm', { id, ...opts });
  });
}

export async function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return (await confirmWithOption(opts)).ok;
}

export function ConfirmDialog(props: ConfirmOpts & { id: number }) {
  const [checked, setChecked] = useState(props.option?.checked ?? false);
  const checkedRef = useRef(checked);
  checkedRef.current = checked;

  const answer = async (ok: boolean) => {
    const r = resolvers.get(props.id);
    if (!r) return; // already answered (double tap)
    resolvers.delete(props.id);
    const checked = checkedRef.current;
    // Let the dialog finish closing before the caller navigates again.
    await closeOverlay();
    r({ ok, checked });
  };

  // Dismissed by back gesture → counts as Cancel.
  useEffect(
    () => () => {
      const r = resolvers.get(props.id);
      resolvers.delete(props.id);
      r?.({ ok: false, checked: checkedRef.current });
    },
    [],
  );

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && answer(false)}>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby={`dlg-${props.id}`}>
        <h2 id={`dlg-${props.id}`}>{props.title}</h2>
        {props.body && <p>{props.body}</p>}
        {props.option && (
          <label class="check-row dialog-option">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} />
            <span>{props.option.label}</span>
          </label>
        )}
        <div class="actions">
          <button class="btn text" onClick={() => answer(false)}>
            Cancel
          </button>
          <button class={props.danger ? 'btn text danger' : 'btn text'} onClick={() => answer(true)} autoFocus>
            {props.confirm ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
