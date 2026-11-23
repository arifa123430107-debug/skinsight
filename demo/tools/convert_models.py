"""
convert_models.py — Konversi model Keras SkinSight ke TFLite fp16 untuk web demo.

Menghasilkan dua file .tflite yang dipakai demo/ di browser:
  - model_efb3_fp16.tflite  (dari model_kulit_wajah_BEST1_79.keras, ~23 MB)
  - model_tm_fp16.tflite    (dari keras_model1.h5,                 ~1.1 MB)

Kenapa fp16 dan bukan int8:
  Diuji pada 25 gambar capture asli — int8 dengan data representatif acak
  mengubah argmax pada 20/20 gambar (prediksi jadi tidak sinkron dengan
  aplikasi desktop). fp16 menjaga maxdiff ensemble 0.0285 dengan
  argmax cocok 24/25. Jadi TFLite untuk web pakai fp16.

Pakai:
    python demo/tools/convert_models.py
    python demo/tools/convert_models.py --src "C:/path/ke/peesbeh"

Butuh: tensorflow==2.15.0 (dari requirements.txt proyek).
"""

import argparse
import os
import sys
import time

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

DEFAULT_SRC = r"C:\Users\User\Documents\peesbeh"

# (nama sumber relatif ke SRC, nama output di demo/models/)
JOBS = [
    (os.path.join("models", "model_kulit_wajah_BEST1_79.keras"), "model_efb3_fp16.tflite"),
    (os.path.join("models", "keras_model1.h5"),                 "model_tm_fp16.tflite"),
]


def convert(src_dir: str, out_dir: str) -> int:
    import tensorflow as tf

    os.makedirs(out_dir, exist_ok=True)

    for rel, out_name in JOBS:
        src = os.path.join(src_dir, rel)
        dst = os.path.join(out_dir, out_name)

        if not os.path.exists(src):
            print(f"[LEWATI] {src} tidak ditemukan")
            continue

        print(f"\n{'=' * 64}")
        print(f"Sumber : {src}")
        print(f"Tujuan : {dst}")
        print(f"Ukuran sumber: {os.path.getsize(src) / 1e6:.1f} MB")

        model = tf.keras.models.load_model(src, compile=False)
        print(f"Params : {model.count_params():,}")
        print(f"Input  : {model.inputs[0].shape.as_list()}")
        print(f"Output : {model.outputs[0].shape.as_list()}")

        t0 = time.time()
        converter = tf.lite.TFLiteConverter.from_keras_model(model)
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.target_spec.supported_types = [tf.float16]
        flatbuffer = converter.convert()

        with open(dst, "wb") as f:
            f.write(flatbuffer)

        # Verifikasi interpreter bisa load + jalankan
        interp = tf.lite.Interpreter(model_path=dst)
        interp.allocate_tensors()
        inp = interp.get_input_details()[0]
        out = interp.get_output_details()[0]

        print(f"-> OK   : {len(flatbuffer) / 1e6:.1f} MB  ({time.time() - t0:.1f} dtk)")
        print(f"   input : {inp['shape'].tolist()} {inp['dtype'].__name__}")
        print(f"   output: {out['shape'].tolist()} {out['dtype'].__name__}")

        # Laporkan op custom/Flex — kalau muncul, tfjs-tflite tidak bisa jalankan
        flex = sorted({d["op_name"] for d in interp._get_ops_details() if "Flex" in d["op_name"]})
        if flex:
            print(f"   PERINGATAN: ada Flex/custom op: {flex}")
            return 1

    print(f"\nSelesai. Semua model TFLite ada di: {os.path.abspath(out_dir)}")
    return 0


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    demo_dir = os.path.dirname(here)          # demo/
    repo_dir = os.path.dirname(demo_dir)       # root repo

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--src", default=DEFAULT_SRC, help="Folder sumber model (default: %s)" % DEFAULT_SRC)
    p.add_argument("--out", default=os.path.join(demo_dir, "models"), help="Folder output TFLite")
    args = p.parse_args()

    if not os.path.isdir(args.src):
        print(f"ERROR: folder sumber tidak ditemukan: {args.src}")
        print("Gunakan --src untuk menunjuk folder yang berisi models/")
        return 2

    print(f"Sumber model : {args.src}")
    print(f"Output       : {args.out}")
    print(f"Repo         : {repo_dir}")

    return convert(args.src, args.out)


if __name__ == "__main__":
    sys.exit(main())
