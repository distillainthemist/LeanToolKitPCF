// Image ingest, shared by the issues dialog and the canvas card's image
// field: downscale-on-ingest (long edge cap, JPEG re-encode) and
// file→data-URI. Data URIs, not object URLs — the Power Apps player's
// CSP blocks blob: images while data: renders fine (issues, 2026-08-12).

export interface ShrinkOptions {
  /** Re-encode only files larger than this (bytes). Default 1.5MB —
   *  small files pass through untouched (text screenshots keep their
   *  crisp PNG). */
  threshold?: number;
  /** Long-edge cap in pixels. Default 1600. */
  maxEdge?: number;
  /** JPEG quality. Default 0.85. */
  quality?: number;
}

/** Downscale an image file; returns the original when it's already small,
 *  when re-encoding doesn't help, or when the image can't be decoded. */
export async function shrinkImage(file: File, opts: ShrinkOptions = {}): Promise<File> {
  const threshold = opts.threshold ?? 1_500_000;
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.85;
  if (file.size <= threshold) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (blob === null || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
    });
  } catch {
    return file; // an undecodable image still travels as-is
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
