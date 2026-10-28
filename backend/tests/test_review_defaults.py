"""관리자 검토 기본값의 서버 검증: 공차 근거 구분·기본값 표시·일반공차 근거 판정.

실행 (backend 폴더에서): python -m unittest tests.test_review_defaults -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

from ocr_review.api import apply_inspection_settings, general_tolerance_evidence  # noqa: E402

ITEM = {"id": "DIMENSION_001", "category": "DIMENSION", "raw_text": "75", "unit": "mm"}
DRAWN = {"id": "DIMENSION_002", "category": "DIMENSION", "raw_text": "26±0.05", "unit": "mm"}


def setting(**extra):
    return {"measurement_mode": "numeric", "feature_type": "PLANE", "unit": "mm",
            "instrument": "버니어 캘리퍼스", "gauge_criteria": "", "position_confirmed": True, **extra}


class ToleranceBasis(unittest.TestCase):
    def test_project_default_general_is_stored_apart_from_drawing(self):
        result = apply_inspection_settings(ITEM, setting(
            tolerance_source="general", tolerance_basis="project_default",
            defaults_applied=["tolerance_source", "instrument"]))
        self.assertEqual(result["tolerance_source"], "GENERAL")
        self.assertEqual(result["tolerance_basis"], "project_default")
        self.assertEqual(result["defaults_applied"], ["instrument", "tolerance_source"])
        self.assertEqual((result["lower_limit"], result["upper_limit"]), (74.7, 75.3))

        drawn = apply_inspection_settings(DRAWN, setting(tolerance_source="drawing", tolerance_basis="drawing"))
        self.assertEqual((drawn["tolerance_source"], drawn["tolerance_basis"]), ("DRAWING", "drawing"))

    def test_basis_must_match_source(self):
        # 시스템 기본 정책으로 적용한 일반공차를 '도면에서 읽은 공차'로 저장할 수 없다.
        with self.assertRaises(HTTPException):
            apply_inspection_settings(ITEM, setting(tolerance_source="general", tolerance_basis="drawing"))
        with self.assertRaises(HTTPException):
            apply_inspection_settings(ITEM, setting(tolerance_source="general", defaults_applied=["unknown"]))

    def test_old_requests_without_basis_still_work(self):
        result = apply_inspection_settings(ITEM, setting(tolerance_source="general"))
        self.assertEqual(result["tolerance_basis"], "admin")
        self.assertEqual(result["defaults_applied"], [])

    def test_inverted_special_range_rejected(self):
        with self.assertRaises(HTTPException):
            apply_inspection_settings(ITEM, setting(tolerance_source="special", upper_deviation=-0.1, lower_deviation=0.1))


class GeneralEvidence(unittest.TestCase):
    def test_grade_m_only(self):
        self.assertTrue(general_tolerance_evidence("x\nGENERAL TOLERANCE: ISO 2768-mK\n")["applies"])
        self.assertFalse(general_tolerance_evidence("ISO 2768-f")["applies"])
        self.assertFalse(general_tolerance_evidence("일반공차 적용")["applies"])
        self.assertFalse(general_tolerance_evidence("no note")["found"])


if __name__ == "__main__":
    unittest.main()
