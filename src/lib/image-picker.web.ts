import type { PickedImage } from './image-picker';

export type { PickedImage };

/** What the API accepts — `uploadAssetWeb` rejects anything else. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif'];

/**
 * Opens the browser's file picker and measures the chosen image.
 *
 * The dimensions have to be read here: `createPost` wants `width`/`height` on
 * each attached asset, and the upload endpoint returns neither — it only hands
 * back an id. Getting them wrong renders the post at the wrong aspect ratio
 * until a refetch, so they are measured from the decoded bitmap rather than
 * guessed.
 *
 * Cancellation is detected with the input's own `cancel` event. An earlier
 * version inferred it from `window.focus` returning with no file selected,
 * which raced against the dialog: the focus handler fired first, resolved
 * `null`, and removed the input — so the later `change` event landed on a
 * detached element and picking a file did nothing at all.
 */
export async function pickImage(): Promise<PickedImage | null> {
  if (typeof document === 'undefined') return null;

  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED.join(',');
    input.style.display = 'none';

    let settled = false;
    const finish = (value: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });

    document.body.append(input);
    input.click();
  });

  if (!file) return null;
  if (!ACCEPTED.includes(file.type)) {
    throw new Error('Pick a JPEG, PNG or GIF — those are the only formats the API takes.');
  }

  const previewUrl = URL.createObjectURL(file);
  try {
    const { width, height } = await measure(previewUrl);
    return { blob: file, mimeType: file.type, width, height, previewUrl };
  } catch {
    URL.revokeObjectURL(previewUrl);
    throw new Error("That image couldn't be read.");
  }
}

function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

export function releaseImage(picked: PickedImage | null) {
  if (picked?.previewUrl) URL.revokeObjectURL(picked.previewUrl);
}

/** Whether the attach control should render at all. */
export const canPickImages: boolean = true;
