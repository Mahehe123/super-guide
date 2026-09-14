// Generates Hiyo's app icons from one SVG mark: a white 日 ("hi", sun/day) on hi-iro red.
// Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const RED = '#B3302B';
const out = 'public/icons';
mkdirSync(out, { recursive: true });

/** `pad` = fraction of the canvas kept clear around the glyph (maskable icons need ~20%). */
function svg({ size, radius, pad }) {
  const inner = size * (1 - pad * 2);
  const w = inner * 0.6; // glyph width
  const h = inner * 0.76; // glyph height
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  const s = inner * 0.115; // stroke
  // 日 as solid bars: two sides, top, middle, bottom — square-ish joins so it never reads as "0"
  const bar = (bx, by, bw, bh) => `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${s * 0.18}" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${RED}"/>
  ${bar(x, y, s, h)}${bar(x + w - s, y, s, h)}
  ${bar(x, y, w, s)}${bar(x, y + h / 2 - s / 2, w, s)}${bar(x, y + h - s, w, s)}
</svg>`;
}

const jobs = [
  { name: 'icon-192.png', size: 192, radius: 42, pad: 0.12 },
  { name: 'icon-512.png', size: 512, radius: 112, pad: 0.12 },
  { name: 'maskable-512.png', size: 512, radius: 0, pad: 0.22 },
  { name: 'apple-touch-icon.png', size: 180, radius: 0, pad: 0.14 },
  { name: 'shortcut-add-96.png', size: 96, radius: 48, pad: 0.12, add: true },
];

for (const j of jobs) {
  let s = svg(j);
  if (j.add) {
    s = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="${RED}"/><path d="M44 26h8v18h18v8H52v18h-8V52H26v-8h18z" fill="#fff"/></svg>`;
  }
  await sharp(Buffer.from(s)).png().toFile(`${out}/${j.name}`);
}
writeFileSync(`${out}/icon.svg`, svg({ size: 512, radius: 112, pad: 0.12 }));
console.log('icons written to', out);
