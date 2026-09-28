import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the system asks for reduced motion: *Reduce motion* on iOS and
 * Android, `prefers-reduced-motion` in a browser (react-native-web reads the
 * media query). Scrolls that would animate jump instead when it's on
 * (docs/DESIGN.md#reduced-motion). Short fades are left alone: they don't move
 * anything across the screen.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return reduced;
}
