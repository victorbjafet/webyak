import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { useKarma } from '@/api/queries';
import { useSession } from '@/api/session';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type KarmaMark, readKarmaMark, writeKarmaMark } from '@/lib/karma-seen';
import { formatCount, relativeTime } from '@/lib/time';

/**
 * How your karma moved since Alerts was last open: the owner's B4, "new
 * upvotes since last open".
 *
 * Read from the karma totals in `getUpdates()`, which the You tab already
 * fetches, rather than added up from `votes` alerts. An alert only says a
 * threshold was crossed, and the previous threshold for the same post may be
 * on a page that isn't loaded, so a sum of alerts could overcount. The totals
 * are exact, and cost no extra request.
 *
 * The mark is saved once per visit, after a fresh read, so the next visit
 * compares against what this one saw.
 */
function useKarmaSinceLastVisit() {
  const { userId } = useSession();
  const karma = useKarma();
  const [before, setBefore] = useState<KarmaMark | null | undefined>(undefined);
  const saved = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void readKarmaMark(userId).then((mark) => {
      if (!cancelled) setBefore(mark);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const post = karma.data?.post;
  const comment = karma.data?.comment;
  const known = typeof post === 'number' && typeof comment === 'number';

  useEffect(() => {
    // Waits for the stored mark and for a read that isn't in flight, so a
    // stale cached total is never saved as the new mark.
    if (!userId || before === undefined || !known || karma.isFetching || saved.current) return;
    saved.current = true;
    void writeKarmaMark(userId, { post, comment, at: new Date().toISOString() });
  }, [userId, before, known, karma.isFetching, post, comment]);

  if (!before || !known) return null;
  return { post: post - before.post, comment: comment - before.comment, since: before.at };
}

function signed(n: number) {
  return n < 0 ? `−${formatCount(-n)}` : `+${formatCount(n)}`;
}

function lastVisit(iso: string) {
  const ago = relativeTime(iso);
  return ago === 'now' ? 'last visit just now' : `last visit ${ago} ago`;
}

/** The card at the top of Alerts. Nothing on a first visit, or when nothing moved. */
export function KarmaSince() {
  const theme = useTheme();
  const since = useKarmaSinceLastVisit();
  if (!since || (since.post === 0 && since.comment === 0)) return null;

  const total = since.post + since.comment;
  const parts = [
    since.post ? `${signed(since.post)} on posts` : null,
    since.comment ? `${signed(since.comment)} on comments` : null,
  ].filter(Boolean);

  return (
    <View
      accessibilityRole="summary"
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={[styles.icon, { backgroundColor: theme.brandMuted }]}>
        <Ionicons
          name={total >= 0 ? 'trending-up-outline' : 'trending-down-outline'}
          size={18}
          color={theme.brand}
        />
      </View>
      <View style={styles.text}>
        <ThemedText type="smallBold">{`${signed(total)} karma since you last looked`}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {[...parts, lastVisit(since.since)].join(' · ')}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.two,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
});
