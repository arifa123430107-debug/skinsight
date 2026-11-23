/**
 * test_channel_semantics.js — Tentukan urutan kanal cv.Mat 3-channel
 * di OpenCV.js (BGR seperti OpenCV native, atau RGB seperti imshow).
 *
 * Metode: buat CV_8UC3 dengan bytes [255,0,0] lalu bandingkan hasil
 * COLOR_BGR2GRAY dengan COLOR_RGB2GRAY.
 *   - bila 0.299*255 ≈ 76  -> byte[0] dibaca sebagai R  (semantik RGB)
 *   - bila 0.114*255 ≈ 29  -> byte[0] dibaca sebagai B  (semantik BGR)
 *
 * Ini penting: kalau semantiknya beda dari OpenCV Python, seluruh
 * konversi warna di worker.js harus disesuaikan.
 */
const cv = require('../vendor/opencv.js');

cv.onRuntimeInitialized = () => {
  const out = {};

  // --- Uji 1: bytes [255,0,0] -> gray
  const m = cv.matFromArray(1, 1, cv.CV_8UC3, [255, 0, 0]);
  const gBgr = new cv.Mat();
  const gRgb = new cv.Mat();
  cv.cvtColor(m, gBgr, cv.COLOR_BGR2GRAY);
  cv.cvtColor(m, gRgb, cv.COLOR_RGB2GRAY);
  out.grayFromBGR = gBgr.data[0];
  out.grayFromRGB = gRgb.data[0];
  gBgr.delete(); gRgb.delete();

  // --- Uji 2: bytes [0,0,255] -> gray
  const m2 = cv.matFromArray(1, 1, cv.CV_8UC3, [0, 0, 255]);
  const g2 = new cv.Mat();
  cv.cvtColor(m2, g2, cv.COLOR_BGR2GRAY);
  out.blueByteGray = g2.data[0];
  g2.delete();

  // --- Uji 3: COLOR_RGBA2BGR pada mat 4-channel -> apa isi byte-nya?
  const m4 = cv.matFromArray(1, 1, cv.CV_8UC4, [10, 20, 30, 255]);
  const m3 = new cv.Mat();
  cv.cvtColor(m4, m3, cv.COLOR_RGBA2BGR);
  out.rgba2bgr = Array.from(m3.data).slice(0, 3);
  m3.delete();

  // --- Uji 4: COLOR_BGR2RGB pada mat 3-channel
  const m5 = cv.matFromArray(1, 1, cv.CV_8UC3, [11, 22, 33]);
  const m5b = new cv.Mat();
  cv.cvtColor(m5, m5b, cv.COLOR_BGR2RGB);
  out.bgr2rgb = Array.from(m5b.data).slice(0, 3);
  m5b.delete();

  // --- Uji 5: extractChannel pada 3-channel
  const m6 = cv.matFromArray(1, 1, cv.CV_8UC3, [77, 88, 99]);
  const ch0 = new cv.Mat();
  cv.extractChannel(m6, ch0, 0);
  out.channel0 = ch0.data[0];
  ch0.delete();

  console.log(JSON.stringify(out, null, 2));
  m.delete(); m2.delete(); m4.delete(); m5.delete(); m6.delete();
  process.exit(0);
};

setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 30000);
