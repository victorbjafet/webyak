import { useLocalSearchParams } from 'expo-router';

import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';

export default function GroupFeedScreen() {
  const { slug, sort } = useLocalSearchParams<{ slug: string; sort?: string }>();

  return (
    <Screen title={slug ?? 'Group'} subtitle={`sort: ${sort ?? 'hot'}`}>
      <PhasePlaceholder
        phase="Phase 3"
        title="Group feed"
        description="Hot/new/top and cursor-paginated posts from getGroupPosts. Blocked on slug to group_id resolution — see docs/API.md."
        params={{ slug, sort }}
      />
    </Screen>
  );
}
