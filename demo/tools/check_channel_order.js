/**
 * Tentukan urutan kanal cv.Mat 3-channel di OpenCV.js dengan membaca
 * implementasi imshow (Mat -> ImageData) di dalam bundle.
 *
 * Kalau imshow memakai COLOR_BGR2RGBA, maka Mat 3-channel native-nya BGR.
 * Kalau COLOR_RGB2RGBA, maka RGB.
 *
 * Membaca bundle sebagai teks — tidak mengeksekusi kode eksternal.
 */
const fs = require('fs');
const path = require('path');

const s = fs.readFileSync(
  path.join(__dirname, '..', 'vendor', 'opencv.js'), 'utf8'
);

// --- imshow: bagaimana Mat dikonversi ke ImageData?
console.log('=== imshow (Mat -> ImageData) ===');
const i = s.indexOf('Module["imshow"]');
const imshow = s.slice(i, i + 2500);
const conv = imshow.match(/COLOR_[A-Z0-9_]+/g);
console.log('  konversi dipakai:', conv ? [...new Set(conv)].join(', ') : '(tidak ada)');
console.log('  cuplikan:', imshow.replace(/\s+/g, ' ').slice(0, 1100));

// --- fungsi pembantu yang sering dipakai: cvtColor helper di dalam JS
console.log('\n=== helper konversi warna di JS ===');
for (const kw of ['COLOR_RGB2RGBA', 'COLOR_BGR2RGBA', 'COLOR_RGBA2RGB', 'COLOR_RGBA2BGR']) {
  const n = (s.match(new RegExp(kw, 'g')) || []).length;
  console.log(' ', kw, '->', n);
}

// --- apakah ada patch khusus OpenCV.js untuk 3-channel?
console.log('\n=== jejak "3-channel" /通道 ===');
for (const kw of ['channels()===3', 'channels() == 3', 'CV_8UC3', 'isContinuous']) {
  const n = (s.match(new RegExp(kw.replace(/[()=]/g, '\\$&'), 'g')) || []).length;
  console.log(' ', kw, '->', n);
}
