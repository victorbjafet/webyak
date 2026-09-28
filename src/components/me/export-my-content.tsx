import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '../ui/button';

import { myContentQuery } from '@/api/queries';
import { APP_VERSION } from '@/constants/version';
import { saveFile } from '@/lib/save-file';
import { showToast, toastError } from '@/lib/toast';

/**
 * Downloads your own posts and comments as one JSON file, fresh from the
 * server (§5, "Export my posts/comments to JSON").
 *
 * Distinct from the archive export in Settings: that is everything this
 * browser has ever seen, as NDJSON; this is only what's yours, as the API
 * returns it now, including anonymous posts, which the list is keyed on the
 * account for. The file is a plain download; nothing leaves the browser.
 */
export function ExportMyContentButton() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);

  const exportAll = async () => {
    setBusy(true);
    try {
      const [posts, comments] = await Promise.all([
        client.fetchQuery({ ...myContentQuery('posts'), staleTime: 0 }),
        client.fetchQuery({ ...myContentQuery('comments'), staleTime: 0 }),
      ]);
      const file = {
        exported_at: new Date().toISOString(),
        app_version: APP_VERSION,
        posts,
        comments,
      };
      const date = new Date().toISOString().slice(0, 10);
      await saveFile(
        new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
        `webyak-my-content-${date}.json`,
      );
      showToast(`Saved ${posts.length} posts and ${comments.length} comments.`);
    } catch (error) {
      toastError(error, "Your posts couldn't be exported.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      label="Export my posts and comments"
      variant="secondary"
      loading={busy}
      onPress={() => void exportAll()}
    />
  );
}
