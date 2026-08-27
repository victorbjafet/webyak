import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';

export default function ExploreScreen() {
  return (
    <Screen title="Explore" subtitle="Find communities">
      <PhasePlaceholder
        phase="Phase 5"
        title="Group discovery"
        description="Group grid with icons and member counts, search, and join/leave. Backed by getAvailableGroups and searchAvailableGroups."
      />
    </Screen>
  );
}
