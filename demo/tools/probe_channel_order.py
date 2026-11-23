"""
Tentukan semantik kanal OpenCV.js secara STATIS, dari bytecode WASM.

Ide: konstanta COLOR_BGR2GRAY dan COLOR_RGB2GRAY punya nilai numerik berbeda
di C++ OpenCV:
    COLOR_BGR2GRAY  = 6
    COLOR_RGB2GRAY  = 7
Konversi grayscale BGR: 0.299R + 0.587G + 0.114B

Tapi kita tidak bisa menjalankan. Yang bisa kita lakukan: cari string
nama fungsi "cvtColor" dan lihat apakah ada petunjuk channel order di
kode JS pembungkus.

Alternatif yang lebih andal: OpenCV.js didokumentasikan memakai RGBA
sebagai format native (cv::Mat dengan CV_8UC3 di OpenCV.js sebenarnya
menyimpan RGB). Kita bisa memastikan lewat salah satu konstanta:
kalau OpenCV.js memakai semantik RGB, maka cvtColor(src, dst, COLOR_BGR2GRAY)
berbeda hasilnya dari COLOR_RGB2GRAY, dan "imshow" memakai COLOR_RGB2RGBA
untuk CV_8UC3 — itu sudah jadi petunjuk kuat.

Mari kita periksa apakah ada fungsi JS yang eksplisit menukar kanal.
"""
import base64
import re
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "vendor"
src = (VENDOR / "opencv.js").read_text(encoding="utf-8", errors="replace")
m = re.search(r"data:application/octet-stream;base64,([A-Za-z0-9+/=]+)", src)
wasm = base64.b64decode(m.group(1)) if m else b""

print("WASM bytes:", len(wasm))

# Cari function name table: nama-nama seperti "cvtColor", "cvtColorTwoPlane"
# yang di-embed sebagai string di WASM (nama simbol C++).
names = set(re.findall(rb"[A-Za-z_][A-Za-z0-9_]{3,40}", wasm))
interest = [
    b"cvtColor", b"cvtColorTwoPlane", b"cvtColorBGR2GRAY",
    b"RGBA2BGR", b"BGR2RGBA", b"COLOR_BGR2GRAY", b"COLOR_RGB2GRAY",
    b"cv::cvtColor", b"cv::Mat", b"tobytes", b"frombytes",
]
print("\n=== simbol kunci ===")
for sym in interest:
    print(f"  {'OK  ' if sym in names else 'tidak'} {sym.decode()}")

# Cari nama fungsi yang mengandung "RGBA" atau "BGR"
rgba_syms = sorted(n.decode() for n in names if b"RGBA" in n or b"BGR" in n)
print(f"\n=== simbol dengan RGBA/BGR ({len(rgba_syms)}) ===")
for s in rgba_syms[:40]:
    print("  ", s)

# Apakah ada konstanta CV_8UC3 = 16 di WASM (dipakai saat membuat mat)?
print("\n=== 'CV_8UC3' string ===")
print("  ditemukan:", b"CV_8UC3" in names)
print("=== 'COLOR_BGR2GRAY' string ===")
print("  ditemukan:", b"COLOR_BGR2GRAY" in names)
