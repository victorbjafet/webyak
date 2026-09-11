/**
 * Saving a file, native side — not implemented.
 *
 * Would need `expo-file-system` plus a share sheet, and there is no native build
 * in the loop to exercise it. The settings screen shows the archive as
 * unavailable on native anyway, since the archive itself is web-only
 * (`src/lib/archive/store.ts`).
 */
export async function saveFile(_blob: Blob, _filename: string): Promise<boolean> {
  return false;
}
