import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { confirmDialog, toast } from '../ui/feedback';
import { db, uid } from '../db/db';
import type { Category, EntryType } from '../db/types';
import { useAllEntries, useRefs } from '../lib/refs';
import { closeOverlay, openOverlay } from '../lib/nav';

const EMOJI = [
  '🍜', '☕', '🍱', '🛒', '🏠', '💡', '🚗', '⛽', '🚌', '✈️', '🏨', '🛍️', '👕', '💊', '🏥', '💈', '🎬', '🎮', '🎁', '📚',
  '🏸', '🏓', '⚽', '🐶', '👶', '💻', '📱', '📋', '🧾', '🏦', '💳', '💰', '📈', '💼', '🎓', '⛪', '❤️', '🧹', '🔧', '📦',
];

async function usage(categoryId: string) {
  return db.entries.where('categoryId').equals(categoryId).count();
}

export function CategoriesSheet() {
  const refs = useRefs();
  const all = useAllEntries();
  const [type, setType] = useState<EntryType>('expense');
  if (!refs || !all) return <Sheet title="Categories" icon="back">{null}</Sheet>;

  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
  const list = refs.categories.filter((c) => c.type === type).sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.order - b.order);
  const active = list.filter((c) => !c.archived);

  async function move(c: Category, dir: -1 | 1) {
    const i = active.indexOf(c);
    const j = i + dir;
    if (j < 0 || j >= active.length) return;
    const order = [...active];
    [order[i], order[j]] = [order[j], order[i]];
    await db.transaction('rw', db.categories, async () => {
      for (let k = 0; k < order.length; k++) await db.categories.update(order[k].id, { order: k });
    });
  }

  return (
    <Sheet
      title="Categories"
      icon="back"
      actions={
        <button class="iconbtn" aria-label="New category" onClick={() => openOverlay('category-edit', { type })}>
          <Icon name="add" />
        </button>
      }
    >
      <div class="seg" role="group" aria-label="Type">
        <button aria-pressed={type === 'expense'} onClick={() => setType('expense')}>
          Expense
        </button>
        <button aria-pressed={type === 'income'} onClick={() => setType('income')}>
          Income
        </button>
      </div>
      <p class="small muted">The order here is the order on the Add screen.</p>
      <section class="card list">
        {list.map((c) => {
          const i = active.indexOf(c);
          return (
            <div key={c.id} class={c.archived ? 'row archived' : 'row'}>
              <button class="row-main" onClick={() => openOverlay('category-edit', { id: c.id })}>
                <span class="av" aria-hidden="true">
                  {c.emoji}
                </span>
                <span class="mid">
                  <span class="t1">{c.name}</span>
                  <span class="t2">
                    {c.archived ? 'Archived · ' : ''}
                    {c.subs.filter((s) => !s.archived).length} subcategories · {counts.get(c.id) ?? 0} entries
                  </span>
                </span>
              </button>
              {!c.archived && (
                <span class="reorder">
                  <button class="iconbtn sm" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(c, -1)}>
                    <Icon name="up" />
                  </button>
                  <button class="iconbtn sm" aria-label={`Move ${c.name} down`} disabled={i === active.length - 1} onClick={() => move(c, 1)}>
                    <Icon name="down" />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </section>
    </Sheet>
  );
}

export function CategoryForm({ id, type: newType }: { id?: string; type?: EntryType }) {
  const refs = useRefs();
  const [cat, setCat] = useState<Category | null>(null);
  const [newSub, setNewSub] = useState('');
  const [used, setUsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (id) {
        const c = await db.categories.get(id);
        if (!c) return closeOverlay();
        setCat(structuredClone(c));
        setUsed(await usage(id));
      } else {
        const count = await db.categories.where('type').equals(newType ?? 'expense').count();
        setCat({ id: `cat-${uid()}`, type: newType ?? 'expense', name: '', emoji: '📦', order: count, subs: [] });
      }
    })();
  }, [id]);

  if (!refs || !cat) return <Sheet title={id ? 'Edit category' : 'New category'}>{null}</Sheet>;
  const set = (p: Partial<Category>) => setCat({ ...cat, ...p });
  const subs = cat.subs;

  function addSub() {
    const name = newSub.trim();
    if (!name) return;
    if (subs.some((s) => s.name.toLowerCase() === name.toLowerCase() && !s.archived)) return setError(`“${name}” already exists.`);
    const archived = subs.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (archived) set({ subs: subs.map((s) => (s === archived ? { ...s, archived: false } : s)) });
    else set({ subs: [...subs, { id: `${cat!.id}-${uid().slice(-6)}`, name }] });
    setNewSub('');
    setError(null);
  }

  function moveSub(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= subs.length) return;
    const next = [...subs];
    [next[i], next[j]] = [next[j], next[i]];
    set({ subs: next });
  }

  async function save() {
    const name = cat!.name.trim();
    if (!name) return setError('Give the category a name.');
    const clash = refs!.categories.find((c) => c.id !== cat!.id && c.type === cat!.type && !c.archived && c.name.toLowerCase() === name.toLowerCase());
    if (clash) return setError(`There’s already a ${cat!.type} category called “${clash.name}”.`);
    if (subs.some((s) => !s.name.trim())) return setError('Subcategory names can’t be empty.');
    await db.categories.put({ ...cat!, name, subs: subs.map((s) => ({ ...s, name: s.name.trim() })) });
    closeOverlay();
    toast(id ? 'Category saved' : 'Category added');
  }

  async function archiveOrDelete() {
    if (used > 0) {
      const ok = await confirmDialog({
        title: cat!.archived ? `Restore “${cat!.name}”?` : `Archive “${cat!.name}”?`,
        body: cat!.archived
          ? 'It shows on the Add screen again.'
          : `It has ${used} entries, so it can’t be deleted. Archiving hides it from the Add screen; history keeps it.`,
        confirm: cat!.archived ? 'Restore' : 'Archive',
      });
      if (!ok) return;
      await db.categories.update(cat!.id, { archived: !cat!.archived });
      closeOverlay();
      toast(cat!.archived ? 'Category restored' : 'Category archived');
      return;
    }
    const ok = await confirmDialog({ title: `Delete “${cat!.name}”?`, body: 'It has no entries.', confirm: 'Delete', danger: true });
    if (!ok) return;
    await db.transaction('rw', db.categories, db.budgets, db.recurring, async () => {
      if (await db.recurring.filter((r) => r.categoryId === cat!.id).count()) throw new Error('in use');
      await db.categories.delete(cat!.id);
      await db.budgets.delete(cat!.id);
    }).then(
      () => {
        closeOverlay();
        toast('Category deleted');
      },
      () => toast('A recurring bill uses this category. Change or delete that bill first.'),
    );
  }

  return (
    <Sheet
      title={id ? 'Edit category' : 'New category'}
      actions={
        id && (
          <button class="iconbtn" aria-label={used ? (cat.archived ? 'Restore category' : 'Archive category') : 'Delete category'} onClick={archiveOrDelete}>
            <Icon name={used ? (cat.archived ? 'restore' : 'archive') : 'delete'} />
          </button>
        )
      }
    >
      <div class="cat-head">
        <span class="cat-ic big" aria-hidden="true">
          {cat.emoji}
        </span>
        <label class="field grow">
          <span>Name</span>
          <input id="cat-name" value={cat.name} placeholder="e.g. Pets" onInput={(e) => set({ name: e.currentTarget.value })} autoFocus={!id} />
        </label>
      </div>

      <div class="label">Icon</div>
      <div class="emoji-grid" role="radiogroup" aria-label="Icon">
        {EMOJI.map((e) => (
          <button key={e} role="radio" aria-checked={cat.emoji === e} class="emoji" onClick={() => set({ emoji: e })}>
            {e}
          </button>
        ))}
      </div>
      <label class="field">
        <span>Or type any emoji</span>
        <input id="cat-emoji" value={cat.emoji} maxLength={4} onInput={(e) => e.currentTarget.value && set({ emoji: e.currentTarget.value })} />
      </label>

      <div class="label">Subcategories</div>
      <section class="card list">
        {subs.length === 0 && <p class="small muted" style={{ padding: '12px 0' }}>None yet.</p>}
        {subs.map((s, i) => (
          <div key={s.id} class={s.archived ? 'row sub-row archived' : 'row sub-row'}>
            <label class="grow">
              <span class="sr-only">Subcategory name</span>
              <input
                id={`sub-${s.id}`}
                class="plain-input"
                value={s.name}
                onInput={(e) => set({ subs: subs.map((x) => (x.id === s.id ? { ...x, name: e.currentTarget.value } : x)) })}
              />
            </label>
            <button class="iconbtn sm" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => moveSub(i, -1)}>
              <Icon name="up" />
            </button>
            <button
              class="iconbtn sm"
              aria-label={s.archived ? `Restore ${s.name}` : `Archive ${s.name}`}
              onClick={() => set({ subs: subs.map((x) => (x.id === s.id ? { ...x, archived: !x.archived } : x)) })}
            >
              <Icon name={s.archived ? 'restore' : 'archive'} />
            </button>
          </div>
        ))}
        <div class="row sub-row">
          <label class="grow">
            <span class="sr-only">New subcategory</span>
            <input
              id="sub-new"
              class="plain-input"
              value={newSub}
              placeholder="Add subcategory"
              onInput={(e) => setNewSub(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSub()}
            />
          </label>
          <button class="btn tonal" onClick={addSub} disabled={!newSub.trim()}>
            Add
          </button>
        </div>
      </section>
      <p class="small muted">Archived subcategories stay on past entries but aren’t offered for new ones. Renaming updates past entries too.</p>

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <button class="btn primary block" onClick={save}>
        {id ? 'Save category' : 'Add category'}
      </button>
    </Sheet>
  );
}
