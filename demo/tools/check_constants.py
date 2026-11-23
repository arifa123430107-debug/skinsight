"""
Cek konstanta & fungsi OpenCV.js yang dipakai worker.js benar-benar ada di WASM.
Membaca file sebagai teks dan decode payload base64 — TIDAK mengeksekusi apa pun.
"""
import base64
import re
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "vendor"

# Semua cv.* yang dipakai worker.js
USED_FUNCS = [
    "cvtColor", "addWeighted", "extractChannel", "meanStdDev", "merge", "mean",
    "compare", "convertTo", "Canny", "resize", "split", "bitwise_and", "min", "max",
    "rectangle", "ellipse", "GaussianBlur", "CascadeClassifier", "detectMultiScale",
    "Mat", "Rect", "Size", "Scalar", "Point", "RectVector", "CLAHE", "FS",
]
USED_CONSTS = [
    "COLOR_BGR2Lab", "COLOR_Lab2BGR", "COLOR_BGR2RGB", "COLOR_BGR2HSV",
    "COLOR_BGR2GRAY", "COLOR_RGBA2GRAY", "COLOR_RGBA2BGR", "COLOR_RGB2GRAY",
    "CMP_GT", "CMP_LT", "CV_8U", "CV_32F", "CV_8UC1", "CV_8UC3", "CV_8UC4",
    "INTER_LINEAR",
]


def load_wasm_text(path):
    src = path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"data:application/octet-stream;base64,([A-Za-z0-9+/=]+)", src)
    if m:
        return base64.b64decode(m.group(1)).decode("latin1")
    return src


def main():
    cvjs = VENDOR / "opencv.js"
    print(f"Membaca {cvjs.name} ({cvjs.stat().st_size / 1e6:.1f} MB)...")

    text = load_wasm_text(cvjs)
    print(f"Teks WASM: {len(text):,} karakter\n")

    missing = []

    print("=== FUNGSI ===")
    for fn in USED_FUNCS:
        found = fn in text
        print(f"  {'OK  ' if found else 'HILANG'} {fn}")
        if not found:
            missing.append(fn)

    print("\n=== KONSTANTA ===")
    for c in USED_CONSTS:
        found = c in text
        print(f"  {'OK  ' if found else 'HILANG'} {c}")
        if not found:
            missing.append(c)

    # Daftar semua konstanta RGBA* yang tersedia (referensi)
    print("\n=== Semua konstanta RGBA* yang tersedia ===")
    rgbas = sorted(set(re.findall(r"COLOR_RGBA2[A-Z0-9_]+", text)))
    print("  " + "\n  ".join(rgbas) if rgbas else "  (tidak ada)")

    print("\n=== Semua konstanta *_2GRAY ===")
    grays = sorted(set(re.findall(r"COLOR_[A-Z0-9_]+2GRAY", text)))
    print("  " + "\n  ".join(grays) if grays else "  (tidak ada)")

    print("\n=== INTER_LINEAR / RESIZE flags ===")
    for f in ["INTER_LINEAR", "INTER_AREA", "INTER_NEAREST"]:
        print(f"  {'OK  ' if f in text else 'HILANG'} {f}")

    if missing:
        print(f"\n*** {len(missing)} HAL TIDAK DITEMUKAN: {missing}")
        return 1
    print("\nSemua simbol yang dipakai tersedia.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
