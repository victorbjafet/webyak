/**
 * Saves a Blob to disk.
 *
 * Same mechanism as `download-button.web.tsx`: the `download` attribute only
 * works on a same-origin URL, so the bytes go through an object URL on our own
 * origin. Revoked afterwards — an un-revoked object URL pins the whole blob in
 * memory for the life of the tab, which for an archive export is the entire
 * corpus.
 */
export async function saveFile(blob: Blob, filename: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    // A tick, so the click is dispatched before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
