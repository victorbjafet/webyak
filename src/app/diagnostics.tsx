import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  runAllProbes,
  runLengthProbes,
  runUploadProbe,
  SAMPLE_GROUP_ID,
  type ProbeResult,
  type ProbeStatus,
} from '@/api/diagnostics';
import { groupDisplayName, isForYouFeed } from '@/api/groups';
import { useSession } from '@/api/session';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { APP_VERSION } from '@/constants/version';
import { useTheme } from '@/hooks/use-theme';

const STATUS_LABEL: Record<ProbeStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  partial: 'PARTIAL',
  error: 'ERROR',
};

export default function DiagnosticsScreen() {
  const theme = useTheme();
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingUpload, setConfirmingWrites] = useState(false);
  const [confirmingLengths, setConfirmingLengths] = useState(false);
  const { userId, primaryGroup } = useSession();
  // Your own community when the session knows it: posting where you are not a
  // member would be refused for that, and read as a length limit.
  const home = primaryGroup && !isForYouFeed(primaryGroup) ? primaryGroup : null;
  const lengthGroupId = home?.id ?? SAMPLE_GROUP_ID;
  const lengthGroupName = home ? groupDisplayName(home) : 'Virginia Tech';

  const statusColor: Record<ProbeStatus, string> = {
    pass: theme.success,
    fail: theme.danger,
    partial: theme.textSecondary,
    error: theme.danger,
  };

  const run = useCallback(async () => {
    setBusy(true);
    setCopied(false);
    try {
      setResults(await runAllProbes());
    } finally {
      setBusy(false);
    }
  }, []);

  const runUploadProbeNow = useCallback(async () => {
    setConfirmingWrites(false);
    setBusy(true);
    setCopied(false);
    try {
      setResults(await runUploadProbe());
    } finally {
      setBusy(false);
    }
  }, []);

  const runLengthProbesNow = useCallback(async () => {
    setConfirmingLengths(false);
    setBusy(true);
    setCopied(false);
    try {
      setResults(await runLengthProbes(lengthGroupId, userId));
    } finally {
      setBusy(false);
    }
  }, [lengthGroupId, userId]);

  const copy = useCallback(async () => {
    if (!results) return;
    // Headed with the version, so a pasted report says which build produced it.
    const report = [
      `webyak ${APP_VERSION}`,
      ...results.map((r) =>
        [
          `## ${r.label} — ${STATUS_LABEL[r.status]}`,
          r.question,
          r.detail,
          r.evidence ? `\n\`\`\`\n${r.evidence}\n\`\`\`` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    ].join('\n\n');
    await Clipboard.setStringAsync(report);
    setCopied(true);
  }, [results]);

  return (
    <Screen title="Diagnostics" subtitle="Open questions, asked against the live API">
      <View
        style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Read-only. Seven probes, each on a question that is still open: share-code resolution
          (Blocker 1), the chat message types, what your alerts carry, video thumbnails, whatever
          failed to render this page load, and where your bio lives. Settled questions were
          retired — their answers are in docs/API.md.
        </ThemedText>
        <ThemedText type="caption" themeColor="textTertiary">
          Two probes read what happened earlier in this page load. For images, browse a feed and
          a profile first. For alerts, open Alerts and mark something read — tap an unread one,
          or Mark all read. Then run this and paste the report back.
        </ThemedText>
        <View style={styles.actions}>
          <Button label={results ? 'Run again' : 'Run probes'} onPress={run} loading={busy} />
          {results ? (
            <Button
              label={copied ? 'Copied' : 'Copy report'}
              variant="secondary"
              onPress={copy}
            />
          ) : null}
        </View>
      </View>

      <View
        style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="bodyBold">Image upload</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Separated because it isn&rsquo;t read-only: it asks the API for an upload URL and tries a
          1×1 PNG against it. Nothing is posted and nothing becomes visible to anyone. The
          write round-trip probes that did post were retired once writing was verified against
          the official app.
        </ThemedText>
        <View style={styles.actions}>
          <Button
            label="Run upload probe"
            variant="secondary"
            onPress={() => setConfirmingWrites(true)}
            disabled={busy}
          />
        </View>
      </View>

      <View
        style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="bodyBold">Length limits</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Writes, and undoes them. Posts anonymous test posts of 257, 300 and 301 characters to{' '}
          {lengthGroupName}, deleting each within seconds, then sets your bio to 151, 200 and 201
          characters and puts the original back. Settles whether webyak&rsquo;s 300 and 150 match
          what the server enforces.
        </ThemedText>
        <View style={styles.actions}>
          <Button
            label="Run length probes"
            variant="secondary"
            onPress={() => setConfirmingLengths(true)}
            disabled={busy}
          />
        </View>
      </View>

      <ConfirmDialog
        visible={confirmingLengths}
        title="Post and edit your bio to test limits?"
        body={`This posts up to three anonymous test posts to ${lengthGroupName} — each deleted within seconds, but visible until then — and briefly changes your public bio before restoring it. If your current bio can't be read with certainty, the bio half is skipped.`}
        confirmLabel="Run them"
        onCancel={() => setConfirmingLengths(false)}
        onConfirm={runLengthProbesNow}
      />

      <ConfirmDialog
        visible={confirmingUpload}
        title="Run the upload probe?"
        body="This requests an upload URL and PUTs a 1×1 PNG to it. Nothing is posted and nobody else sees anything — it's separated only because it isn't a plain read."
        confirmLabel="Run it"
        onCancel={() => setConfirmingWrites(false)}
        onConfirm={runUploadProbeNow}
      />

      {results?.map((r) => (
        <View
          key={r.id}
          style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.headRow}>
            <ThemedText type="bodyBold" style={styles.headLabel}>
              {r.label}
            </ThemedText>
            <View style={[styles.badge, { backgroundColor: theme.control }]}>
              <ThemedText type="caption" style={{ color: statusColor[r.status] }}>
                {STATUS_LABEL[r.status]}
              </ThemedText>
            </View>
          </View>

          <ThemedText type="caption" themeColor="textTertiary">
            {r.question}
          </ThemedText>
          <ThemedText type="small">{r.detail}</ThemedText>

          {r.evidence ? (
            <View style={[styles.evidence, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <ThemedText type="code" themeColor="textSecondary">
                {r.evidence}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headLabel: {
    flex: 1,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.sm,
  },
  evidence: {
    marginTop: Spacing.one,
    padding: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
