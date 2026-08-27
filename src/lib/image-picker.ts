/**
 * Image attachment, native side.
 *
 * ⛔ **Not implemented on native.** Picking a photo needs `expo-image-picker`,
 * which isn't a dependency yet, and adding one that can't be exercised here —
 * this is a web-first build deployed to GitHub Pages, with no native build in
 * the loop — would mean shipping an untested native path and calling it done.
 *
 * The web implementation in `image-picker.web.ts` is complete. The compose
 * screen checks `canPickImages` and hides the attach control rather than
 * offering a button that does nothing.
 *
 * To finish this: `npx expo install expo-image-picker`, then return the picked
 * asset's `uri`, `mimeType`, `width` and `height` — the shape below is already
 * what `uploadAsset` needs. Tracked in PLAN.md Phase 4.
 */

export interface PickedImage {
  /** Web: the File itself. Native: whatever the platform upload path takes. */
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  /** Local URL for the preview thumbnail, released by `releaseImage`. */
  previewUrl: string;
}

export async function pickImage(): Promise<PickedImage | null> {
  return null;
}

export function releaseImage(_picked: PickedImage | null) {}

/** Whether the attach control should render at all. */
export const canPickImages = false;
