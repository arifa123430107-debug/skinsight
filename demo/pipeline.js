/**
 * pipeline.js — Logika agregasi hasil, port dari skinsight.py (aplikasi desktop).
 *
 * File ini SENGAJA hanya berisi logika murni JavaScript (tanpa OpenCV.js).
 * Semua operasi OpenCV (CLAHE, LAB, HSV, Canny, Haar cascade) dan inferensi
 * TFLite berjalan di worker.js — compile WASM OpenCV.js memblokir thread
 * ~30 detik, jadi tidak boleh di main thread.
 *
 * Referensi baris skinsight.py:
 *   severity/confidence      :723-746
 *   agregasi hasil           :4962-5012
 *   ensemble                 :455
 */

export const IMG_SIZE = 224;
export const SNAPSHOT_FRAMES = 30;
export const CONFIDENCE_MIN = 0.18;
export const TM_WEIGHT = 0.3;
export const MY_WEIGHT = 0.7;

export const TOP_N = 3;
export const THRESHOLD = 0.25;
export const SECONDARY_TOP_N = 2;
export const SECONDARY_THRESHOLD = 0.15;
export const ANNOTATION_TOP_N = 5;
export const ANNOTATION_THRESHOLD = 0.12;

/** severity_label — skinsight.py:737 */
export function severityLabel(val) {
  if (val >= 0.70) return "Dominan";
  if (val >= 0.45) return "Moderat";
  if (val >= 0.25) return "Ringan";
  return "Minimal";
}

/** confidence_label — skinsight.py:723 */
export function confidenceLabel(val) {
  if (val >= 0.75) return ["Sangat Tinggi", "▰▰▰▰▰"];
  if (val >= 0.60) return ["Tinggi", "▰▰▰▰▱"];
  if (val >= 0.45) return ["Sedang", "▰▰▰▱▱"];
  if (val >= 0.30) return ["Cukup", "▰▰▱▱▱"];
  return ["Rendah", "▰▱▱▱▱"];
}

/**
 * Agregasi akhir — skinsight.py:4962-5012
 *
 * @param {number[][]} preds         prediksi ensemble per frame (sudah 0.3·TM+0.7·custom)
 * @param {Object<string,number>} ruleScores  skor rule-based
 * @param {string[]} classNames
 */
export function aggregateResults(preds, ruleScores, classNames) {
  const n = preds.length;
  const avgPred = new Array(classNames.length).fill(0);
  for (const p of preds) {
    for (let i = 0; i < classNames.length; i++) avgPred[i] += p[i];
  }
  for (let i = 0; i < avgPred.length; i++) avgPred[i] /= n;

  const maxAvg = Math.max(...avgPred);

  // Confidence gate — skinsight.py:4989
  if (maxAvg < CONFIDENCE_MIN) {
    return { ok: false, reason: "low_confidence", maxAvg, avgPred, ruleScores };
  }

  // 0.75 * model + 0.25 * rule — skinsight.py:4982-4987
  const combinedScores = {};
  for (let i = 0; i < classNames.length; i++) {
    const name = classNames[i];
    combinedScores[name] = 0.75 * avgPred[i] + 0.25 * (ruleScores[name] || 0.0);
  }

  const allResults = Object.entries(combinedScores).sort((a, b) => b[1] - a[1]);

  // Primer: top 3 dengan skor >= 0.25, fallback top 3 — skinsight.py:5006-5008
  let filtered = allResults.filter((x) => x[1] >= THRESHOLD);
  filtered = filtered.length ? filtered.slice(0, TOP_N) : allResults.slice(0, TOP_N);

  // Sekunder: 2 berikutnya di luar primer, skor >= 0.15 — skinsight.py:5009-5013
  const primaryNames = new Set(filtered.map((x) => x[0]));
  const secondaryFiltered = allResults
    .filter((x) => !primaryNames.has(x[0]) && x[1] >= SECONDARY_THRESHOLD)
    .slice(0, SECONDARY_TOP_N);

  // Overlay anotasi: top 5, skor >= 0.12 — skinsight.py:5042-5046
  const annotationResults = allResults
    .filter((x) => x[1] >= ANNOTATION_THRESHOLD)
    .slice(0, ANNOTATION_TOP_N);

  return {
    ok: true,
    avgPred,
    combinedScores,
    allResults,
    filtered,
    secondaryFiltered,
    annotationResults,
    maxAvg,
  };
}
