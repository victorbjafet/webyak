import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useCurrentGroup } from '@/api/current-group';
import { groupDisplayName, isForYouFeed } from '@/api/groups';
import type { Group } from '@/api/types';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CrawlMonitor } from '@/components/settings/crawl-monitor';
import {
  startCommentCrawl,
  startCrawl,
  type CommentCrawlProgress,
  type CrawlHandle,
  type CrawlProgress,
} from '@/lib/archive/crawler';
import {
  archiveAvailable,
  clearArchive,
  exportArchive,
  getArchiveStats,
  listCrawlStates,
} from '@/lib/archive/store';
import type { ArchiveStats, CrawlState } from '@/lib/archive/types';
import { saveFile } from '@/lib/save-file';
import { formatCount } from '@/lib/time';
import { showToast, toastError } from '@/lib/toast';

function formatBytes(bytes?: number) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { groups } = useCurrentGroup();

  const [stats, setStats] = useState<ArchiveStats | null>(null);
  const [crawls, setCrawls] = useState<CrawlState[]>([]);
  const [target, setTarget] = useState<Group | null>(null);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [comments, setComments] = useState<CommentCrawlProgress | null>(null);
  const commentHandle = useRef<CrawlHandle | null>(null);
  const commentsRunning = Boolean(commentHandle.current) && !comments?.finished;

  const handle = useRef<CrawlHandle | null>(null);
  const running = Boolean(handle.current) && !stopped && !progress?.finished && !progress?.error;

  const refresh = useCallback(async () => {
    if (!archiveAvailable) return;
    try {
      const [nextStats, nextCrawls] = await Promise.all([getArchiveStats(), listCrawlStates()]);
      setStats(nextStats);
      setCrawls(nextCrawls);
    } catch (error) {
      toastError(error, "Couldn't read the archive.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A crawl outlives this screen's render cycle, so it has to be stopped when
  // the screen goes away — otherwise it keeps issuing requests against a private
  // API with nothing on screen to show for it.
  useEffect(() => {
    return () => {
      handle.current?.stop();
      commentHandle.current?.stop();
    };
  }, []);

  const beginComments = useCallback(() => {
    commentHandle.current?.stop();
    setComments({ startedAt: Date.now(), threads: 0, archived: 0, duplicates: 0, errors: 0 });
    commentHandle.current = startCommentCrawl((next) => {
      setComments(next);
      if (next.finished) void refresh();
    });
  }, [refresh]);

  const stopComments = useCallback(() => {
    commentHandle.current?.stop();
    commentHandle.current = null;
    setComments((current) => (current ? { ...current, finished: 'stopped' } : current));
    void refresh();
  }, [refresh]);

  // Crawlable communities only: For You is a combined view, not a feed with its
  // own cursor to walk.
  const crawlable = groups.filter((g) => !isForYouFeed(g));

  const begin = useCallback(
    (group: Group) => {
      handle.current?.stop();
      setTarget(group);
      setStopped(false);
      setProgress({
        phase: 'catching-up',
        run: {
          startedAt: Date.now(),
          pages: 0,
          requests: 0,
          archived: 0,
          duplicates: 0,
          withMedia: 0,
          errors: 0,
        },
        total: { pages: 0, archived: 0 },
        idlePages: 0,
        nextDelayMs: 1500,
      });
      handle.current = startCrawl(group.id, group.name, (next) => {
        setProgress(next);
        if (next.finished || next.error) void refresh();
      });
    },
    [refresh],
  );

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    // `stopped` rather than a `finished` reason: the run didn't reach an end,
    // and saying it did would misreport what was archived.
    setStopped(true);
    void refresh();
  }, [refresh]);

  const exportAll = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await exportArchive();
      const stamp = new Date().toISOString().slice(0, 10);
      const saved = await saveFile(blob, `webyak-archive-${stamp}.ndjson`);
      showToast(saved ? 'Archive exported.' : 'Export is only available on the web.', 'info');
    } catch (error) {
      toastError(error, "Couldn't export the archive.");
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <Screen title="Settings" back scroll={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ---------------------------------------------------------------- */}
        <Card>
          <ThemedText type="bodyBold">Archive</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Every post and comment this browser has seen is kept locally — text, author, timestamp
            and score — so it stays readable after Yik Yak drops it.
          </ThemedText>

          {!archiveAvailable ? (
            <ThemedText type="caption" themeColor="textTertiary">
              Only available on the web build. The archive is IndexedDB, which React Native
              doesn&rsquo;t have.
            </ThemedText>
          ) : (
            <>
              <View style={styles.statGrid}>
                <Stat label="Posts" value={formatCount(stats?.posts ?? 0)} />
                <Stat label="Comments" value={formatCount(stats?.comments ?? 0)} />
                <Stat label="Since deleted" value={formatCount(stats?.deleted ?? 0)} />
                <Stat label="With media" value={formatCount(stats?.withMedia ?? 0)} />
                <Stat label="Media saved" value={formatCount(stats?.mediaCached ?? 0)} />
              </View>

              <ThemedText type="caption" themeColor="textTertiary">
                {stats?.oldest
                  ? `Oldest ${stats.oldest.slice(0, 10)} · newest ${stats.newest?.slice(0, 10)} · `
                  : ''}
                {formatBytes(stats?.bytes)} used
                {stats?.quota ? ` of ~${formatBytes(stats.quota)} available` : ''}
              </ThemedText>

              {/*
                Media bytes aren't downloaded yet — only flagged. Posts carrying
                images or video are recorded with `media_pending`, so a later
                back-fill knows exactly what to fetch without re-walking the
                feeds. Saying so beats a "Media saved: 0" that looks broken.
              */}
              {(stats?.mediaPending ?? 0) > 0 ? (
                <ThemedText type="caption" themeColor="textTertiary">
                  {formatCount(stats?.mediaPending ?? 0)} posts have images or video that
                  haven&rsquo;t been downloaded. They&rsquo;re flagged, so they can be fetched later
                  without re-scanning anything.
                </ThemedText>
              ) : null}

              <View style={styles.actions}>
                <Button
                  label={exporting ? 'Exporting…' : 'Export archive'}
                  variant="secondary"
                  onPress={exportAll}
                  loading={exporting}
                  disabled={!stats || stats.posts + stats.comments === 0}
                />
                <Button
                  label="Clear"
                  variant="ghost"
                  onPress={() => setConfirmingClear(true)}
                  disabled={!stats || stats.posts + stats.comments === 0}
                />
              </View>
              <ThemedText type="caption" themeColor="textTertiary">
                Exports as NDJSON — one JSON object per line, so it streams and stays readable at
                any size.
              </ThemedText>
            </>
          )}
        </Card>

        {/* ---------------------------------------------------------------- */}
        {archiveAvailable ? (
          <Card>
            <ThemedText type="bodyBold">Backfill a community</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Walks a community&rsquo;s New feed backwards, archiving as it goes, until it runs out
              of posts. It resumes where it left off and skips anything already held.
            </ThemedText>
            <ThemedText type="caption" themeColor="textTertiary">
              Runs in two passes: first it catches up on anything posted since the last run, then it
              keeps digging backwards into history. The backfill resumes from a saved cursor, so it
              picks up deep in the feed rather than re-walking from the top.
            </ThemedText>
            <ThemedText type="caption" themeColor="textTertiary">
              Unproductive stretches no longer end the run — it waits longer and pushes through,
              and only gives up after a long run of genuinely no progress. Keep this screen open
              while it works; leaving stops it.
            </ThemedText>
            <ThemedText type="caption" themeColor="textTertiary">
              Paced deliberately slowly — about a page every 1.5s, with a longer wait after any
              error and a hard stop if the API rate-limits. This is a private API and a real
              account; an impatient crawler is what gets one flagged.
            </ThemedText>

            <View style={styles.groupRow}>
              {crawlable.map((group) => {
                const saved = crawls.find((c) => c.group_id === group.id);
                const selected = target?.id === group.id;
                return (
                  <Pressable
                    key={group.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    disabled={running}
                    onPress={() => begin(group)}
                    style={({ hovered }) => [
                      styles.groupChip,
                      {
                        backgroundColor: selected ? theme.brandMuted : theme.control,
                        borderColor: selected ? theme.brand : 'transparent',
                      },
                      hovered && !running ? { opacity: 0.85 } : null,
                      running && !selected ? styles.dim : null,
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: selected ? theme.brand : theme.controlText }}>
                      {groupDisplayName(group)}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textTertiary">
                      {saved
                        ? saved.tail_exhausted
                          ? `all history · ${formatCount(saved.archived)} saved`
                          : `${formatCount(saved.archived)} saved · resumable`
                        : 'not started'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {progress ? (
              <>
                <CrawlMonitor
                  progress={progress}
                  groupName={target ? groupDisplayName(target) : undefined}
                  stopped={stopped}
                />

                {progress.error ? (
                  <ThemedText type="caption" style={{ color: theme.danger }}>
                    {progress.error}
                  </ThemedText>
                ) : null}

                {stopped ? (
                  <ThemedText type="caption" themeColor="textTertiary">
                    Stopped. Progress is saved — running again resumes from here.
                  </ThemedText>
                ) : progress.finished ? (
                  <ThemedText type="caption" themeColor="textTertiary">
                    {
                      {
                        exhausted:
                          'Reached the beginning of this community’s feed. Future runs only catch up on new posts.',
                        duplicates: 'Caught up on everything posted since the last run.',
                        stalled:
                          'Gave up after a long stretch with no new posts and no movement further back, even after waiting it out. Something is off — worth trying again later, and worth looking at if it keeps happening.',
                        stopped: 'Stopped.',
                        error: 'Stopped after an error.',
                      }[progress.finished]
                    }
                  </ThemedText>
                ) : null}

                {running ? <Button label="Stop" variant="danger" onPress={stop} /> : null}
              </>
            ) : null}
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {archiveAvailable ? (
          <Card>
            <ThemedText type="bodyBold">Collect comments</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              The feed crawl archives posts only — comments come one request per thread, so they
              are a separate job. This walks archived posts that have replies and fetches each
              thread.
            </ThemedText>
            <ThemedText type="caption" themeColor="textTertiary">
              Far longer than a feed crawl: a community page yields ~24 posts per request, while a
              thread costs one request each. Posts with no replies are skipped entirely. It
              resumes on its own — a post is only cleared once its thread is stored.
            </ThemedText>

            <View style={styles.statGrid}>
              <Stat label="Threads to fetch" value={formatCount(stats?.needsComments ?? 0)} />
              <Stat label="Comments held" value={formatCount(stats?.comments ?? 0)} />
            </View>

            {comments ? (
              <View style={[styles.commentProgress, { backgroundColor: theme.background }]}>
                <ThemedText type="small">
                  {formatCount(comments.threads)} threads · {formatCount(comments.archived)} new
                  comments · {formatCount(comments.duplicates)} re-seen
                  {comments.errors > 0 ? ` · ${formatCount(comments.errors)} failed` : ''}
                </ThemedText>
                {comments.error ? (
                  <ThemedText type="caption" style={{ color: theme.danger }}>
                    {comments.error}
                  </ThemedText>
                ) : null}
                {comments.finished === 'done' ? (
                  <ThemedText type="caption" themeColor="textTertiary">
                    Every archived post with replies has had its thread collected.
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              {commentsRunning ? (
                <Button label="Stop" variant="danger" onPress={stopComments} />
              ) : (
                <Button
                  label="Collect comments"
                  variant="secondary"
                  onPress={beginComments}
                  disabled={!stats || stats.needsComments === 0 || running}
                />
              )}
            </View>
          </Card>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        <Card>
          <ThemedText type="bodyBold">Diagnostics</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Probes that answer the API questions still open — share-code resolution, chat message
            types, video thumbnails.
          </ThemedText>
          <Button
            label="Open diagnostics"
            variant="secondary"
            onPress={() => router.push('/diagnostics')}
          />
        </Card>
      </ScrollView>

      <ConfirmDialog
        visible={confirmingClear}
        title="Delete the whole archive?"
        body="Every archived post, comment and saved image goes. Yik Yak won't give them back — export first if you might want them."
        confirmLabel="Delete everything"
        destructive
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false);
          void clearArchive()
            .then(() => {
              showToast('Archive cleared.', 'info');
              return refresh();
            })
            .catch((error) => toastError(error, "Couldn't clear the archive."));
        }}
      />
    </Screen>
  );

  function Card({ children }: { children: React.ReactNode }) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        {children}
      </View>
    );
  }

  function Stat({ label, value }: { label: string; value: string }) {
    return (
      <View style={[styles.stat, { backgroundColor: theme.background }]}>
        <ThemedText type="subtitle" style={{ color: theme.brand }}>
          {value}
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          {label}
        </ThemedText>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: Layout.feedMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  stat: {
    flex: 1,
    minWidth: 110,
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  groupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  groupChip: {
    gap: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  dim: {
    opacity: 0.4,
  },
  commentProgress: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
});
