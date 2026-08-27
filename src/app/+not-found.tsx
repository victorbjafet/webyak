import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function NotFoundScreen() {
  const theme = useTheme();
  const pathname = usePathname();

  return (
    <Screen title="Not found">
      <ThemedText type="body" themeColor="textSecondary">
        Nothing is routed at <ThemedText type="code">{pathname}</ThemedText>.
      </ThemedText>
      <Link href="/" asChild>
        <Pressable
          accessibilityRole="link"
          style={({ hovered, pressed }) => [
            styles.button,
            { backgroundColor: theme.brand },
            (hovered || pressed) && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.onBrand }}>
            Back to home
          </ThemedText>
        </Pressable>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
  },
  pressed: {
    opacity: 0.85,
  },
});
