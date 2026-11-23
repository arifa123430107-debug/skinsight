# Demo Web SkinSight

Versi web dari aplikasi desktop SkinSight. Analisis kondisi kulit wajah 9 kategori
berjalan **sepenuhnya di browser** — tidak ada server, tidak ada API, wajah tidak
pernah keluar dari perangkat pengguna.

| | |
|---|---|
| **Fitur** | Capture wajah → skor 9 kondisi → rekomendasi skincare → anotasi zona wajah |
| **Di luar scope** | Download PDF & kirim email (tetap lewat aplikasi desktop), rPPG, riwayat/tren |
| **Stack** | TensorFlow.js + `@tensorflow/tfjs-tflite`, OpenCV.js, Web Worker |
| **Model** | TFLite fp16 — EfficientNetB3 kustom (23.4 MB) + Teachable Machine (1.1 MB) |

---

## Cara menjalankan (lokal)

Butuh server HTTP — `file://` tidak bisa dipakai (WASM + CORS + worker).

```bash
# dari root repo skinsight/
python -m http.server 8899
```

Buka **http://localhost:8899/demo/**

Lalu: izinkan kamera → wajah terlihat jelas → **Capture & Analisis**.

> **Catatan:** unduhan pertama ±50 MB (model 23.4 MB + WASM OpenCV 10 MB + TFLite WASM ~11 MB).
> Proses awal (compile WASM + muat model) bisa memakan **1–3 menit**.
> Setelah itu browser meng-cache, jadi kunjungan berikutnya jauh lebih cepat.

---

## Struktur

```
demo/
├── index.html          Halaman demo (kamera + panel hasil)
├── app.js              Main thread: kamera, canvas, UI, render hasil
├── worker.js           Web Worker: OpenCV.js, TensorFlow.js, model, seluruh inferensi
├── pipeline.js         Logika agregasi murni JS (tanpa OpenCV)
├── reco.js             RECO + COMBO_RECO + penjelasan (auto-generated)
├── zones.js            FACE_ZONE_MAP + warna kondisi (auto-generated)
├── models/             Model TFLite fp16
├── haar/               haarcascade_frontalface_default.xml
├── vendor/             OpenCV.js, TensorFlow.js, WASM binaries
└── tools/              Skrip konversi & ekstraksi data
```

### Pembagian thread

| Thread | Tugas |
|---|---|
| **Main** | `getUserMedia`, pratinjau video, canvas 2D (anotasi), UI |
| **Worker** | OpenCV.js (CLAHE/LAB/HSV/Canny/Haar), TensorFlow.js, TFLite, inferensi |

OpenCV.js **harus** di worker: compile WASM-nya memblokir thread ~30 detik.
Kalau ditaruh di main thread, halaman beku total.

---

## Regenerasi artefak

### Model TFLite

```bash
python demo/tools/convert_models.py --src "C:/Users/User/Documents/peesbeh"
```

Sumber: `models/model_kulit_wajah_BEST1_79.keras` + `models/keras_model1.h5`.

> **Hati-hati:** ada dua file bernama mirip. Yang dipakai aplikasi desktop adalah
> `models/keras_model1.h5`. File `teachable_machine/keras_model.h5` adalah
> **model berbeda** (hash `f7a67001…` vs `3c9309a9…`) — jangan tertukar.

**Kenapa fp16, bukan int8:** diuji pada 25 foto capture asli —
fp16 menjaga maxdiff ensemble 0.0285 dengan argmax cocok **24/25**;
int8 dengan data representatif acak mengubah argmax **0/20** (prediksi rusak).
Int8 hanya aman kalau dikalibrasi dengan dataset asli, dan belum dilakukan.

### Data rekomendasi

```bash
python demo/tools/extract_reco.py --src "C:/Users/User/Documents/peesbeh/skinsight.py"
```

Mengambil `RECO` (9 kondisi), `COMBO_RECO` (10 kombinasi), `get_explanation` (9),
`FACE_ZONE_MAP`, `CONDITION_COLOR_RGB`, dan `class_names` langsung dari
`skinsight.py` — teks tersalin verbatim, tidak ada penulisan ulang manual.

---

## Paritas dengan aplikasi desktop

Pipeline web adalah port langsung dari `skinsight.py`. Nomor yang dipakai:

| Langkah | skinsight.py | Nilai |
|---|---|---|
| Deteksi wajah | 2709 | `detectMultiScale(gray, 1.3, 5)`, pakai `faces[0]` |
| Guard minimum | 2715–2720 | box diperluas bila lebar < 150 px |
| CLAHE | 340 | `clipLimit=1.0`, `tileGridSize=(8,8)`, channel L saja |
| Blend + brightness | 342, 349 | `0.4·l_eq + 0.6·l`, target mean 140 |
| Input model kustom | 435 | RGB float **0–255**, tanpa normalisasi eksternal |
| Input model TM | 447 | **BGR** float **0–1** (`/255`) |
| Ensemble | 455 | `0.3·TM + 0.7·custom` |
| Snapshot | 43 | 30 frame, rata-rata **prediksi** (bukan gambar) |
| Fusion rule | 4985 | `0.75·model + 0.25·rule` |
| Ambang | 4989, 5002–5013 | gate 0.18 · primer 0.25 (3) · sekunder 0.15 (2) · anotasi 0.12 (5) |

> Normalisasi ImageNet **ada di dalam graph** model kustom
> (`Rescaling 1/255 → Normalization(mean,variance) → Rescaling 1/std`).
> Efek bersihnya `x = (x/255 − mean) / variance`. **Jangan normalisasi manual di JS** —
> angka akan salah.

### Konvensi kanal OpenCV.js

OpenCV.js *mungkin* menyimpan Mat 3-channel sebagai RGB, bukan BGR seperti
OpenCV native. Menebak salah = seluruh konversi warna (Lab, HSV, gray) jadi
salah diam-diam, dan tidak akan muncul error.

Karena itu `worker.js` **mengukur** konvensinya sendiri saat start-up
(`probeColorConvention()`): piksel `[255,0,0]` di-convert ke abu-abu dengan
`COLOR_RGB2GRAY` dan `COLOR_BGR2GRAY`. Nilai yang benar untuk merah adalah 76,
untuk biru 29 — dari situ diketahui konvensinya, lalu worker memakai konstanta
yang sesuai.

Untuk melihat hasilnya sendiri:

```bash
node demo/tools/check_convention.js
```

Hasilnya juga dicetak di console browser:

```
[worker] konvensi kanal 3-channel: BGR | probe gray(RGB2GRAY)=76 gray(BGR2GRAY)=29
```

Kalau muncul `BGR`, semua konversi di worker identik dengan OpenCV native.
Kalau `RGB`, worker sudah otomatis menyesuaikan.

---

## Deploy ke GitHub Pages

```bash
git add demo/
git commit -m "tambah demo web SkinSight"
git push origin main
```

Pages mempublish otomatis dari branch `main`.

### ⚠️ Dua hal yang perlu ditangani sebelum push

**1. Model 23.4 MB melebihi batas 10 MB GitHub Pages tanpa Git LFS.**

GitHub Pages **tidak melayani** file > 10 MB tanpa LFS — request-nya akan gagal
dengan 404, dan demo tidak bisa dipakai. Pilih salah satu:

- **Opsi A — Git LFS** (disarankan):
  ```bash
  git lfs install
  git lfs track "demo/models/*.tflite" "demo/vendor/*.wasm"
  git add .gitattributes
  ```
  Catatan: cek dulu apakah repo GitHub Pages kamu sudah mengaktifkan LFS
  (Settings → Pages → GitHub Actions). Tanpa itu, LFS hanya storing, bukan serving.

- **Opsi B — host model di luar repo** (Cloudflare R2 / jsDelivr / GitHub Release),
  lalu arahkan `worker.js` ke URL tersebut.

**2. File `.wasm` butuh header MIME yang benar.**
GitHub Pages sudah melayani `.wasm` sebagai `application/wasm`, jadi ini aman.
Bila hosting lain bermasalah, tambahkan `.nojekyll` di root repo.

> Ukuran repo saat ini ~53 MB (dominan: model 23.4 MB + vendor WASM ~27 MB).
> Pertimbangkan menghapus varian vendor yang tidak terpakai
> (`tflite_web_api_cc*.wasm` non-SIMD dan varian threaded) bila repo terlalu besar.

---

## Batasan yang perlu diketahui

- **Bukan diagnosis.** Alat skrining awal; kelas *berminyak* dan *normal* punya
  akurasi lebih rendah (0.655 dan 0.667 F1).
- **Butuh HTTPS** (atau `localhost`) — browser memblokir kamera di HTTP biasa.
- **iOS Safari** kurang andal: butuh `playsinline` (sudah ada) dankes suffers
  dari timeout WASM di perangkat lama.
- **Akurasi CLAHE** OpenCV.js bisa beda ±1–2 level dari OpenCV native — cukup
  kecil untuk tidak mengubah hasil, tapi bukan identik bit-per-bit.
- **Prediksi fp16** berbeda 1 dari 25 kasus argmax dibanding Keras native.
- Kamera dipakai **dengan izin pengguna**; tidak ada rekaman yang disimpan.
