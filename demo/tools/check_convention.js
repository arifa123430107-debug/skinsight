/**
 * check_convention.js — Probe konvensi kanal OpenCV.js.
 *
 * Menyalakan worker versi lite yang HANYA memuat OpenCV.js dan menjalankan
 * probe yang sama dengan worker.js (probeColorConvention).
 *
 * Jalankan:  node tools/check_convention.js
 *
 * Hasilnya dicetak ke console. Jalankan juga di console browser:
 *   import('./worker_probe.js')  — atau salin blok probe ke console.
 */
const cv = require('../vendor/opencv.js');

cv.onRuntimeInitialized = () => {
  const m = cv.matFromArray(1, 1, cv.CV_8UC3, [255, 0, 0]);

  const gR = new cv.Mat();
  cv.cvtColor(m, gR, cv.COLOR_RGB2GRAY);
  const vRGB = gR.data[0];

  const gB = new cv.Mat();
  cv.cvtColor(m, gB, cv.COLOR_BGR2GRAY);
  const vBGR = gB.data[0];

  const blue = cv.matFromArray(1, 1, cv.CV_8UC3, [0, 0, 255]);
  const gbR = new cv.Mat();
  const gbB = new cv.Mat();
  cv.cvtColor(blue, gbR, cv.COLOR_RGB2GRAY);
  cv.cvtColor(blue, gbB, cv.COLOR_BGR2GRAY);
  const blueRGB = gbR.data[0];
  const blueBGR = gbB.data[0];

  console.log('=== PROBE KONVENSI KANAL OpenCV.js ===');
  console.log('  piksel [255,0,0] -> COLOR_RGB2GRAY =', vRGB, '(benar 76)');
  console.log('  piksel [255,0,0] -> COLOR_BGR2GRAY =', vBGR, '(benar 29)');
  console.log('  piksel [0,0,255] -> COLOR_RGB2GRAY =', blueRGB, '(benar 29)');
  console.log('  piksel [0,0,255] -> COLOR_BGR2GRAY =', blueBGR, '(benar 76)');

  const rgbCorrect = Math.abs(vRGB - 76) <= Math.abs(vBGR - 76);
  const blueCheck = rgbCorrect
    ? Math.abs(blueRGB - 29) <= Math.abs(blueBGR - 29)
    : Math.abs(blueBGR - 29) <= Math.abs(blueRGB - 29);
  const isRgb = rgbCorrect && blueCheck;

  console.log('');
  console.log('  HASIL: konvensi 3-channel =', isRgb ? 'RGB' : 'BGR');
  console.log('  rgbIndex =', isRgb ? '[0,1,2]' : '[2,1,0]');
  console.log('  worker.js akan memakai:', isRgb ? 'COLOR_RGB2Lab / COLOR_RGB2HSV / COLOR_RGB2GRAY'
                                               : 'COLOR_BGR2Lab / COLOR_BGR2HSV / COLOR_BGR2GRAY');
  console.log('');

  gR.delete(); gB.delete(); gbR.delete(); gbB.delete(); m.delete(); blue.delete();
  process.exit(0);
};

setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 30000);
