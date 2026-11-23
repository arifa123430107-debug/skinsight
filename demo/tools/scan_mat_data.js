/**
 * Cari definisi property `data` pada cv.Mat di OpenCV.js.
 *
 * Pertanyaan kunci: untuk Mat 3-channel (CV_8UC3), apakah .data adalah
 * 3 byte/pixel (BGR) atau 4 byte/pixel (RGBA)? Dan urutan kanalnya apa?
 */
const fs = require('fs');
const path = require('path');

const s = fs.readFileSync(
  path.join(__dirname, '..', 'vendor', 'opencv.js'), 'utf8'
);

console.log('=== semua defineProperty ===');
const dp = [...s.matchAll(/Object\.defineProperty\(([^,]{0,60}),\s*"([^"]+)"/g)];
console.log('  jumlah:', dp.length);
dp.slice(0, 30).forEach((m) => console.log('   ', m[2], '  <-', m[1].slice(0, 50)));

console.log('\n=== property "data" ===');
const di = s.indexOf('defineProperty(cv.Mat.prototype, "data"');
if (di < 0) {
  const alt = s.indexOf('"data",');
  console.log('  pola alternatif di', alt);
  if (alt > 0) console.log(s.slice(Math.max(0, alt - 700), alt + 700).replace(/\s+/g, ' '));
} else {
  console.log(s.slice(di, di + 1600).replace(/\s+/g, ' '));
}

console.log('\n=== penyebut channels() / rows*cols ===');
for (const kw of ['channels()', 'this.rows*this.cols', 'this.rows * this.cols', 'step()']) {
  const n = (s.match(new RegExp(kw.replace(/[()*]/g, '\\$&'), 'g')) || []).length;
  console.log(' ', kw, '->', n);
}
