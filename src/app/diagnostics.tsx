import * as Clipboard from 'expo-clipboard';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  runAllProbes,
  runWriteProbes,
  type ProbeResult,
  type ProbeStatus,
} from '@/api/diagnostics';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
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
  const [confirmingWrites, setConfirmingWrites] = useState(false);

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

  const runWrites = useCallback(async () => {
    setConfirmingWrites(false);
    setBusy(true);
    setCopied(false);
    try {
      setResults(await runWriteProbes());
    } finally {
      setBusy(false);
    }
  }, []);

  const copy = useCallback(async () => {
    if (!results) return;
    const report = results
      .map((r) =>
        [
          `## ${r.label} — ${STATUS_LABEL[r.status]}`,
          r.question,
          r.detail,
          r.evidence ? `\n\`\`\`\n${r.evidence}\n\`\`\`` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
    await Clipboard.setStringAsync(report);
    setCopied(true);
  }, [results]);

  return (
    <Screen title="Diagnostics" subtitle="Answers the open blockers against the live API">
      <View
        style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Read-only probes. They settle the two Phase 3 blockers and the image question — see
          docs/API.md. Run this once after signing in, then paste the report back.
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
        <ThemedText type="bodyBold">Phase 4 — write probes</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          These are not read-only. They create a real post, a real comment and a real poll in the
          sample community, vote on them, then delete them. Nothing should survive the run — if a
          probe reports a leftover id, that content is live and needs deleting by hand.
        </ThemedText>
        <View style={styles.actions}>
          <Button
            label="Run write probes"
            variant="danger"
            onPress={() => setConfirmingWrites(true)}
            disabled={busy}
          />
        </View>
      </View>

      <ConfirmDialog
        visible={confirmingWrites}
        title="Post to a real community?"
        body="This creates a post, a comment and a poll in the sample group and then deletes them. They will be briefly visible to other people."
        confirmLabel="Run writes"
        destructive
        onCancel={() => setConfirmingWrites(false)}
        onConfirm={runWrites}
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
