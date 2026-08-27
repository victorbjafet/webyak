import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * False during the web static prerender and on the very first client render,
 * true afterwards.
 *
 * Anything that depends on the real viewport (or on any browser API) must render
 * its pre-hydration fallback until this flips, or the client output won't match
 * the prerendered HTML and React will warn about a hydration mismatch.
 *
 * Implemented with `useSyncExternalStore` rather than `useState` + `useEffect`
 * because React reads the server snapshot during hydration and the client one
 * after, which is exactly the signal we want — and it avoids the cascading
 * render that a synchronous `setState` in an effect causes.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
