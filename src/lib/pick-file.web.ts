/**
 * Opens the file picker and returns the chosen file as a Blob.
 *
 * Same `cancel`-event approach as `image-picker.web.ts`, and for the same reason
 * recorded there: inferring cancellation from window focus races the dialog and
 * resolves before the user has chosen.
 *
 * The file is handed back as a Blob rather than read, so callers can stream it —
 * an archive export runs to tens of megabytes and should never be turned into a
 * string just to be parsed.
 */
export async function pickFile(accept: string): Promise<File | null> {
  if (typeof document === 'undefined') return null;

  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
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
}
