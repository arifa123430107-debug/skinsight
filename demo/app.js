/**
 * app.js — Demo web SkinSight.
 *
 * Pembagian tanggung jawab:
 *   MAIN THREAD : kamera, canvas 2D (pratinjau + anotasi), UI
 *   WORKER      : OpenCV.js, TensorFlow.js, model TFLite, seluruh inferensi
 *
 * Main thread SENGAJA tidak memuat OpenCV.js sama sekali — compile WASM-nya
 * memblokir thread ~30 detik. Semua kerja itu di worker.
 *
 * Numerasi pipeline (pipeline.js / worker.js) diambil apa adanya dari
 * skinsight.py (aplikasi desktop) agar hasil web identik dengan desktop.
 */

import { CLASS_NAMES, FACE_ZONE_MAP, CONDITION_COLOR_RGB } from './zones.js';
import { RECO, getExplanation, matchCombo } from './reco.js';
import {
  IMG_SIZE, SNAPSHOT_FRAMES,
  aggregateResults, severityLabel, confidenceLabel,
} from './pipeline.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  worker: null,
  stream: null,
  video: null,
  ready: false,
  busy: false,
  capturing: false,
  frozen: false,        // true = layar menampilkan hasil anotasi
  lastBox: null,
};

const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const FRAMES = IS_MOBILE ? 10 : SNAPSHOT_FRAMES;   // jumlah frame yang dirata-rata
const PREVIEW_W = 320;                            // lebar frame untuk deteksi pratinjau
const PREVIEW_H = Math.round(PREVIEW_W * (3/4));  // tinggi frame untuk deteksi pratinjau



const els = {};

/* ──────────────────────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────────────────────── */

function init() {
  els.video = $('#video');
  els.canvas = $('#overlay');
  els.ctx = els.canvas.getContext('2d');
  els.captureBtn = $('#captureBtn');
  els.startBtn = $('#startBtn');
  els.statusEl = $('#status');
  els.resultPanel = $('#resultPanel');
  els.emptyState = $('#emptyState');
  els.confidenceEl = $('#confidenceBadge');
  els.conditionsEl = $('#conditions');
  els.recoEl = $('#recommendations');
  els.explainEl = $('#explanation');
  els.progressEl = $('#progress');
  els.progressBar = $('#progressBar');
  els.vpEmpty = $('#vpEmpty');
  els.annotImg = $('#annotatedImg');

  els.startBtn.addEventListener('click', startCamera);
  els.captureBtn.addEventListener('click', capture);

  setStatus('Memuat model (OpenCV.js + TensorFlow.js + TFLite)… sekali saja, mungkin 1–2 menit.');
  bootstrap();
}

async function bootstrap() {
  try {
    const t0 = performance.now();
    console.log('[demo] bootstrap mulai');

    // Worker KLASIK (bukan module) — tfjs-tflite butuh importScripts()
    state.worker = new Worker('./worker.js');
    attachWorkerListener(state.worker);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout memuat model (300 dtk). Coba muat ulang halaman.')),
        300000
      );
      const onMsg = (e) => {
        if (e.data.type === 'ready') {
          clearTimeout(timer);
          state.worker.removeEventListener('message', onMsg);
          resolve();
        } else if (e.data.type === 'error') {
          clearTimeout(timer);
          state.worker.removeEventListener('message', onMsg);
          reject(new Error(e.data.message));
        }
      };
      state.worker.addEventListener('message', onMsg);
      state.worker.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new Error('Worker gagal: ' + (e.message || 'unknown error')));
      });
    });

    console.log('[demo] siap dalam', ((performance.now() - t0) / 1000).toFixed(1), 'dtx');

    state.ready = true;
    els.startBtn.disabled = false;
    els.captureBtn.disabled = false;
    setStatus('Siap. Tekan "Aktifkan Kamera" untuk mulai.');
  } catch (err) {
    console.error('[demo] init gagal:', err);
    setStatus('Gagal memuat: ' + err.message, true);
    els.startBtn.disabled = true;
  }
}

/* ──────────────────────────────────────────────────────────────
   KAMERA
   ────────────────────────────────────────────────────────────── */

async function startCamera() {
  if (!state.ready) return;
  els.startBtn.disabled = true;
  setStatus('Meminta izin kamera…');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Browser ini tidak mendukung akses kamera. Coba Chrome/Edge di desktop, atau buka lewat HTTPS.', true);
    els.startBtn.disabled = false;
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play();

    els.vpEmpty.hidden = true;
    els.captureBtn.disabled = false;
    els.startBtn.textContent = 'Kamera Aktif';
    setStatus('Kamera aktif. Posisikan wajah di tengah bingkai, lalu tekan Capture.');
    startPreviewLoop();
  } catch (err) {
    console.error('[demo] kamera gagal:', err);
    const msg =
      err.name === 'NotAllowedError' ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser lalu coba lagi.' :
      err.name === 'NotFoundError' ? 'Kamera tidak ditemukan pada perangkat ini.' :
      err.name === 'NotReadableError' ? 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.' :
      'Tidak bisa mengakses kamera: ' + err.message;
    setStatus(msg, true);
    els.startBtn.disabled = false;
  }
}

/**
 * Pratinjau: kirim frame ke worker untuk deteksi wajah, gambar kotak di canvas.
 * Jangan terlalu sering — deteksi Haar itu mahal.
 */
let previewBusy = false;
let lastPreview = 0;

function startPreviewLoop() {
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });

  function tick(ts) {
    requestAnimationFrame(tick);
    if (!els.video.videoWidth || state.capturing || state.frozen || document.hidden) return;
    if (previewBusy || ts - lastPreview < 250) return;   // ~4x/detik
    previewBusy = true;
    lastPreview = ts;

    // Deteksi di frame kecil (lebar 320); kotak diskalakan balik.
    const vw = els.video.videoWidth;
    const vh = els.video.videoHeight;
    const scale = Math.min(1, PREVIEW_W / vw);
    scratch.width = Math.round(vw * scale);
    scratch.height = Math.round(vh * scale);
    sctx.drawImage(els.video, 0, 0, scratch.width, scratch.height);
    const data = sctx.getImageData(0, 0, scratch.width, scratch.height);

    sendToWorker(
      { type: 'detect', frame: data.data.buffer, w: scratch.width, h: scratch.height },
      [data.data.buffer]
    )
      .then((res) => {
        const b = res.box
          ? { x: res.box.x / scale, y: res.box.y / scale, w: res.box.w / scale, h: res.box.h / scale }
          : null;
        state.lastBox = b;
        if (!state.frozen && !state.capturing) drawPreview(b);
      })
      .catch(() => {})
      .finally(() => { previewBusy = false; });
  }
  requestAnimationFrame(tick);
}

/** Overlay transparan: hanya kotak wajah. Videonya tetap berjalan mulus di belakangnya. */
function drawPreview(box) {
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw) return;
  if (els.canvas.width !== vw || els.canvas.height !== vh) {
    els.canvas.width = vw;
    els.canvas.height = vh;
  }
}

/** Kembali ke kamera langsung setelah hasil anotasi ditampilkan. */
function unfreeze() {
  state.frozen = false;
  els.ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  els.captureBtn.textContent = 'Capture & Analisis';
  setStatus('Kamera aktif. Posisikan wajah di tengah bingkai, lalu tekan Capture.');
}

/** Tunggu frame video berikutnya (agar tiap frame yang dirata-rata benar-benar berbeda). */
function nextVideoFrame(video) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 120);
    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(() => { clearTimeout(t); resolve(); });
    }
  });
}

/** Gambar video + kotak wajah di canvas overlay. */
/*
function drawPreview(box) {
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw) return;
  els.canvas.width = vw;
  els.canvas.height = vh;
  els.ctx.drawImage(els.video, 0, 0, vw, vh);
  if (box) {
    els.ctx.strokeStyle = 'rgb(180,80,200)';
    els.ctx.lineWidth = 2;
    els.ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
} */

/* ──────────────────────────────────────────────────────────────
   CAPTURE
   ────────────────────────────────────────────────────────────── */

async function capture() {
  if (state.frozen) { unfreeze(); return; }   // tombol 'Ambil Ulang'
  if (state.busy || !state.ready) return;
  if (!state.stream) {
    setStatus('Aktifkan kamera dulu.', true);
    return;
  }
  
  state.busy = true;
  state.capturing = true;
  els.captureBtn.disabled = true;
  els.captureBtn.textContent = 'Menganalisis…';
  els.resultPanel.hidden = true;
  els.emptyState.hidden = false;

  try {
    // --- 1. Frame penuh dari video
    showProgress('Menyiapkan wajah…', 0.05);
    const video = els.video;
    const W = video.videoWidth;
    const H = video.videoHeight;
    const full = document.createElement('canvas');
    full.width = W;
    full.height = H;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(video, 0, 0, W, H);

    // --- 2. Deteksi wajah (worker)
    showProgress('Mencari wajah…', 0.1);
    const frameData = fctx.getImageData(0, 0, W, H);
    const frameBuf = new Uint8Array(frameData.data.length);
    frameBuf.set(frameData.data);

    const det = await sendToWorker({ type: 'detect', frame: frameBuf.buffer, w: W, h: H }, [frameBuf.buffer]);
    if (!det.box) {
      setStatus('Wajah tidak terdeteksi. Pastikan wajah terlihat jelas, pencahayaan cukup, dan hanya satu wajah dalam bingkai.', true);
      return;
    }

    // --- 3. Guard minimum 150px — skinsight.py:2715-2720
    let { x: fx, y: fy, w: fw, h: fh } = det.box;
    if (fw < 150) {
      const pad = Math.floor((150 - fw) / 2);
      fx = Math.max(0, fx - pad);
      fy = Math.max(0, fy - pad);
      fw = Math.min(W - fx, fw + pad * 2);
      fh = Math.min(H - fy, fh + pad * 2);
    }
    const box = { x: fx, y: fy, w: fw, h: fh };

    // --- 4. Kumpulkan 30 crop wajah dari video
    showProgress('Mengambil ' + FRAMES + ' frame…', 0.18);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = fw;
    cropCanvas.height = fh;
    const cctx = cropCanvas.getContext('2d', { willReadFrequently: true });

    const crops = [];
    for (let i = 0; i < FRAMES; i++) {
      cctx.drawImage(video, fx, fy, fw, fh, 0, 0, fw, fh);
      crops.push(cctx.getImageData(0, 0, fw, fh).data.buffer);
      showProgress('Mengambil ' + FRAMES + ' frame…', 0.18 + 0.17 * ((i + 1) / FRAMES));
      if (i < FRAMES - 1) await nextVideoFrame(video);
    }

    // --- 5. Worker: CLAHE + rule-based + inferensi ensemble
    showProgress('Menjalankan model…', 0.38);
    const res = await sendToWorker({
      type: 'analyze',
      crops,
      w: fw,
      h: fh,
    }, crops);
    

    // --- 6. Agregasi & render
    showProgress('Menggabungkan hasil…', 0.95);
    const result = aggregateResults(res.predictions, res.ruleScores, CLASS_NAMES);

    if (!result.ok) {
      setStatus('Confidence terlalu rendah (' + (result.maxAvg * 100).toFixed(1) + '%). Coba pencahayaan lebih terang dan wajah lebih dekat ke kamera.', true);
      return;
    }

    renderResult(result, box, full);
    showProgress('', 0);
    setStatus('Analisis selesai.');
  } catch (err) {
    console.error('[demo] capture gagal:', err);
    showProgress('', 0);
    setStatus('Analisis gagal: ' + err.message, true);
  } finally {
    state.busy = false;
    state.capturing = false;
    els.captureBtn.disabled = false;
    els.captureBtn.textContent = state.frozen ? 'Ambil Ulang' : 'Capture & Analisis';
    
  }
}

/* ──────────────────────────────────────────────────────────────
   KOMUNIKASI WORKER
   ────────────────────────────────────────────────────────────── */

let msgSeq = 0;
const pending = new Map();

/** Listener pesan worker — dipasang sekali worker dibuat. */
/** Listener pesan worker — dipasang sekali worker dibuat. */
function attachWorkerListener(worker) {
  worker.addEventListener('message', (e) => {
    const d = e.data;
    if (d.type === 'detected' || d.type === 'analyzed') {
      const p = pending.get(d.id);
      if (p) {
        pending.delete(d.id);
        p.resolve(d);
      }
    } else if (d.type === 'progress') {
      showProgress('Menjalankan model… ' + d.done + '/' + d.total, 0.38 + 0.55 * (d.done / d.total));
    } else if (d.type === 'error') {
      const all = Array.from(pending.values());
      pending.clear();
      all.forEach((p) => p.reject(new Error(d.message)));
    }
  });
}

function sendToWorker(payload, transfer) {
  const id = ++msgSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    state.worker.postMessage(Object.assign({ id }, payload), transfer || []);
  });
}


/* ──────────────────────────────────────────────────────────────
   RENDER HASIL
   ────────────────────────────────────────────────────────────── */

function renderResult(result, box, sourceCanvas) {
  els.resultPanel.hidden = false;
  els.emptyState.hidden = true;

  // Badge confidence
  const maxScore = Math.max(...Object.values(result.combinedScores));
  const [confText, confBars] = confidenceLabel(maxScore);
  els.confidenceEl.innerHTML =
    '<span class="conf-bars">' + confBars + '</span><b>' + confText + '</b>';

  // Kartu 9 kondisi
  els.conditionsEl.innerHTML = result.allResults.map(([name, score]) => {
    const rgb = CONDITION_COLOR_RGB[name] || [120, 120, 120];
    const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    const sev = severityLabel(score);
    const pct = Math.min(100, Math.round(score * 100));
    const modelPct = (result.avgPred[CLASS_NAMES.indexOf(name)] * 100).toFixed(1);
    return '' +
      '<div class="cond" style="--c:' + hex + '">' +
        '<div class="cond-head"><span class="dot"></span><b>' + cap(name) + '</b>' +
        '<span class="sev">' + sev + '</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="cond-foot"><span>' + pct + '%</span>' +
        '<span>model ' + modelPct + '%</span></div>' +
      '</div>';
  }).join('');

  // Rekomendasi
  const names = result.filtered.map((x) => x[0]);
  const combo = matchCombo(names);
  let html = '';

  if (combo) {
    html += '<div class="combo"><b>' + combo.judul + '</b>';
    html += listBlock('Kandungan Aktif yang Direkomendasikan', combo.aktif);
    html += listBlock('Yang Perlu Dihindari', combo.hindari);
    html += listBlock('Gaya Hidup & Kebiasaan Pendukung', combo.gaya_hidup);
    html += '</div>';

    // Kondisi di luar kombinasi — skinsight.py:1672-1682
    const inCombo = new Set(combo.members);
    for (const [name] of result.filtered) {
      if (inCombo.has(name) || !RECO[name]) continue;
      const r = RECO[name];
      html += '<div class="extra"><b>Rekomendasi tambahan: ' + cap(name) + '</b>';
      html += listBlock('Kandungan aktif', r.aktif.slice(0, 3));
      html += listBlock('Gaya hidup', r.gaya_hidup.slice(0, 3));
      html += '</div>';
    }
  } else {
    for (const [name, val] of result.filtered) {
      const r = RECO[name];
      const sev = severityLabel(val);
      html += '<div class="cond-reco"><b>' + cap(name) + ' <span class="sev">' + sev + '</span></b>';
      if (r) {
        html += listBlock('Kandungan aktif', r.aktif);
        html += listBlock('Yang perlu dihindari', r.hindari);
        html += listBlock('Gaya hidup & pendukung', r.gaya_hidup);
      } else {
        html += '<p class="expl">' + getExplanation(name) + '</p>';
      }
      html += '</div>';
    }
  }
  els.recoEl.innerHTML = html;

  // Penjelasan kondisi utama
  const top = result.filtered.length ? result.filtered[0][0] : 'normal';
  els.explainEl.innerHTML = '<b>' + cap(top) + '</b><p>' + getExplanation(top) + '</p>';

  // Overlay anotasi
  drawAnnotated(sourceCanvas, box, result.annotationResults);
  els.annotImg.src = els.canvas.toDataURL('image/jpeg', 0.9);
  els.annotImg.hidden = false;
}

function listBlock(title, items) {
  if (!items || !items.length) return '';
  return '<div class="blk"><h4>' + title + '</h4><ul>' +
    items.map((x) => '<li>' + x + '</li>').join('') + '</ul></div>';
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Overlay anotasi zona wajah — meniru annotate_face_image (skinsight.py:537).
 * Zona digambar sebagai elips + alpha blend di canvas 2D (bukan OpenCV),
 * karena OpenCV ada di worker.
 */
function drawAnnotated(sourceCanvas, box, annotationResults) {
  const ctx = els.ctx;
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  if (!vw) return;

  els.canvas.width = vw;
  els.canvas.height = vh;
  ctx.drawImage(sourceCanvas, 0, 0, vw, vh);

  const f = box;

  // Bounding box wajah — 3 lapis, skinsight.py:556-570
  ctx.strokeStyle = 'rgb(200,160,220)'; ctx.lineWidth = 2;
  ctx.strokeRect(f.x - 4, f.y - 4, f.w + 8, f.h + 8);
  ctx.strokeStyle = 'rgb(255,230,245)'; ctx.lineWidth = 1;
  ctx.strokeRect(f.x - 1, f.y - 1, f.w + 2, f.h + 2);
  ctx.strokeStyle = 'rgb(180,80,200)'; ctx.lineWidth = 2;
  ctx.strokeRect(f.x, f.y, f.w, f.h);

  if (!annotationResults) return;

  // Zona kondisi — elips + alpha (skinsight.py:575-620)
  for (const [name] of annotationResults) {
    const zones = FACE_ZONE_MAP[name] || [];
    const rgb = CONDITION_COLOR_RGB[name] || [120, 120, 120];
    const hex = 'rgb(' + rgb.join(',') + ')';

    for (const zone of zones) {
      const [rx, ry, rw, rh] = zone.rect;
      const cx = f.x + (rx + rw / 2) * f.w;
      const cy = f.y + (ry + rh / 2) * f.h;
      const ax = (rw * f.w) / 2 - 4;
      const ay = (rh * f.h) / 2 - 4;
      if (ax <= 0 || ay <= 0) continue;

      ctx.save();
      ctx.globalAlpha = zone.alpha;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.ellipse(cx, cy, ax, ay, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = hex;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, ax, ay, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = hex;
      ctx.font = '600 12px "DM Sans", sans-serif';
      ctx.fillText(zone.label, cx - ax, cy - ay - 3);
    }
  }

  // Label kondisi di bawah bounding box — skinsight.py:625+
  ctx.font = '700 13px "DM Sans", sans-serif';
  let offset = 0;
  let row = 0;
  for (const [name, score] of annotationResults) {
    const rgb = CONDITION_COLOR_RGB[name] || [120, 120, 120];
    const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    const label = cap(name) + ' ' + (score * 100).toFixed(0) + '%';
    const w = ctx.measureText(label).width + 14;
    const bx = f.x + offset;
    const by = f.y + f.h + 24 + row * 26;

    ctx.fillStyle = hex;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by - 14, w, 20, 10);
    else ctx.rect(bx, by - 14, w, 20);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + 7, by);
    offset += w + 6;
  }
}

/* ──────────────────────────────────────────────────────────────
   UI HELPERS
   ────────────────────────────────────────────────────────────── */

function setStatus(text, isError) {
  els.statusEl.textContent = text;
  els.statusEl.classList.toggle('error', !!isError);
}

function showProgress(text, pct) {
  if (!text) {
    els.progressEl.hidden = true;
    return;
  }
  els.progressEl.hidden = false;
  els.progressEl.querySelector('span').textContent = text;
  els.progressBar.style.width = Math.round(pct * 100) + '%';
}

function nextTick() {
  return new Promise((r) => setTimeout(r, 0));
}

init();
