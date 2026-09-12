/**
 * Picking a file, native side — not implemented.
 *
 * Would need `expo-document-picker`, and the archive it feeds is web-only
 * anyway (`src/lib/archive/store.ts`). Same decision as the image picker.
 */
export async function pickFile(_accept: string): Promise<File | null> {
  return null;
}
