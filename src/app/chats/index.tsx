import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';

export default function ChatsScreen() {
  return (
    <Screen title="Chats">
      <PhasePlaceholder
        phase="Phase 6"
        title="Direct messages"
        description="Thread list with unread state, backed by getDMs. Group chat discovery needs the patched getGroupChats URL."
      />
    </Screen>
  );
}
