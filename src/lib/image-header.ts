/**
 * Read image type and pixel size from the file header — enough for cheap pre-checks without an
 * image library. Supports JPEG, PNG, WebP and GIF.
 */
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

export function readImageInfo(buf: Buffer): ImageInfo | null {
  if (buf.length < 24) return null;
  // PNG: 8-byte signature, IHDR width/height at 16/20
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF8", little-endian logical screen size at 6/8
  if (buf.toString('ascii', 0, 4) === 'GIF8') {
    return { mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP: "RIFF....WEBP" + VP8 / VP8L / VP8X chunk
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && buf.length >= 30) {
      return {
        mime: 'image/webp',
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { mime: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && buf.length >= 30) {
      return {
        mime: 'image/webp',
        width: buf.readUIntLE(24, 3) + 1,
        height: buf.readUIntLE(27, 3) + 1,
      };
    }
    return null;
  }
  // JPEG: walk segments to the first SOFn marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1] ?? 0;
      const len = buf.readUInt16BE(i + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof)
        return {
          mime: 'image/jpeg',
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
        };
      i += 2 + len;
    }
  }
  return null;
}

/** Cheap checks before any model sees the image. */
export const IMAGE_LIMITS = { maxBytes: 4 * 1024 * 1024, minShortSide: 320 } as const;

export function precheckImage(
  buf: Buffer,
): { ok: true; info: ImageInfo } | { ok: false; reason: string } {
  if (buf.length > IMAGE_LIMITS.maxBytes) return { ok: false, reason: 'File is larger than 4 MB' };
  const info = readImageInfo(buf);
  if (!info) return { ok: false, reason: 'Not a supported image (JPEG, PNG, WebP, GIF)' };
  if (Math.min(info.width, info.height) < IMAGE_LIMITS.minShortSide) {
    return {
      ok: false,
      reason: `Image is too small (${info.width}×${info.height}); please send a closer, larger photo`,
    };
  }
  return { ok: true, info };
}
