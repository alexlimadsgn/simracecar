// Gera os ícones PNG do PWA sem dependências: um carrinho low poly em fundo escuro.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = b => { let c = ~0; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const t = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(t));
  return Buffer.concat([len, t, c]);
}
const inPoly = (x, y, p) => {
  let r = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r;
  return r;
};
const shapes = [
  [[255, 42, 104], [[.14, .62], [.14, .48], [.3, .45], [.4, .3], [.66, .3], [.76, .45], [.86, .48], [.86, .62]]],
  [[47, 224, 232], [[.35, .45], [.43, .34], [.51, .34], [.51, .45]]],
  [[47, 224, 232], [[.55, .45], [.55, .34], [.64, .34], [.71, .45]]],
];
function icon(size, scale, file) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const u = ((x + .5) / size - .5) / scale + .5, v = ((y + .5) / size - .5) / scale + .5;
      let c = v > .68 ? [36, 80, 104] : [18, 34, 46];
      for (const [col, p] of shapes) if (inPoly(u, v, p)) c = col;
      for (const wx of [.3, .7]) {
        const d = Math.hypot(u - wx, v - .63);
        if (d < .085) c = d < .035 ? [190, 196, 200] : [12, 14, 16];
      }
      raw.set([...c, 255], row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
mkdirSync('public', { recursive: true });
icon(192, 1, 'public/icon-192.png');
icon(512, 1, 'public/icon-512.png');
icon(512, .72, 'public/icon-maskable.png');
