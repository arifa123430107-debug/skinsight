"""
Daftar semua konstanta konversi warna terkait Lab/HSV/GRAY yang tersedia
di OpenCV.js (WASM), supaya bisa dipilih probe runtime yang benar.
"""
import base64
import re
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "vendor"

src = (VENDOR / "opencv.js").read_text(encoding="utf-8", errors="replace")
m = re.search(r"data:application/octet-stream;base64,([A-Za-z0-9+/=]+)", src)
text = base64.b64decode(m.group(1)).decode("latin1") if m else src

all_colors = sorted(set(re.findall(r"COLOR_[A-Za-z0-9_]+", text)))

print("=== Konstanta Lab ===")
for c in all_colors:
    if "Lab" in c or "LAB" in c:
        print("  ", c)

print("\n=== Konstanta HSV ===")
for c in all_colors:
    if "HSV" in c:
        print("  ", c)

print("\n=== Konstanta GRAY (semua) ===")
for c in all_colors:
    if "GRAY" in c:
        print("  ", c)

print("\n=== Konstanta 2BGR / 2RGB ===")
for c in all_colors:
    if c.endswith("2BGR") or c.endswith("2RGB"):
        print("  ", c)
