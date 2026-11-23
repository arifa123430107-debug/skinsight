"""
extract_reco.py — Ekstrak data rekomendasi & anotasi dari skinsight.py ke JS.

Membaca source aplikasi desktop (skinsight.py) dan menulis:
  demo/reco.js   -> RECO, COMBO_RECO, get_explanation
  demo/zones.js  -> FACE_ZONE_MAP, CONDITION_COLOR_RGB, class_names, ambang skor

Cara kerja: blok Python yang diambil diekstrak sebagai teks lalu dievaluasi
dengan exec() di namespace terbatas. Jadi teks rekomendasi tersalin verbatim —
tidak ada penulisan ulang manual yang bisa_typo.

Pakai:
    python demo/tools/extract_reco.py
    python demo/tools/extract_reco.py --src "C:/path/ke/skinsight.py"
"""

import argparse
import ast
import json
import os
import sys

DEFAULT_SRC = r"C:\Users\User\Documents\peesbeh\skinsight.py"

HEADER = """// AUTO-GENERATED oleh demo/tools/extract_reco.py — jangan diedit manual.
// Sumber: skinsight.py (aplikasi desktop SkinSight). Teks verbatim.
"""


def load_source(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _literal(node):
    """
    ast.literal_eval yang toleran terhadap frozenset([...]) sebagai key.

    COMBO_RECO memakai frozenset(["a","b"]) sebagai key — itu pemanggilan
    fungsi, bukan literal, jadi literal_eval biasa gagal. Kita buka panggilannya
    dan ambil isi list-nya.
    """
    if isinstance(node, ast.Dict):
        out = {}
        for key_node, val_node in zip(node.keys, node.values):
            if isinstance(key_node, ast.Call):
                func = key_node.func
                fname = getattr(func, "id", None) or getattr(func, "attr", None)
                if fname in ("frozenset", "set", "tuple", "list"):
                    # Argumennya satu list, mis. frozenset(["a", "b"])
                    parts = []
                    for arg in key_node.args:
                        if isinstance(arg, (ast.List, ast.Tuple)):
                            parts.extend(ast.literal_eval(e) for e in arg.elts)
                        else:
                            parts.append(ast.literal_eval(arg))
                    key = tuple(parts)
                else:
                    raise ValueError(f"Call tak didukung sebagai key: {fname}")
            else:
                key = ast.literal_eval(key_node)
            out[key] = _literal(val_node)
        return out

    if isinstance(node, (ast.Tuple, ast.List)):
        return [_literal(elt) for elt in node.elts]

    return ast.literal_eval(node)


def extract_assignment(src, name):
    """Ambil nilai literal dari assignment Python: NAME = {...} atau NAME = {...}"""
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return _literal(node.value)
    raise KeyError(f"Assignment '{name}' tidak ditemukan di source")


def extract_function_dict(src, func_name):
    """
    Ambil dict literal yang dikembalikan sebuah fungsi.

    Bentuk yang ditangani:
        return { "berjerawat": (...), ... }
        return { "berjerawat": (...), ... }.get(label, "fallback")
    """
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            for sub in ast.walk(node):
                if not isinstance(sub, ast.Return):
                    continue
                val = sub.value
                if isinstance(val, ast.Dict):
                    return _literal(val)
                # { ... }.get(label, fallback) -> ambil dict-nya
                if isinstance(val, ast.Call) and isinstance(val.func, ast.Attribute):
                    if val.func.attr == "get" and isinstance(val.func.value, ast.Dict):
                        return _literal(val.func.value)
    raise KeyError(f"Dict literal di fungsi '{func_name}' tidak ditemukan")


def js_str(value):
    """JSON string -> JS string literal (JSON syntax valid untuk JS juga)."""
    return json.dumps(value, ensure_ascii=False)


def write_reco(reco, combo, explanation, out_path):
    """RECO & COMBO_RECO: dict of dict of list[str]. Explanation: dict of str."""
    parts = [HEADER]

    parts.append("export const RECO = {")
    for label, blocks in reco.items():
        parts.append(f"  {js_str(label)}: {{")
        for block in ("aktif", "hindari", "gaya_hidup"):
            items = blocks.get(block, [])
            parts.append(f"    {block}: [")
            for item in items:
                parts.append(f"      {js_str(item)},")
            parts.append("    ],")
        parts.append("  },")
    parts.append("};")
    parts.append("")

    parts.append("// Kombinasi kondisi. Urutan array = urutan insertion dict di Python,")
    parts.append("// jadi combo pertama yang cocok menang — sama seperti .issubset() di desktop.")
    parts.append("export const COMBO_RECO = [")
    for key, blocks in combo.items():
        # key adalah frozenset — di Python jadi tuple. Urutan tidak penting karena
        # pencocokan memakai .issubset() seperti di aplikasi desktop.
        combo_key = sorted(key)
        parts.append(f"  {{ members: {json.dumps(combo_key, ensure_ascii=False)}, judul: {js_str(blocks.get('judul', ''))},")
        for block in ("aktif", "hindari", "gaya_hidup"):
            items = blocks.get(block, [])
            parts.append(f"    {block}: [")
            for item in items:
                parts.append(f"      {js_str(item)},")
            parts.append("    ],")
        parts.append("  },")
    parts.append("];")
    parts.append("")

    parts.append("export const EXPLANATIONS = {")
    for label, text in explanation.items():
        parts.append(f"  {js_str(label)}: {js_str(text)},")
    parts.append("};")
    parts.append("")

    parts.append("""export function getExplanation(label) {
  return EXPLANATIONS[label] ||
    "Teridentifikasi kondisi kulit yang memerlukan perhatian lebih lanjut. Disarankan untuk berkonsultasi dengan dokter spesialis kulit agar evaluasi lebih akurat.";
}

/**
 * Pencocokan kombinasi kondisi — meniru logika Python:
 *   for combo_key, combo_val in COMBO_RECO.items():
 *       if combo_key.issubset(names_set): return combo_val
 * Combo pertama yang cocok menang (urutan array menjaga urutan insertion dict).
 */
export function matchCombo(names) {
  const set = new Set(names);
  for (const combo of COMBO_RECO) {
    if (combo.members.every((m) => set.has(m))) return combo;
  }
  return null;
}""")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts) + "\n")


def write_zones(zone_map, colors, class_names, out_path):
    parts = [HEADER]
    parts.append("export const CLASS_NAMES = " + json.dumps(class_names, ensure_ascii=False) + ";")
    parts.append("")
    parts.append("// Proporsi (x, y, w, h) relatif terhadap kotak wajah, warna BGR, alpha.")
    parts.append("export const FACE_ZONE_MAP = {")
    for label, zones in zone_map.items():
        parts.append(f"  {js_str(label)}: [")
        for z in zones:
            rect = z["rect"]
            parts.append(
                "    { label: %s, rect: [%s, %s, %s, %s], color: [%s, %s, %s], alpha: %s },"
                % (
                    js_str(z["label"]),
                    repr(rect[0]), repr(rect[1]), repr(rect[2]), repr(rect[3]),
                    z["color"][0], z["color"][1], z["color"][2],
                    repr(z["alpha"]),
                )
            )
        parts.append("  ],")
    parts.append("};")
    parts.append("")
    parts.append("// RGB untuk UI (hex), konversi BGR OpenCV ada di app.js.")
    parts.append("export const CONDITION_COLOR_RGB = {")
    for label, rgb in colors.items():
        parts.append(f"  {js_str(label)}: [{rgb[0]}, {rgb[1]}, {rgb[2]}],  // #{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}")
    parts.append("};")
    parts.append("")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts) + "\n")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    demo_dir = os.path.dirname(here)

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--src", default=DEFAULT_SRC, help="Path ke skinsight.py")
    p.add_argument("--out", default=demo_dir, help="Folder output JS")
    args = p.parse_args()

    if not os.path.exists(args.src):
        print(f"ERROR: source tidak ditemukan: {args.src}")
        return 2

    print(f"Sumber  : {args.src}")
    print(f"Output  : {args.out}")

    src = load_source(args.src)

    reco = extract_assignment(src, "RECO")
    combo = extract_assignment(src, "COMBO_RECO")
    explanation = extract_function_dict(src, "get_explanation")
    zones = extract_assignment(src, "FACE_ZONE_MAP")
    colors = extract_assignment(src, "CONDITION_COLOR_RGB")
    class_names = extract_assignment(src, "class_names")

    print(f"\nRECO          : {len(reco)} kondisi")
    print(f"COMBO_RECO    : {len(combo)} kombinasi")
    print(f"get_explanation: {len(explanation)} kondisi")
    print(f"FACE_ZONE_MAP : {len(zones)} kondisi")
    print(f"CONDITION_COLOR_RGB: {len(colors)} warna")
    print(f"class_names   : {len(class_names)} -> {class_names}")

    write_reco(reco, combo, explanation, os.path.join(args.out, "reco.js"))
    write_zones(zones, colors, class_names, os.path.join(args.out, "zones.js"))

    for name in ("reco.js", "zones.js"):
        path = os.path.join(args.out, name)
        print(f"  -> {path} ({os.path.getsize(path) / 1024:.1f} KB)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
