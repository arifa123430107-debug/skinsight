// AUTO-GENERATED oleh demo/tools/extract_reco.py — jangan diedit manual.
// Sumber: skinsight.py (aplikasi desktop SkinSight). Teks verbatim.

export const CLASS_NAMES = ["berjerawat", "berminyak", "flek hitam", "kemerahan", "kering", "kerutan", "komedo", "mata panda", "normal"];

// Proporsi (x, y, w, h) relatif terhadap kotak wajah, warna BGR, alpha.
export const FACE_ZONE_MAP = {
  "berjerawat": [
    { label: "Dahi", rect: [0.15, 0.05, 0.7, 0.28], color: [60, 60, 220], alpha: 0.28 },
    { label: "Pipi", rect: [0.05, 0.45, 0.38, 0.35], color: [60, 60, 220], alpha: 0.28 },
    { label: "Pipi", rect: [0.57, 0.45, 0.38, 0.35], color: [60, 60, 220], alpha: 0.28 },
    { label: "Dagu", rect: [0.25, 0.78, 0.5, 0.18], color: [60, 60, 220], alpha: 0.28 },
  ],
  "berminyak": [
    { label: "T-Zone", rect: [0.35, 0.05, 0.3, 0.6], color: [0, 180, 200], alpha: 0.22 },
    { label: "Hidung", rect: [0.3, 0.38, 0.4, 0.25], color: [0, 180, 200], alpha: 0.25 },
  ],
  "kering": [
    { label: "Pipi", rect: [0.05, 0.38, 0.35, 0.38], color: [180, 100, 40], alpha: 0.22 },
    { label: "Pipi", rect: [0.6, 0.38, 0.35, 0.38], color: [180, 100, 40], alpha: 0.22 },
    { label: "Dahi", rect: [0.18, 0.04, 0.64, 0.24], color: [180, 100, 40], alpha: 0.18 },
  ],
  "kerutan": [
    { label: "Dahi", rect: [0.12, 0.04, 0.76, 0.22], color: [130, 60, 160], alpha: 0.22 },
    { label: "Mata-Kiri", rect: [0.08, 0.3, 0.28, 0.14], color: [130, 60, 160], alpha: 0.22 },
    { label: "Mata-Kanan", rect: [0.64, 0.3, 0.28, 0.14], color: [130, 60, 160], alpha: 0.22 },
    { label: "Senyum", rect: [0.1, 0.7, 0.38, 0.2], color: [130, 60, 160], alpha: 0.18 },
    { label: "Senyum", rect: [0.52, 0.7, 0.38, 0.2], color: [130, 60, 160], alpha: 0.18 },
  ],
  "kemerahan": [
    { label: "Pipi", rect: [0.05, 0.4, 0.36, 0.36], color: [40, 60, 210], alpha: 0.28 },
    { label: "Pipi", rect: [0.59, 0.4, 0.36, 0.36], color: [40, 60, 210], alpha: 0.28 },
    { label: "Hidung", rect: [0.33, 0.36, 0.34, 0.26], color: [40, 60, 210], alpha: 0.25 },
  ],
  "komedo": [
    { label: "Hidung", rect: [0.3, 0.37, 0.4, 0.26], color: [60, 60, 60], alpha: 0.32 },
    { label: "Dagu", rect: [0.28, 0.78, 0.44, 0.18], color: [60, 60, 60], alpha: 0.25 },
    { label: "Dahi", rect: [0.2, 0.04, 0.6, 0.18], color: [60, 60, 60], alpha: 0.2 },
  ],
  "mata panda": [
    { label: "Mata-Kiri", rect: [0.06, 0.32, 0.34, 0.16], color: [80, 40, 120], alpha: 0.3 },
    { label: "Mata-Kanan", rect: [0.6, 0.32, 0.34, 0.16], color: [80, 40, 120], alpha: 0.3 },
  ],
  "flek hitam": [
    { label: "Pipi", rect: [0.08, 0.38, 0.32, 0.32], color: [50, 80, 160], alpha: 0.26 },
    { label: "Pipi", rect: [0.6, 0.38, 0.32, 0.32], color: [50, 80, 160], alpha: 0.26 },
    { label: "Dahi", rect: [0.2, 0.04, 0.6, 0.2], color: [50, 80, 160], alpha: 0.2 },
  ],
  "normal": [
  ],
};

// RGB untuk UI (hex), konversi BGR OpenCV ada di app.js.
export const CONDITION_COLOR_RGB = {
  "berjerawat": [220, 60, 60],  // #DC3C3C
  "berminyak": [20, 160, 200],  // #14A0C8
  "kering": [180, 100, 40],  // #B46428
  "kerutan": [140, 60, 180],  // #8C3CB4
  "kemerahan": [210, 60, 40],  // #D23C28
  "komedo": [80, 80, 80],  // #505050
  "mata panda": [80, 40, 160],  // #5028A0
  "flek hitam": [130, 80, 40],  // #825028
  "normal": [40, 160, 80],  // #28A050
};

