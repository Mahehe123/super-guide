import { useEffect, useState } from 'preact/hooks';

/** Minimal observable value with a Preact hook. */
export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      subs.forEach((f) => f());
    },
    use(): T {
      const [, force] = useState(0);
      useEffect(() => {
        const f = () => force((n) => n + 1);
        subs.add(f);
        return () => void subs.delete(f);
      }, []);
      return value;
    },
  };
}
