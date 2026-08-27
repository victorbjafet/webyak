import { useLocalSearchParams } from 'expo-router';

import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';

export default function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Screen title="Thread">
      <PhasePlaceholder
        phase="Phase 6"
        title="DM thread"
        description="Message list and composer, backed by getDMThread and sendDM. Sending needs the persisted device id from the session."
        params={{ id }}
      />
    </Screen>
  );
}
