"""기존 .keras 파일을 사용하는 CPU 전용 OCR 실행기."""
import os

# TensorFlow와 eDOCr2를 불러오기 전에 설정한다.
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import argparse
import shutil
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

parser = argparse.ArgumentParser(
    description="eDOCr2 CPU OCR / NPZ 미사용"
)
parser.add_argument(
    "input",
    nargs="?",
    help="PDF/이미지 절대경로 또는 data/input 안의 파일명",
)
parser.add_argument(
    "--check-models",
    action="store_true",
    help="도면 처리 없이 두 모델의 로딩과 CPU 추론만 검사",
)
parser.add_argument(
    "--output-dir",
    type=Path,
    help="결과 저장 폴더",
)
parser.add_argument(
    "--tesseract",
    help="tesseract.exe 전체 경로",
)
parser.add_argument(
    "--poppler",
    help="Poppler bin 폴더 경로",
)

args = parser.parse_args()

models_dir = ROOT / "edocr2" / "edocr2" / "tools" / "models"

for name in ("recognizer_dimensions_2", "recognizer_gdts"):
    for suffix in (".keras", ".txt"):
        path = models_dir / (name + suffix)

        if not path.is_file():
            parser.error(f"모델/문자 파일 없음: {path}")


import cv2
import numpy as np
import pytesseract
import tensorflow as tf
from pdf2image import convert_from_path

tf.config.set_visible_devices([], "GPU")

from edocr2 import tools
from edocr2.keras_ocr.detection import Detector
from edocr2.keras_ocr.recognition import Recognizer
from keras3_weights import load_keras3_weights


print(
    f"[CPU] TensorFlow {tf.__version__} / NPZ 미사용",
    flush=True,
)


def load_recognizer(name):
    model_base = models_dir / name

    alphabet = tools.ocr_pipelines.read_alphabet(
        str(model_base)
    )

    # 기본 범용 인식 가중치 다운로드 없이 구조만 만든다.
    recognizer = Recognizer(
        alphabet=alphabet,
        weights=None,
    )

    load_keras3_weights(
        recognizer.training_model,
        models_dir / (name + ".keras"),
    )

    return recognizer, alphabet


if args.check_models:
    for name in (
        "recognizer_dimensions_2",
        "recognizer_gdts",
    ):
        tf.keras.backend.clear_session()

        recognizer, alphabet = load_recognizer(name)
        shape = recognizer.model.input_shape

        sample = np.zeros(
            (1, *shape[1:]),
            dtype=np.float32,
        )

        result = recognizer.model(
            sample,
            training=False,
        ).numpy()

        if not np.isfinite(result).all():
            raise ValueError(
                f"{name}: 추론 결과에 유효하지 않은 숫자가 있습니다."
            )

        print(
            f"[FORWARD OK] {name}: {result.shape}",
            flush=True,
        )

    print(
        "[DONE] 두 모델의 로딩·CPU 추론 검사 완료. "
        "도면과 DB는 변경하지 않았습니다.",
        flush=True,
    )

    raise SystemExit(0)


if not args.input:
    parser.error(
        "입력 파일을 지정하거나 --check-models를 사용하세요."
    )

input_path = Path(args.input)

if not input_path.is_absolute():
    input_path = ROOT / "data" / "input" / input_path

if not input_path.is_file():
    parser.error(f"입력 파일 없음: {input_path}")

language = "eng"

tesseract = args.tesseract or shutil.which("tesseract")

default_tesseract = Path(
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

if not tesseract and default_tesseract.is_file():
    tesseract = str(default_tesseract)

if not tesseract:
    parser.error(
        "Tesseract가 없습니다. "
        "--tesseract로 실행 파일 경로를 지정하세요."
    )

pytesseract.pytesseract.tesseract_cmd = tesseract
pytesseract.get_tesseract_version()

result_dir = (
    args.output_dir or (ROOT / "data" / "origin")
).resolve()

result_dir.mkdir(parents=True, exist_ok=True)

filename = input_path.stem
txt_path = result_dir / f"{filename}_origin.txt"
result_path = result_dir / f"{filename}_result.jpg"

for path in (txt_path, result_path):
    if path.exists():
        parser.error(
            f"기존 결과가 있습니다: {path}\n"
            "--output-dir로 새 저장 폴더를 지정하세요."
        )

start_time = time.time()

print("[STAGE] 입력 도면 읽는 중...", flush=True)

if input_path.suffix.lower() == ".pdf":
    pages = convert_from_path(
        str(input_path),
        dpi=200,
        first_page=1,
        last_page=1,
        poppler_path=args.poppler,
    )

    img = np.array(pages[0].convert("RGB"))
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

    _, binary = cv2.threshold(
        gray,
        200,
        255,
        cv2.THRESH_BINARY,
    )

    img = cv2.merge([binary, binary, binary])

else:
    img = cv2.imread(str(input_path))

    if img is None:
        raise ValueError(
            f"이미지를 읽지 못했습니다: {input_path}"
        )

print("[STAGE] 치수 인식 모델 로딩...", flush=True)

recognizer_dim, alphabet_dim = load_recognizer(
    "recognizer_dimensions_2"
)

print("[STAGE] 도면 영역 분리...", flush=True)

(
    img_boxes,
    frame,
    gdt_boxes,
    tables,
    dim_boxes,
) = tools.layer_segm.segment_img(
    img,
    autoframe=True,
    frame_thres=0.8,
    GDT_thres=0.02,
    binary_thres=127,
)

recognizer_gdt = None

if gdt_boxes:
    print("[STAGE] 기하공차 인식 모델 로딩...", flush=True)

    recognizer_gdt, _ = load_recognizer(
        "recognizer_gdts"
    )

print(
    "[STAGE] 문자 검출 모델 로딩... "
    "최초 실행에는 검출 가중치를 다운로드할 수 있습니다.",
    flush=True,
)

detector = Detector()
process_img = img.copy()

print("[STAGE] 표제란 OCR...", flush=True)

if tables and any(tables):
    (
        table_results,
        updated_tables,
        process_img,
    ) = tools.ocr_pipelines.ocr_tables(
        tables,
        process_img,
        language,
    )

else:
    table_results = []
    updated_tables = []
    print("[INFO] 표제란 영역 없음", flush=True)

print("[STAGE] 기하공차 OCR...", flush=True)

(
    gdt_results,
    updated_gdt_boxes,
    process_img,
) = tools.ocr_pipelines.ocr_gdt(
    process_img,
    gdt_boxes,
    recognizer_gdt,
)

print("[STAGE] 치수 OCR... CPU에서는 시간이 걸릴 수 있습니다.", flush=True)

if frame:
    process_img = process_img[
        frame.y:frame.y + frame.h,
        frame.x:frame.x + frame.w,
    ]

(
    dimensions,
    other_info,
    process_img,
    dim_tess,
) = tools.ocr_pipelines.ocr_dimensions(
    process_img,
    detector,
    recognizer_dim,
    alphabet_dim,
    frame,
    dim_boxes,
    cluster_thres=20,
    max_img_size=2048,
    language=language,
    backg_save=False,
)

print("[STAGE] JPG·TXT 저장...", flush=True)

mask_img = tools.output_tools.mask_img(
    img,
    updated_gdt_boxes,
    updated_tables,
    dimensions,
    frame,
    other_info,
)

(
    table_results,
    gdt_results,
    dimensions,
    other_info,
) = tools.output_tools.process_raw_output(
    str(result_dir / filename),
    table_results,
    gdt_results,
    dimensions,
    other_info,
    save=False,
)

if not cv2.imwrite(str(result_path), mask_img):
    raise OSError(
        f"결과 이미지를 저장하지 못했습니다: {result_path}"
    )

with txt_path.open("w", encoding="utf-8") as f:
    f.write("[ DIMENSIONS ]\n")
    f.write("-" * 60 + "\n")
    f.write(f"{'No':<5}{'Text':<28}Position (x, y)\n")

    for i, (text, position) in enumerate(dimensions, 1):
        f.write(
            f"{i:<5}{str(text):<28}{str(position)}\n"
        )

    f.write("-" * 60 + "\n")
    f.write(
        f"Detected dimensions : {len(dimensions)}\n"
    )

    f.write("\n[ GD&T ]\n")
    f.write("-" * 60 + "\n")

    for i, item in enumerate(gdt_results, 1):
        f.write(f"{i:02d}. {item}\n")

    f.write("-" * 60 + "\n")
    f.write(
        f"Detected GD&T : {len(gdt_results)}\n"
    )

    f.write("\n[ OTHER TEXT ]\n")
    f.write("-" * 60 + "\n")

    for i, item in enumerate(other_info, 1):
        f.write(f"{i:02d}. {item}\n")

    f.write(
        f"Detected other text : {len(other_info)}\n"
    )

    f.write("\n[ TITLE / TABLE ]\n")
    f.write("-" * 60 + "\n")
    f.write(
        f"Detected table regions : {len(table_results)}\n"
    )

    for i, table in enumerate(table_results, 1):
        f.write(f"  table {i}: {table}\n")

    height, width = img.shape[:2]

    f.write(
        f"\nImage size : {width} x {height} px, "
        "position = text center, origin top-left, PDF 200 dpi\n"
    )

    offset_x = frame.x if frame else 0
    offset_y = frame.y if frame else 0

    f.write(
        f"Frame offset : {offset_x}, {offset_y}\n"
    )

print(f"[SAVED] {result_path}", flush=True)
print(f"[SAVED] {txt_path}", flush=True)
print(
    f"[DONE] {time.time() - start_time:.1f}초 소요. "
    "SQLite는 아직 변경하지 않았습니다.",
    flush=True,
)
