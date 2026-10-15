// Reads image dimensions and video durations straight from file headers, so the build needs
// no image libraries. Supports WebP, JPEG (with EXIF rotation), PNG, GIF and AVIF images and
// MP4/MOV videos.

import fs from 'node:fs';

function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** EXIF orientation (1–8) from a JPEG APP1 segment, or 1. */
function exifOrientation(buf, start, length) {
  if (buf.toString('latin1', start, start + 6) !== 'Exif\0\0') return 1;
  const tiff = start + 6;
  const little = buf.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = (at) => (little ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at) => (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > start + length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) break;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}

/** Returns { width, height } as the browser displays the image, or null if the format is unknown. */
export function imageSize(file) {
  const buf = readHead(file, 256 * 1024);
  const ascii = (a, b) => buf.toString('latin1', a, b);

  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const chunk = ascii(12, 16);
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.subarray(21, 25);
      return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    return null;
  }
  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (ascii(0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    let orientation = 1;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { i += 2; continue; }
      const length = buf.readUInt16BE(i + 2);
      if (marker === 0xe1) orientation = exifOrientation(buf, i + 4, length - 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return orientation >= 5 ? { width: height, height: width } : { width, height };
      }
      i += 2 + length;
    }
    return null;
  }
  if (ascii(4, 8) === 'ftyp' && /avif|avis|mif1/.test(ascii(8, 32))) {
    const at = buf.indexOf('ispe');
    if (at > 0) return { width: buf.readUInt32BE(at + 8), height: buf.readUInt32BE(at + 12) };
  }
  return null;
}

/** Duration of an MP4/MOV file in seconds (from the moov/mvhd box), or null. */
export function videoDuration(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(16);
    const read = (at, length) => {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, at);
      return buf;
    };
    const boxes = (from, to, fn) => {
      let at = from;
      while (at + 8 <= to) {
        fs.readSync(fd, head, 0, 16, at);
        let length = head.readUInt32BE(0);
        const type = head.toString('latin1', 4, 8);
        let headerLength = 8;
        if (length === 1) { length = Number(head.readBigUInt64BE(8)); headerLength = 16; }
        if (length === 0) length = to - at;
        if (length < headerLength) return null;
        const result = fn(type, at + headerLength, at + length);
        if (result != null) return result;
        at += length;
      }
      return null;
    };
    return boxes(0, size, (type, start, end) => {
      if (type !== 'moov') return null;
      return boxes(start, end, (inner, s) => {
        if (inner !== 'mvhd') return null;
        const box = read(s, 32);
        if (box[0] === 1) return Number(box.readBigUInt64BE(24)) / box.readUInt32BE(20);
        return box.readUInt32BE(16) / box.readUInt32BE(12);
      });
    });
  } finally {
    fs.closeSync(fd);
  }
}
