import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Keyboard shortcuts, web only (PLAN Phase 7, §5).
 *
 * Moving between posts uses real browser focus: `j`/`k` focus the next or
 * previous post card on screen, and the global `:focus-visible` ring shows
 * which (src/global.css). Everything else acts on that card by pressing its
 * own buttons, so voting and opening go through exactly the code a click
 * does, and nothing is written unless a key is pressed for it.
 *
 * Keys are ignored while typing in a field, or with Ctrl, Alt or Cmd held.
 */
const JUMPS: Record<string, { href: string; label: string }> = {
  h: { href: '/', label: 'Home' },
  e: { href: '/explore', label: 'Explore' },
  a: { href: '/notifications', label: 'Alerts' },
  c: { href: '/chats', label: 'Chats' },
  y: { href: '/me', label: 'You' },
  s: { href: '/settings', label: 'Settings' },
};

const HELP: { keys: string; action: string }[] = [
  { keys: 'j / k', action: 'Next / previous post' },
  { keys: 'u / d', action: 'Upvote / downvote it' },
  { keys: 'o or Enter', action: 'Open it' },
  { keys: 'c', action: 'Open it and start a comment' },
  { keys: 'n', action: 'New post' },
  { keys: '/', action: 'Search' },
  ...Object.entries(JUMPS).map(([key, { label }]) => ({ keys: `g then ${key}`, action: label })),
  { keys: '?', action: 'This list' },
];

/** How long after `g` its second key still counts. */
const CHORD_MS = 1200;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Post cards currently showing: screens underneath in the stack stay mounted but hidden. */
function visibleCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-post-card]')].filter(
    (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0,
  );
}

function currentCard(cards: HTMLElement[]) {
  const active = document.activeElement as HTMLElement | null;
  return cards.find((card) => card === active || card.contains(active)) ?? null;
}

function focusCard(card: HTMLElement | undefined) {
  if (!card) return;
  card.tabIndex = -1;
  card.focus({ preventScroll: true });
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

function press(card: HTMLElement | null, label: string) {
  card?.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
}

/** Once the next screen has rendered, focus its first text box. */
function focusFieldSoon(selector: string) {
  setTimeout(() => {
    const field = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (el) => el.offsetParent !== null,
    );
    field?.focus();
  }, 400);
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const chordAt = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const key = event.key;

      if (Date.now() - chordAt.current < CHORD_MS) {
        chordAt.current = 0;
        const jump = JUMPS[key.toLowerCase()];
        if (jump) {
          event.preventDefault();
          router.push(jump.href as never);
        }
        return;
      }

      const cards = visibleCards();
      const current = currentCard(cards);
      const index = current ? cards.indexOf(current) : -1;
      // With nothing focused yet, j starts from the first card on screen.
      const firstOnScreen = () =>
        cards.find((card) => card.getBoundingClientRect().bottom > 0) ?? cards[0];

      switch (key) {
        case 'g':
          chordAt.current = Date.now();
          return;
        case '?':
          setHelpOpen((open) => !open);
          break;
        case 'j':
          focusCard(index < 0 ? firstOnScreen() : cards[Math.min(index + 1, cards.length - 1)]);
          break;
        case 'k':
          focusCard(index < 0 ? firstOnScreen() : cards[Math.max(index - 1, 0)]);
          break;
        case 'u':
          press(current, 'Upvote');
          break;
        case 'd':
          press(current, 'Downvote');
          break;
        case 'o':
          if (!current) return;
          press(current, 'Open post');
          break;
        case 'Enter':
          // Only on the card itself: Enter on a button inside it presses that button.
          if (!current || event.target !== current) return;
          press(current, 'Open post');
          break;
        case 'c':
          if (!current) return;
          press(current, 'Open post');
          focusFieldSoon('textarea');
          break;
        case 'n':
          router.push('/compose');
          break;
        case '/':
          router.push('/explore');
          focusFieldSoon('input[placeholder^="Search"]');
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return <ShortcutHelp visible={helpOpen} onClose={() => setHelpOpen(false)} />;
}

function ShortcutHelp({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close the shortcut list"
        onPress={onClose}
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <Pressable
          accessibilityViewIsModal
          onPress={() => {}}
          style={[styles.card, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
          <ThemedText type="heading">Keyboard shortcuts</ThemedText>
          {HELP.map(({ keys, action }) => (
            <View key={keys} style={styles.row}>
              <View style={[styles.keys, { backgroundColor: theme.control }]}>
                <ThemedText type="code">{keys}</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.action}>
                {action}
              </ThemedText>
            </View>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  keys: {
    minWidth: 110,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
  },
  action: {
    flex: 1,
  },
});
