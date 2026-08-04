const { chromium } = require('playwright');

// The brand mark: two circles, the second overlapping in multiply — the same
// construction as .brand-mark in the app, drawn at icon scale.
// Proportions come from the app: 18px circles, second offset by 11px.
function svg({ size, scale }) {
  const c = size / 2;
  const r = size * 0.215 * scale;
  const gap = r * 2 * (11 / 18);          // centre-to-centre, as in the mark
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#f5ead8"/>
    <circle cx="${c - gap / 2}" cy="${c}" r="${r}" fill="#c67139"/>
    <circle cx="${c + gap / 2}" cy="${c}" r="${r}" fill="#7a8a5e" style="mix-blend-mode:multiply"/>
  </svg>`;
}

const OUT = require('path').join(__dirname, '..', 'assets', 'icons') + '/';
const jobs = [
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
  { file: 'icon-192.png',         size: 192, scale: 1 },
  { file: 'icon-512.png',         size: 512, scale: 1 },
  // Maskable: platforms crop to a circle, so the mark sits inside the safe zone.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
];

(async () => {
  const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  for (const j of jobs) {
    const p = await b.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    await p.setContent(`<style>html,body{margin:0;padding:0}</style>${svg(j)}`);
    await p.screenshot({ path: OUT + j.file, omitBackground: false });
    await p.close();
    console.log(j.file, j.size + 'x' + j.size);
  }
  await b.close();
})();
