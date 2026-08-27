import { useSyncExternalStore } from 'react';

/**
 * Transient messages, mostly "that write didn't land".
 *
 * A module-level store rather than a React context on purpose: the callers are
 * mutation hooks in `src/api/mutations.ts`, which run in dozens of card
 * instances and shouldn't have to be inside a provider — or worse, have to take
 * an `onError` prop threaded down from every screen, which is exactly the
 * pattern that leaves one list silently swallowing errors.
 *
 * Same shape as `clock.ts`: one store, `useSyncExternalStore` to read it.
 */

export type ToastTone = 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Long enough to read a sentence, short enough not to sit over the feed. */
const DISMISS_AFTER = 5000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  // A new array identity each time, or useSyncExternalStore won't re-render.
  toasts = [...toasts];
  for (const listener of listeners) listener();
}

export function showToast(message: string, tone: ToastTone = 'error') {
  const id = nextId++;
  // Collapse repeats: voting on three posts while offline should say one thing,
  // not stack three identical bars.
  if (toasts.some((t) => t.message === message)) return id;

  toasts.push({ id, message, tone });
  emit();
  setTimeout(() => dismissToast(id), DISMISS_AFTER);
  return id;
}

export function dismissToast(id: number) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/**
 * Turns whatever a mutation rejected with into something worth reading. The API
 * returns real messages on `error_code` bodies (`unwrap` surfaces them), so
 * prefer those over the generic fallback.
 */
export function toastError(error: unknown, fallback: string) {
  const message = error instanceof Error && error.message ? error.message : fallback;
  showToast(message, 'error');
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toasts;
}

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
