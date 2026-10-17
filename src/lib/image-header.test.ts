import { describe, expect, it } from 'vitest';
import { precheckImage, readImageInfo } from './image-header';

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function jpeg(w: number, h: number): Buffer {
  // SOI, APP0 (len 16), SOF0 (len 17)
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 0xff,
    w >> 8,
    w & 0xff,
    0x03,
    ...new Array<number>(9).fill(0),
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

describe('readImageInfo', () => {
  it('reads PNG and JPEG dimensions from the header', () => {
    expect(readImageInfo(png(1600, 1200))).toEqual({
      mime: 'image/png',
      width: 1600,
      height: 1200,
    });
    expect(readImageInfo(jpeg(1280, 960))).toEqual({
      mime: 'image/jpeg',
      width: 1280,
      height: 960,
    });
  });

  it('rejects non-images', () => {
    expect(readImageInfo(Buffer.from('this is not an image at all, honestly'))).toBeNull();
  });
});

describe('precheckImage', () => {
  it('accepts a normal photo and rejects tiny or oversized files', () => {
    expect(precheckImage(png(1600, 1200)).ok).toBe(true);
    const small = precheckImage(png(200, 150));
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.reason).toContain('too small');
    expect(precheckImage(Buffer.alloc(5 * 1024 * 1024))).toMatchObject({
      ok: false,
      reason: 'File is larger than 4 MB',
    });
  });
});
