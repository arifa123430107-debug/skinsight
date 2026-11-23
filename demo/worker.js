/**
 * worker.js — Semua kerja berat (OpenCV.js + TensorFlow.js + model) di worker.
 *
 * Kenapa worker KLASIK (bukan module): @tensorflow/tfjs-tflite memuat WASM-nya
 * lewat importScripts(), yang hanya ada di worker klasik.
 *
 * Kenapa semua di worker: OpenCV.js memblokir thread ~30 detik saat compile
 * WASM. Kalau di main thread, halaman beku dan tidak bisa interaksi.
 *
 * Konvensi kanal
 * --------------
 * OpenCV.js有可能 menyimpan Mat 3-channel sebagai RGB (bukan BGR seperti
 * OpenCV native). Menebak salah = seluruh konversi warna (Lab, HSV, gray)
 * jadi salah diam-diam. Jadi worker MENGUKUR konvensinya saat start-up lewat
 * probe dengan nilai yang bisa diverifikasi (abu-abu merah yang benar = 76),
 * lalu memakai konstanta yang sesuai.
 *
 * Protokol:
 *   masuk  {type:'detect',  frame:ArrayBuffer(RGBA), w, h}
 *   keluar {type:'detected', box:{x,y,w,h}|null}
 *
 *   masuk  {type:'analyze', crops:[ArrayBuffer(RGBA, ...), ...], w, h}
 *   keluar {type:'analyzed', predictions:[[9 float], ...], ruleScores:{}}
 *
 *   keluar {type:'ready'} | {type:'error', message}
 */

// false = hanya Teachable Machine (ringan, aman di HP)
// true  = ensemble 0.3·TM + 0.7·EfficientNetB3 (berat)
const USE_CUSTOM_MODEL = false;


let modelMy = null;   // model custom EfficientNetB3
let modelTm = null;   // model Teachable Machine
let tf = null;
let tflite = null;
let cascade = null;

/** Konvensi warna, diisi oleh probeColorConvention(). */
let C = null;

const IMG_SIZE = 224;
const SCALE_FACTOR = 1.3;   // skinsight.py:2709
const MIN_NEIGHBORS = 5;    // skinsight.py:2709

function waitForCv() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(iv);
      reject(new Error('OpenCV.js timeout di worker'));
    }, 120000);

    // Hanya untuk build yang benar-benar Promise asli
    if (self.cv instanceof Promise) {
      self.cv.then((m) => { self.cv = m; });
    }

    const iv = setInterval(() => {
      const c = self.cv;
      if (c && c.Mat) {
        clearInterval(iv); clearTimeout(timer);
        resolve();
      }
    }, 100);
  });
}

/* ──────────────────────────────────────────────────────────────
   PROBE KONVENSI KANAL
   ────────────────────────────────────────────────────────────── */

/**
 * Tentukan apakah Mat 3-channel di OpenCV.js memakai urutan BGR atau RGB.
 *
 * Cara: buat Mat 3-channel langsung dari byte mentah [255,0,0]._BYTE PERTAMA
 * adalah "kanal pertama" — entah merah atau biru, tergantung konvensi.
 *
 * Abu-abu merah = round(0.299*255) = 76. Abu-abu biru = round(0.114*255) = 29.
 *   - COLOR_RGB2GRAY menghasilkan 76 -> byte0 = Merah -> mat berurutan RGB
 *   - COLOR_BGR2GRAY menghasilkan 76 -> byte0 = Biru  -> mat berurutan BGR
 *
 * Konstanta yang "benar" untuk grayscale otomatis memberitahu konvensi,
 * jadi tidak perlu menebak terpisah.
 */
function probeColorConvention() {
  // Byte pertama = kanal pertama mat. Uji kekonvensi mana yang cocok.
  const m = cv.matFromArray(1, 1, cv.CV_8UC3, [255, 0, 0]);

  const gR = new cv.Mat();
  cv.cvtColor(m, gR, cv.COLOR_RGB2GRAY);
  const vRGB = gR.data[0];

  const gB = new cv.Mat();
  cv.cvtColor(m, gB, cv.COLOR_BGR2GRAY);
  const vBGR = gB.data[0];

  gR.delete(); gB.delete();

  // Cross-check dengan biru: gray benar biru = 29
  const blue = cv.matFromArray(1, 1, cv.CV_8UC3, [0, 0, 255]);
  const gbR = new cv.Mat();
  const gbB = new cv.Mat();
  cv.cvtColor(blue, gbR, cv.COLOR_RGB2GRAY);
  cv.cvtColor(blue, gbB, cv.COLOR_BGR2GRAY);
  const blueRGB = gbR.data[0];
  const blueBGR = gbB.data[0];
  gbR.delete(); gbB.delete(); blue.delete();

  // Nilai "benar": merah -> 76, biru -> 29 (dari kanal terakhir)
  const rgbCorrect = Math.abs(vRGB - 76) <= Math.abs(vBGR - 76);
  const blueCheck = rgbCorrect
    ? Math.abs(blueRGB - 29) <= Math.abs(blueBGR - 29)
    : Math.abs(blueBGR - 29) <= Math.abs(blueRGB - 29);

  const isRgb = rgbCorrect && blueCheck;
  m.delete();

  return {
    isRgb,
    // Indeks kanal [R, G, B] di dalam mat 3-channel
    rgbIndex: isRgb ? [0, 1, 2] : [2, 1, 0],
    grayConst: isRgb ? cv.COLOR_RGB2GRAY : cv.COLOR_BGR2GRAY,
    grayFromRgbaConst: cv.COLOR_RGBA2GRAY,   // 4-channel: tidak ambigu
    labConst: isRgb ? cv.COLOR_RGB2Lab : cv.COLOR_BGR2Lab,
    labInvConst: isRgb ? cv.COLOR_Lab2RGB : cv.COLOR_Lab2BGR,
    hsvConst: isRgb ? cv.COLOR_RGB2HSV : cv.COLOR_BGR2HSV,
    probe: { vRGB, vBGR, blueRGB, blueBGR },
  };
}

/* ──────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────── */

async function loadCascade() {
  const resp = await fetch('haar/haarcascade_frontalface_default.xml');
  if (!resp.ok) throw new Error('Gagal ambil cascade Haar (' + resp.status + ')');
  const xml = await resp.text();

  cv.FS.createDataFile('/', 'haar.xml', xml, true, false, false);
  const c = new cv.CascadeClassifier();
  c.load('/haar.xml');
  if (c.empty()) throw new Error('Cascade Haar kosong / tidak valid');
  return c;
}

async function init() {
  const t0 = performance.now();

  self.importScripts('vendor/opencv.js');
  await waitForCv();
    if (typeof cv.extractChannel !== 'function') {
    cv.extractChannel = function (src, dst, idx) {
      const planes = new cv.MatVector();
      cv.split(src, planes);
      const p = planes.get(idx);
      p.copyTo(dst);
      p.delete();
      planes.delete();
    };
  }
  console.log('[worker] OpenCV.js siap @', ((performance.now() - t0) / 1000).toFixed(1), 'dtx');

  C = probeColorConvention();
  console.log('[worker] konvensi kanal 3-channel:', C.isRgb ? 'RGB' : 'BGR',
  '| probe gray(RGB2GRAY)=', C.probe.vRGB, 'gray(BGR2GRAY)=', C.probe.vBGR,
  '| biru RGB2GRAY=', C.probe.blueRGB, 'BGR2GRAY=', C.probe.blueBGR);
  self.importScripts('vendor/tfjs-core.min.js');
  self.importScripts('vendor/tfjs-backend-wasm.min.js');
  self.importScripts('vendor/tf-tflite.min.js');

  tf = self.tf;
  tflite = self.tflite;

  try {
    tf.wasm.setWasmPaths('vendor/');
    await tf.setBackend('wasm');
    await tf.ready();
    console.log('[worker] tfjs-core backend:', tf.getBackend());
  } catch (e) {
    console.warn('[worker] backend wasm gagal:', e && e.message);
  }

  tflite.setWasmPath('vendor/');

  console.log('[worker] memuat model TFLite…');
  const t1 = performance.now();
  modelMy = await tflite.loadTFLiteModel('models/model_efb3_fp16.tflite');
  modelTm = await tflite.loadTFLiteModel('models/model_tm_fp16.tflite');
  console.log('[worker] model siap dalam', ((performance.now() - t1) / 1000).toFixed(1), 'dtx');

  if (USE_CUSTOM_MODEL) {
    modelMy = await tflite.loadTFLiteModel('models/model_efb3_fp16.tflite');
  }
  modelTm = await tflite.loadTFLiteModel('models/model_tm_fp16.tflite');
  console.log('[worker] model siap dalam', ((performance.now() - t1) / 1000).toFixed(1), 'dtx');

  try {
    console.log('[worker] modelTm in:', modelTm.inputs[0].shape, modelTm.inputs[0].dtype);
  } catch (e) {
    console.warn('[worker] info tensor tidak terbaca:', e && e.message);
  }

  // Pemanasan: inferensi pertama selalu paling lambat, jadi lakukan sekarang.
  const warm = tf.zeros([1, IMG_SIZE, IMG_SIZE, 3]);
  (await modelTm.predict(warm)).dispose();
  warm.dispose();

  console.log('[worker] memuat cascade Haar…');
  cascade = await loadCascade();
  console.log('[worker] siap total dalam', ((performance.now() - t0) / 1000).toFixed(1), 'dtx');

  self.postMessage({ type: 'ready' });
}

/* ──────────────────────────────────────────────────────────────
   HELPER KANAL
   ────────────────────────────────────────────────────────────── */

/**
 * Ambil kanal R, G, B dari mat 3-channel sesuai konvensi.
 *
 * PENTING: data disalin ke Uint8Array biasa, BUKAN memakai view .data
 * dari mat temporer — view jadi invalid setelah mat dihapus.
 *
 * @returns {{r: Uint8Array, g: Uint8Array, b: Uint8Array}}
 */
function extractRgb(mat3) {
  const [iR, iG, iB] = C.rgbIndex;
  const out = [];
  for (const idx of [iR, iG, iB]) {
    const m = new cv.Mat();
    cv.extractChannel(mat3, m, idx);
    out.push(new Uint8Array(m.data));
    m.delete();
  }
  return { r: out[0], g: out[1], b: out[2] };
}

/* ──────────────────────────────────────────────────────────────
   DETEKSI WAJAH
   skinsight.py:2706-2720
   ────────────────────────────────────────────────────────────── */

function detectFace(frameBuf, w, h) {
  const rgba = new Uint8Array(frameBuf);
  const src = new cv.Mat(h, w, cv.CV_8UC4);
  src.data.set(rgba);

  const gray = new cv.Mat();
  cv.cvtColor(src, gray, C.grayFromRgbaConst);

  const faces = new cv.RectVector();
  cascade.detectMultiScale(gray, faces, SCALE_FACTOR, MIN_NEIGHBORS);

  let box = null;
  if (faces.size() > 0) {
    // faces[0] — PERTAMA, bukan terbesar (skinsight.py:2714)
    const r = faces.get(0);
    box = { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  faces.delete(); gray.delete(); src.delete();
  return box;
}

/* ──────────────────────────────────────────────────────────────
   PREPROCESSING
   skinsight.py:336-356
   ────────────────────────────────────────────────────────────── */

/**
 * CLAHE + normalisasi brightness.
 * @param {cv.Mat} bgr3  Mat 3-channel (urutan mengikuti konvensi C)
 * @returns {cv.Mat} Mat 3-channel hasil
 */
function preprocessFace(mat3) {
  const lab = new cv.Mat();
  cv.cvtColor(mat3, lab, C.labConst);
  const planes = new cv.MatVector();
  cv.split(lab, planes);
  const l = planes.get(0); const a = planes.get(1); const b = planes.get(2);
  planes.delete();
 

  const clahe = new cv.CLAHE(1.0, new cv.Size(8, 8));
  const lEq = new cv.Mat();
  clahe.apply(l, lEq);

  const lBlend = new cv.Mat();
  cv.addWeighted(lEq, 0.4, l, 0.6, 0, lBlend);

  const currentMean = cv.mean(lBlend)[0];
  let lNorm;
  if (currentMean > 10) {
    const scale = 140.0 / currentMean;
    const scaled = new cv.Mat();
    lBlend.convertTo(scaled, cv.CV_32F, scale);

    // clip(0, 255) — cv.min lalu cv.max
    const clamped = new cv.Mat();
    cv.min(scaled, new cv.Mat(scaled.rows, scaled.cols, cv.CV_32F, new cv.Scalar(255, 255, 255, 255)), clamped);
    const finalF = new cv.Mat();
    cv.max(clamped, new cv.Mat(clamped.rows, clamped.cols, cv.CV_32F, new cv.Scalar(0, 0, 0, 0)), finalF);

    // Python memakai .astype(np.uint8) yang MEMOTONG (truncate),
    // sedangkan cv.convertTo membulatkan (round).
    // OpenCV.js build ini tidak punya cv.floor, jadi truncate dilakukan
    // dengan subtracting 0.5 lalu convertTo (yang membulatkan):
    //   round(x - 0.5) == floor(x)  untuk x >= 0
    const shifted = new cv.Mat();
    finalF.convertTo(shifted, cv.CV_32F, 1.0, -0.5);

    lNorm = new cv.Mat();
    shifted.convertTo(lNorm, cv.CV_8U);

    shifted.delete();

    scaled.delete(); clamped.delete(); finalF.delete();
  } else {
    lNorm = lBlend.clone();
  }

  const merged = new cv.Mat();
  const mv = new cv.MatVector();
  mv.push_back(lNorm); mv.push_back(a); mv.push_back(b);
  cv.merge(mv, merged);
  mv.delete();
  const result = new cv.Mat();
  cv.cvtColor(merged, result, C.labInvConst);

  l.delete(); a.delete(); b.delete(); lab.delete();
  clahe.delete(); lEq.delete(); lBlend.delete(); lNorm.delete(); merged.delete();
  return result;
}

/**
 * Buat input tensor untuk kedua model dari mat hasil preprocess.
 *
 * PENTING — dua model menerima input BERBEDA (skinsight.py:429-449):
 *   custom (efb3): RGB float 0-255, TANPA normalisasi eksternal
 *   TM           : BGR float 0-1 (dibagi 255)
 */
function buildInputs(mat3) {
  const { r, g, b } = extractRgb(mat3);

  // --- Custom: RGB float 0-255
  const inputMy = new Float32Array(IMG_SIZE * IMG_SIZE * 3);
  for (let i = 0, p = 0; i < IMG_SIZE * IMG_SIZE; i++) {
    inputMy[p++] = r[i];
    inputMy[p++] = g[i];
    inputMy[p++] = b[i];
  }

  // --- TM: BGR float 0-1
  const inputTm = new Float32Array(IMG_SIZE * IMG_SIZE * 3);
  for (let i = 0, p = 0; i < IMG_SIZE * IMG_SIZE; i++) {
    inputTm[p++] = b[i] / 255.0;
    inputTm[p++] = g[i] / 255.0;
    inputTm[p++] = r[i] / 255.0;
  }

  return { inputMy, inputTm };
}

/* ──────────────────────────────────────────────────────────────
   RULE-BASED SCORES
   skinsight.py:359-427
   Input: Mat 3-channel MENTAH (belum CLAHE)
   ────────────────────────────────────────────────────────────── */

function ruleBasedSkinScores(mat3, classNames) {
  const faceResized = new cv.Mat();
  cv.resize(mat3, faceResized, new cv.Size(224, 224));

  const hsv = new cv.Mat();
  cv.cvtColor(faceResized, hsv, C.hsvConst);
  const gray = new cv.Mat();
  cv.cvtColor(faceResized, gray, C.grayConst);

  const h = gray.rows;
  const w = gray.cols;

  const slice = (m, y0, y1, x0, x1) => m.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));

  const cheeks = slice(faceResized, Math.trunc(0.38 * h), Math.trunc(0.68 * h), Math.trunc(0.15 * w), Math.trunc(0.85 * w));
  const underEye = slice(faceResized, Math.trunc(0.30 * h), Math.trunc(0.44 * h), Math.trunc(0.15 * w), Math.trunc(0.85 * w));
  const tzone = slice(faceResized, Math.trunc(0.10 * h), Math.trunc(0.60 * h), Math.trunc(0.38 * w), Math.trunc(0.62 * w));

  const scores = {};
  for (const name of classNames) scores[name] = 0.0;

  // Kemerahan: r > g*1.20 && r > b*1.20, x2.5
  // Ambil kanal langsung dari cheeks — tidak perlu konversi ke RGB dulu,
  // karena extractChannel dengan indeks benar sudah menghasilkan R/G/B.
  const chR = new cv.Mat(); const chG = new cv.Mat(); const chB = new cv.Mat();
  cv.extractChannel(cheeks, chR, C.rgbIndex[0]);
  cv.extractChannel(cheeks, chG, C.rgbIndex[1]);
  cv.extractChannel(cheeks, chB, C.rgbIndex[2]);

  const gScaled = new cv.Mat(); const bScaled = new cv.Mat(); const rF = new cv.Mat();
  chG.convertTo(gScaled, cv.CV_32F, 1.20);
  chB.convertTo(bScaled, cv.CV_32F, 1.20);
  chR.convertTo(rF, cv.CV_32F);
  const cmp1 = new cv.Mat(); const cmp2 = new cv.Mat(); const rednessMask = new cv.Mat();
  cv.compare(rF, gScaled, cmp1, cv.CMP_GT);
  cv.compare(rF, bScaled, cmp2, cv.CMP_GT);
  cv.bitwise_and(cmp1, cmp2, rednessMask);
  const redness = cv.mean(rednessMask)[0] / 255.0;
  scores["kemerahan"] = Math.min(1.0, redness * 2.5);

  // Berminyak: T-zone gray > 215, x5.0
  const tGray = new cv.Mat();
  cv.cvtColor(tzone, tGray, C.grayConst);
  const oilyMask = new cv.Mat();
  cv.compare(tGray, new cv.Mat(tGray.rows, tGray.cols, cv.CV_8U, new cv.Scalar(215, 215, 215, 215)), oilyMask, cv.CMP_GT);
  const oily = cv.mean(oilyMask)[0] / 255.0;
  scores["berminyak"] = Math.min(1.0, oily * 5.0);

  // Mata panda: (face_mean - under_eye_mean) / 70
  const ueGray = new cv.Mat();
  cv.cvtColor(underEye, ueGray, C.grayConst);
  const faceMean = cv.mean(gray)[0];
  scores["mata panda"] = Math.min(1.0, Math.max(0.0, (faceMean - cv.mean(ueGray)[0]) / 70.0));

  // Flek hitam: pipi gray < max(55, cheek_mean - 65), x5.0
  const cheekGray = new cv.Mat();
  cv.cvtColor(cheeks, cheekGray, C.grayConst);
  const cheekMean = cv.mean(cheekGray)[0];
  const flekT = Math.max(55, cheekMean - 65);
  const darkMask = new cv.Mat();
  cv.compare(cheekGray, new cv.Mat(cheekGray.rows, cheekGray.cols, cv.CV_8U, new cv.Scalar(flekT, flekT, flekT, flekT)), darkMask, cv.CMP_LT);
  scores["flek hitam"] = Math.min(1.0, (cv.mean(darkMask)[0] / 255.0) * 5.0);

  // Komedo: T-zone gray < max(40, nose_mean - 70), x8.0
  const noseGray = new cv.Mat();
  cv.cvtColor(tzone, noseGray, C.grayConst);
  const noseMean = cv.mean(noseGray)[0];
  const komedoT = Math.max(40, noseMean - 70);
  const blackheadMask = new cv.Mat();
  cv.compare(noseGray, new cv.Mat(noseGray.rows, noseGray.cols, cv.CV_8U, new cv.Scalar(komedoT, komedoT, komedoT, komedoT)), blackheadMask, cv.CMP_LT);
  scores["komedo"] = Math.min(1.0, (cv.mean(blackheadMask)[0] / 255.0) * 8.0);

  // Kerutan: Canny(60,140) di area dahi, x3.0
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 60, 140);
  const wrinkleArea = slice(edges, Math.trunc(0.05 * h), Math.trunc(0.45 * h), Math.trunc(0.10 * w), Math.trunc(0.90 * w));
  const wrinkleScore = cv.mean(wrinkleArea)[0] / 255.0;
  scores["kerutan"] = Math.min(1.0, wrinkleScore * 3.0);

  // Kering: saturasi rendah + tekstur
  const sat = new cv.Mat();
  cv.extractChannel(hsv, sat, 1);
  const satF = new cv.Mat();
  sat.convertTo(satF, cv.CV_32F);
  const lowSatMask = new cv.Mat();
  cv.compare(satF, new cv.Mat(satF.rows, satF.cols, cv.CV_32F, new cv.Scalar(45, 45, 45, 45)), lowSatMask, cv.CMP_LT);
  const lowSat = cv.mean(lowSatMask)[0] / 255.0;

  const grayF = new cv.Mat();
  gray.convertTo(grayF, cv.CV_32F);
  const mean = new cv.Mat(); const stddev = new cv.Mat();
  cv.meanStdDev(grayF, mean, stddev);
  const texture = stddev.doubleAt(0, 0) / 80.0;
  scores["kering"] = Math.min(1.0, lowSat * 0.6 + texture * 0.4);

  // Berjerawat: kemerahan*0.4 + kerutan*1.2
  scores["berjerawat"] = Math.min(1.0, scores["kemerahan"] * 0.4 + wrinkleScore * 1.2);

  // Normal: 1 - max issue
  let maxIssue = 0.0;
  for (const key of Object.keys(scores)) {
    if (key !== "normal" && scores[key] > maxIssue) maxIssue = scores[key];
  }
  scores["normal"] = Math.max(0.0, 1.0 - maxIssue);

  [faceResized, hsv, gray, chR, chG, chB, gScaled, bScaled, rF, cmp1, cmp2,
   rednessMask, tGray, oilyMask, ueGray, cheekGray, darkMask, noseGray, blackheadMask,
   edges, sat, satF, lowSatMask, grayF, mean, stddev].forEach((m) => { if (m && m.delete) m.delete(); });

  return scores;
}

/* ──────────────────────────────────────────────────────────────
   INFERENSI
   ────────────────────────────────────────────────────────────── */

   /*
async function predictFrame(mat3) {
  const pre = preprocessFace(mat3);
  const { inputMy, inputTm } = buildInputs(pre);
  pre.delete();

  const tMy = tf.tensor4d(inputMy, [1, IMG_SIZE, IMG_SIZE, 3]);
  const tTm = tf.tensor4d(inputTm, [1, IMG_SIZE, IMG_SIZE, 3]);

  const outMy = await modelMy.predict(tMy);
  const outTm = await modelTm.predict(tTm);

  const predMy = Array.from(await outMy.data());
  const predTm = Array.from(await outTm.data());

  tMy.dispose(); tTm.dispose();
  outMy.dispose(); outTm.dispose();

  // 0.3 * TM + 0.7 * custom — skinsight.py:455
  return predMy.map((v, i) => 0.3 * predTm[i] + 0.7 * v);
}
*/


async function predictFrame(mat3) {
  const pre = preprocessFace(mat3);
  const { inputMy, inputTm } = buildInputs(pre);
  pre.delete();

  const tTm = tf.tensor4d(inputTm, [1, IMG_SIZE, IMG_SIZE, 3]);
  const outTm = await modelTm.predict(tTm);
  const predTm = Array.from(await outTm.data());
  tTm.dispose(); outTm.dispose();

  if (!USE_CUSTOM_MODEL) return predTm;          // hanya Teachable Machine

  const tMy = tf.tensor4d(inputMy, [1, IMG_SIZE, IMG_SIZE, 3]);
  const outMy = await modelMy.predict(tMy);
  const predMy = Array.from(await outMy.data());
  tMy.dispose(); outMy.dispose();

  // 0.3 * TM + 0.7 * custom — skinsight.py:455
  return predMy.map((v, i) => 0.3 * predTm[i] + 0.7 * v);
}



/* ──────────────────────────────────────────────────────────────
   PESAN
   ────────────────────────────────────────────────────────────── */

/**
 * Ubah RGBA (4 channel, pasti RGBA) jadi Mat 3 channel.
 *
 * 4-channel selalu RGBA di OpenCV.js, jadi COLOR_RGBA2BGR menghasilkan
 * mat 3-channel dengan urutan BGR (konvensi OpenCV native). Kalau OpenCV.js
 * ternyata menyimpan mat 3-channel sebagai RGB, kita perlu membalik lagi.
 */
function rgbaToMat3(rgba, w, h) {
  const src = new cv.Mat(h, w, cv.CV_8UC4);
  src.data.set(rgba);
  const bgr = new cv.Mat();
  cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
  src.delete();

  if (!C.isRgb) {
    // Konvensi native (BGR) — sudah sesuai.
    return bgr;
  }

  // Konvensi OpenCV.js ternyata RGB: balik ke RGB.
  const rgb = new cv.Mat();
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB);
  bgr.delete();
  return rgb;
}

self.onmessage = async (e) => {
  const msg = e.data;

  try {
    if (msg.type === 'detect') {
      const box = detectFace(msg.frame, msg.w, msg.h);
      self.postMessage({ id: msg.id, type: 'detected', box });
      return;
    }

    if (msg.type === 'analyze') {
      const resized = [];
      for (const buf of msg.crops) {
        const mat = rgbaToMat3(new Uint8Array(buf), msg.w, msg.h);
        const dst = new cv.Mat();
        cv.resize(mat, dst, new cv.Size(IMG_SIZE, IMG_SIZE), 0, 0, cv.INTER_LINEAR);
        mat.delete();
        resized.push(dst);
      }

      // rule-based memakai crop MENTAH frame terakhir — skinsight.py:4963
      const ruleScores = ruleBasedSkinScores(resized[resized.length - 1], CLASS_NAMES_WORKER);

      const predictions = [];
      for (let i = 0; i < resized.length; i++) {
        predictions.push(await predictFrame(resized[i]));
        self.postMessage({ type: 'progress', id: msg.id, done: i + 1, total: resized.length });
      }

      resized.forEach((m) => m.delete());

      self.postMessage({ id: msg.id, type: 'analyzed', predictions, ruleScores });
      return;
    }
  } catch (err) {
    console.error('[worker] gagal:', err);

    self.postMessage({
      type: 'error',
      message: (err && err.message ? err.message : String(err)) +
        ' || STACK: ' + (err && err.stack ? err.stack : 'Tidak tersedia')
    });
  }
};

// Hardcode di worker (worker klasik tidak bisa import ES module).
const CLASS_NAMES_WORKER = [
  'berjerawat', 'berminyak', 'flek hitam', 'kemerahan', 'kering',
  'kerutan', 'komedo', 'mata panda', 'normal',
];

init().catch((err) => {
  console.error('[worker] init gagal:', err);
  const frames = String((err && err.stack) || '')
    .split('\n').slice(0, 14).map((s) => s.trim()).join('  ←  ');
  self.postMessage({
    type: 'error',
    message: (err && err.message ? err.message : String(err)) + '  ||  ' + frames,
  });
});
