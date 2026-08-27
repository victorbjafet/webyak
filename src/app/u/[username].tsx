import { useLocalSearchParams } from 'expo-router';

import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';

export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();

  return (
    <Screen title={username ? `@${username}` : 'Profile'}>
      <PhasePlaceholder
        phase="Phase 5"
        title="Public profile"
        description="Conversation icon, bio and that user's posts, backed by getUserProfile and getUserPosts."
        params={{ username }}
      />
    </Screen>
  );
}
