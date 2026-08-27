/**
 * Image attachment, native side — **deliberately not implemented**.
 *
 * Decided 2026-08-27: attachments are a web feature. This app ships to GitHub
 * Pages and there is no native build in the loop, so a native picker could not
 * be tested even if it were written. Not a gap to close later unless the app is
 * actually ported.
 *
 * The file still exists so the native bundle compiles, and so the decision is
 * written down where someone would look for the missing implementation rather
 * than only in a plan file. `canPickImages` is false here, and the compose
 * screen hides the attach control instead of offering a dead button.
 *
 * If the port ever happens: `npx expo install expo-image-picker`, then return
 * the picked asset's `uri`, `mimeType`, `width` and `height` — the shape below
 * is already what the upload path needs.
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
export const canPickImages: boolean = false;
