import sys
from pathlib import Path

from drawing_library import database
from ocr_results import init_ocr_results, save_ocr_result

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))

from ocr_to_metadata import convert

DRAWING_ID = "be336f91-89f3-4b85-99cd-3bea19b92cd1"
NAME = "HDH_63_01"


def main():
    txt_path = ROOT / "data" / "origin" / f"{NAME}_origin.txt"
    jpg_path = ROOT / "data" / "origin" / f"{NAME}_result.jpg"

    for path in (txt_path, jpg_path):
        if not path.is_file():
            raise SystemExit(f"파일이 없습니다: {path}")

    with database() as db:
        drawing = db.execute(
            "SELECT original_filename FROM drawings WHERE drawing_id=?",
            (DRAWING_ID,),
        ).fetchone()

        if drawing is None or drawing["original_filename"] != f"{NAME}.pdf":
            raise SystemExit("도면 ID와 원본 파일명이 일치하지 않습니다.")

        existing = db.execute(
            "SELECT 1 FROM ocr_results WHERE drawing_id=?",
            (DRAWING_ID,),
        ).fetchone()

        if existing:
            raise SystemExit("이미 분석 결과가 있어 덮어쓰지 않았습니다.")

    source = txt_path.read_text(encoding="utf-8-sig")
    metadata = convert(source, drawing_id=NAME, image_file=jpg_path.name)
    metadata["review_status"] = "pending"

    result = save_ocr_result(
        DRAWING_ID,
        metadata,
        jpg_path.read_bytes(),
    )

    print("저장 완료:", NAME)
    print("도면 ID:", DRAWING_ID)
    print("측정항목 수:", result["result"]["item_count"])
    print("검수 상태: 미검수")


if __name__ == "__main__":
    init_ocr_results()
    main()