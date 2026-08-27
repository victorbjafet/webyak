import { useLocalSearchParams } from 'expo-router';

import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';

export default function PostDetailScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();

  return (
    <Screen title="Post">
      <PhasePlaceholder
        phase="Phase 3"
        title="Post detail and comments"
        description="The post plus its nested comment tree from getPostComments. Blocked on index_code to post_id resolution for cold loads — see docs/API.md."
        params={{ code }}
      />
    </Screen>
  );
}
