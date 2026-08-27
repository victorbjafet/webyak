import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '../themed-text';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: theme.brand, fg: theme.onBrand },
    secondary: { bg: theme.control, fg: theme.controlText },
    ghost: { bg: 'transparent', fg: theme.textSecondary, border: theme.borderStrong },
    danger: { bg: theme.danger, fg: '#FFFFFF' },
  };
  const { bg, fg, border } = palette[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.base,
        { backgroundColor: bg },
        border ? { borderWidth: StyleSheet.hairlineWidth, borderColor: border } : null,
        fullWidth && styles.fullWidth,
        (hovered || pressed) && !inactive && styles.active,
        inactive && styles.inactive,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? <ActivityIndicator size="small" color={fg} /> : null}
        <ThemedText type="smallBold" style={{ color: fg }}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  active: {
    opacity: 0.85,
  },
  inactive: {
    opacity: 0.45,
  },
});
