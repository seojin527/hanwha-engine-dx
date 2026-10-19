"""eDOCr2 OCR 결과 검수 (Human-in-the-loop) 백엔드.

    도면_origin.txt ──build_review()──▶ 검수 화면용 JSON (프론트)
    도면_origin.txt + 작업자 수정 ──apply_review()──▶ 도면_reviewed.txt + 수정 기록 JSON
"""
from .review import ReviewError, apply_review, build_review, compose_dimension_text
from .txt_format import OcrTxt, TxtFormatError

__all__ = ["OcrTxt", "TxtFormatError", "ReviewError", "build_review", "apply_review",
           "compose_dimension_text"]
__version__ = "0.1.0"
