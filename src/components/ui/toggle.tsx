import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A labelled on/off row.
 *
 * Rendered as a single Pressable with the whole row as the hit target rather
 * than a switch plus a separate label — the label is the bigger target and
 * users aim at it.
 */
export function Toggle({
  label,
  hint,
  icon,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ hovered, pressed }) => [
        styles.row,
        {
          backgroundColor: value ? theme.brandMuted : theme.control,
          borderColor: value ? theme.brand : 'transparent',
        },
        !disabled && (hovered || pressed) ? { opacity: 0.85 } : null,
        disabled && styles.disabled,
      ]}>
      {icon ? (
        <Ionicons name={icon} size={16} color={value ? theme.brand : theme.textSecondary} />
      ) : null}

      <View style={styles.text}>
        <ThemedText type="smallBold" style={{ color: value ? theme.brand : theme.controlText }}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="caption" themeColor="textTertiary">
            {hint}
          </ThemedText>
        ) : null}
      </View>

      <Ionicons
        name={value ? 'checkmark-circle' : 'ellipse-outline'}
        size={18}
        color={value ? theme.brand : theme.textTertiary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  disabled: {
    opacity: 0.45,
  },
});
