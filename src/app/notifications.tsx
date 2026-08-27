import { PhasePlaceholder } from '@/components/phase-placeholder';
import { Screen } from '@/components/screen';

export default function NotificationsScreen() {
  return (
    <Screen title="Alerts">
      <PhasePlaceholder
        phase="Phase 8"
        title="Activity feed"
        description="sidechat.js exposes readActivity but has no method to list activity. The endpoint has to be found first — see the gap list in PLAN.md."
      />
    </Screen>
  );
}
