import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, pixels) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4);
  const bg = [12, 18, 20, 255];
  const teal = [45, 212, 191, 255];
  const deep = [15, 118, 110, 255];
  const cx = size / 2;
  const cy = size / 2;
  const margin = maskable ? size * 0.16 : size * 0.08;
  const radius = size / 2 - margin;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      pixels[i] = bg[0]; pixels[i + 1] = bg[1]; pixels[i + 2] = bg[2]; pixels[i + 3] = 255;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const ring = Math.abs(d - radius) < size * 0.025;
      const nodeA = Math.hypot(x - (cx - radius * 0.42), y - (cy - radius * 0.2)) < size * 0.075;
      const nodeB = Math.hypot(x - (cx + radius * 0.46), y - (cy + radius * 0.08)) < size * 0.075;
      const nodeC = Math.hypot(x - (cx - radius * 0.05), y - (cy + radius * 0.48)) < size * 0.06;
      const onLink = (ax, ay, bx, by) => {
        const abx = bx - ax; const aby = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)));
        const px = ax + abx * t; const py = ay + aby * t;
        return Math.hypot(x - px, y - py) < size * 0.018;
      };
      const link = onLink(cx - radius * 0.42, cy - radius * 0.2, cx + radius * 0.46, cy + radius * 0.08)
        || onLink(cx - radius * 0.42, cy - radius * 0.2, cx - radius * 0.05, cy + radius * 0.48);
      if (ring) { pixels[i] = teal[0]; pixels[i + 1] = teal[1]; pixels[i + 2] = teal[2]; }
      if (link) { pixels[i] = deep[0]; pixels[i + 1] = deep[1]; pixels[i + 2] = deep[2]; }
      if (nodeA || nodeB || nodeC) { pixels[i] = teal[0]; pixels[i + 1] = teal[1]; pixels[i + 2] = teal[2]; }
    }
  }
  return png(size, size, pixels);
}

const out = join(process.cwd(), 'public', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-512.png'), draw(512, false));
writeFileSync(join(out, 'icon-maskable-512.png'), draw(512, true));
writeFileSync(join(out, 'icon-192.png'), draw(192, false));
writeFileSync(join(out, 'apple-touch-icon.png'), draw(180, false));
console.log('wrote', out);
void dirname;
