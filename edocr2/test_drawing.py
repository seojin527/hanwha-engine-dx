import cv2, time, os
import numpy as np
import pytesseract
from edocr2 import tools
from pdf2image import convert_from_path

# 도면 파일 경로와 언어 설정

import sys
from pathlib import Path

# 프로젝트 최상위 폴더
project_root = Path(__file__).resolve().parent.parent

# 입력 도면 폴더
input_dir = project_root / "data" / "input"

if len(sys.argv) < 2:
    print("사용법: python edocr2/test_drawing.py 파일명.pdf")
    sys.exit(1)

file_path = input_dir / sys.argv[1]

if not file_path.is_file():
    print(f"[ERROR] 도면 파일을 찾을 수 없습니다: {file_path}")
    sys.exit(1)

file_path = str(file_path)
language = "eng"

# Windows Tesseract 실행 파일 경로
pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

#Opening the file        
if file_path.endswith('.pdf') or file_path.endswith(".PDF"):
    img = convert_from_path(file_path, dpi=200)
    img = np.array(img[0])
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, img = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
    img = cv2.merge([img, img, img])
else:
    img = cv2.imread(file_path)

filename = os.path.splitext(os.path.basename(file_path))[0]
output_path = os.path.join('.', filename)

# ===== OCR 결과 저장 경로 =====

from pathlib import Path

# 프로젝트 최상위 data 폴더
project_root = Path(__file__).resolve().parent.parent
result_dir = project_root / "data" / "origin"
result_dir.mkdir(parents=True, exist_ok=True)

txt_path = result_dir / f"{filename}_origin.txt"
result_path = result_dir / f"{filename}_result.jpg"

#region ############ Segmentation Task ####################

img_boxes, frame, gdt_boxes, tables, dim_boxes  = tools.layer_segm.segment_img(img, autoframe = True, frame_thres=0.8
, GDT_thres = 0.02, binary_thres=127)

#endregion

#region ######## Set Session ##############################
start_time = time.time()
#os.environ['TF_XLA_FLAGS'] = '--tf_xla_enable_xla_devices'
import tensorflow as tf
from edocr2.keras_ocr.recognition import Recognizer
from edocr2.keras_ocr.detection import Detector

# Configure GPU memory growth
gpus = tf.config.list_physical_devices('GPU')
for gpu in gpus:
    tf.config.experimental.set_memory_growth(gpu, True)

def load_npz_weights(model, path):
    print(f"[LOADING] {path}", flush=True)

    with np.load(path) as data:
        weights = [
            data[f"arr_{i}"]
            for i in range(len(data.files))
        ]

    expected = model.get_weights()

    if len(weights) != len(expected):
        raise ValueError(
            f"Weight count mismatch: "
            f"expected {len(expected)}, got {len(weights)}"
        )

    for i, (old, new) in enumerate(zip(expected, weights)):
        if old.shape != new.shape:
            raise ValueError(
                f"Weight shape mismatch at {i}: "
                f"expected {old.shape}, got {new.shape}"
            )

    model.set_weights(weights)
    print(f"[OK] Loaded {len(weights)} weight arrays", flush=True)

# Load models
gdt_model = 'edocr2/edocr2/models/recognizer_gdts'
dim_model = 'edocr2/edocr2/models/recognizer_dimensions_2'
detector_model = None

recognizer_gdt = None
if gdt_boxes:
    recognizer_gdt = Recognizer(
        alphabet=tools.ocr_pipelines.read_alphabet(gdt_model)
    )
    load_npz_weights(
        recognizer_gdt.model,
        gdt_model + '_gpu_weights.npz'
    )

alphabet_dim = tools.ocr_pipelines.read_alphabet(dim_model)
recognizer_dim = Recognizer(alphabet=alphabet_dim)

load_npz_weights(
    recognizer_dim.model,
    dim_model + '_gpu_weights.npz'
)

detector = Detector()

if detector_model:
    detector.model.load_weights(detector_model)

end_time = time.time()   
print(f"\033[1;33mLoading session took {end_time - start_time:.6f} seconds to run.\033[0m")
#endregion

#region ############ OCR Tables ###########################
process_img = img.copy()

if tables and any(tables):
    table_results, updated_tables, process_img = (
        tools.ocr_pipelines.ocr_tables(
            tables, process_img, language
        )
    )
else:
    print("[INFO] No title/table region detected.")
    table_results = []
    updated_tables = []

#endregion

#region ############ OCR GD&T #############################

gdt_results, updated_gdt_boxes, process_img = tools.ocr_pipelines.ocr_gdt(process_img, gdt_boxes, recognizer_gdt)

#endregion

#region ############ OCR Dimensions #######################
if frame:
    process_img = process_img[frame.y : frame.y + frame.h, frame.x : frame.x + frame.w]
process_img_ = process_img.copy()
dimensions, other_info, process_img, dim_tess = tools.ocr_pipelines.ocr_dimensions(process_img, detector, recognizer_dim, alphabet_dim, frame, dim_boxes, cluster_thres=20, max_img_size=2048, language=language, backg_save=False)

#endregion

#region ############# Qwen for tables #####################

qwen = False
if qwen:
    model, processor = tools.llm_tools.load_VL(model_name = "Qwen/Qwen2-VL-7B-Instruct")
    device = "cuda:1"
    query = ['Tolerance', 'material', 'Surface finish', 'weight']
    llm_tab_qwen = tools.llm_tools.llm_table(tables, llm = (model, processor), img = img, device = device, query=query)
    print(llm_tab_qwen)
#endregion

#region ########### Output ################################

mask_img = tools.output_tools.mask_img(img, updated_gdt_boxes, updated_tables, dimensions, frame, other_info)
table_results, gdt_results, dimensions, other_info = tools.output_tools.process_raw_output(output_path, table_results, gdt_results, dimensions, other_info, save=False)

# 1. OCR 결과 이미지 저장
cv2.imwrite(str(result_path), mask_img)
print(f"[SAVED] {result_path}")

# 2. OCR RAW DATA TXT 저장
with open(txt_path, "w", encoding="utf-8") as f:

    # DIMENSIONS
    f.write("[ DIMENSIONS ]\n")
    f.write("-" * 60 + "\n")
    f.write(f"{'No':<5}{'Text':<28}Position (x, y)\n")

    for i, (text, pos) in enumerate(dimensions, 1):
        f.write(f"{i:<5}{str(text):<28}{str(pos)}\n")

    f.write("-" * 60 + "\n")
    f.write(f"Detected dimensions : {len(dimensions)}\n")

    # GD&T
    f.write("\n[ GD&T ]\n")
    f.write("-" * 60 + "\n")

    for i, item in enumerate(gdt_results, 1):
        f.write(f"{i:02d}. {item}\n")

    f.write("-" * 60 + "\n")
    f.write(f"Detected GD&T : {len(gdt_results)}\n")

    # OTHER TEXT
    f.write("\n[ OTHER TEXT ]\n")
    f.write("-" * 60 + "\n")

    for i, item in enumerate(other_info, 1):
        f.write(f"{i:02d}. {item}\n")

    f.write(f"Detected other text : {len(other_info)}\n")

    # TITLE / TABLE
    f.write("\n[ TITLE / TABLE ]\n")
    f.write("-" * 60 + "\n")
    f.write(f"Detected table regions : {len(table_results)}\n")

    for i, table in enumerate(table_results, 1):
        f.write(f"  table {i}: {table}\n")

    # IMAGE SIZE
    height, width = img.shape[:2]

    f.write(
        f"\nImage size : {width} x {height} px, "
        "position = text center, origin top-left, PDF 200 dpi \n"
    )

    #Frame OFFSET
    f.write(f"Frame offset : {frame.x if frame else 0}, {frame.y if frame else 0}\n")

print(f"[SAVED] {txt_path}")

#endregion

for b in tables[0]:
    infoblock_img = img[b.y : b.y + b.h, b.x : b.x + b.w][:]

infoblock_img = tools.llm_tools.convert_img(infoblock_img)
drw_img = tools.llm_tools.convert_img(process_img_)
manuf = False
quality = False

#region ########## Manufacturability ################
if manuf:
    messages = [
            {"role": "system",
                "content": [{"type": "text", "text": '''You are a specialized OCR system capable of reading mechanical drawings.'''},],
            },
            {"role": "user",
                "content": [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{infoblock_img}", "detail": "high"}},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{drw_img}", "detail": "high"}},
                            {"type": "text", "text": '''You are getting the inforamtion block of the drawing in the first image, and the views of the part in the second. 
                            I need you to tell me a PYTHON DICTIONARY with the manufacturing processes (keys) and short description (values)  that are best for this part.'''},],
            }]

    answer = tools.llm_tools.ask_gpt(messages)
    print('Manufacturing Answer: \n', answer)
#endregion

#region ######### Quality Control Check ##############
if quality:
    messages = [
            {"role": "system",
                "content": [{"type": "text", "text": '''You are a specialized OCR system capable of reading mechanical drawings.'''},],
            },
            {"role": "user",
                "content": [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{infoblock_img}", "detail": "high"}},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{drw_img}", "detail": "high"}},
                            {"type": "text", "text": '''You are getting the inforamtion block of the drawing in the first image, and the views of the part in the second. 
                            I need you to tell me IN A PYTHON LIST ONLY WHICH MEASUREMENTS -NUMERICAL VALUE AND TOLERANCE-  needs to be checked in the quality control process'''},],
            }]

    answer = tools.llm_tools.ask_gpt(messages)
    print('Quality Control Answer: \n', answer)
#endregion

###################################################
#cv2.imwrite('liu.png', mask_img)
#cv2.imshow('Mask Image', mask_img)
#cv2.waitKey(0)
#cv2.destroyAllWindows()