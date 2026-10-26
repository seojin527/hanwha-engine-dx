"""일반공차(ISO 2768-m), 치수 표기 검사, 검사 기준(공차 출처) 반영 테스트.

실행 (backend 폴더에서): python -m unittest tests.test_general_tolerance -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

from general_tolerance import general_deviation  # noqa: E402
from ocr_metadata import parse_dimension  # noqa: E402
from ocr_review.api import apply_inspection_settings  # noqa: E402
from ocr_review.review import DIM_TEXT_RE, ReviewError, compose_dimension_text  # noqa: E402


class GeneralToleranceTable(unittest.TestCase):
    def test_linear_ranges(self):
        cases = [(0.5, 0.1), (3, 0.1), (3.5, 0.1), (6, 0.1), (6.1, 0.2), (30, 0.2),
                 (45, 0.3), (120, 0.3), (400, 0.5), (700, 0.8), (1500, 1.2), (4000, 2.0)]
        for nominal, expected in cases:
            self.assertEqual(general_deviation("LINEAR_DIMENSION", nominal), expected, nominal)
            self.assertEqual(general_deviation("DIAMETER", nominal), expected, nominal)

    def test_edge_ranges(self):
        for nominal, expected in [(0.5, 0.2), (3, 0.2), (5, 0.5), (8, 1.0), (50, 1.0)]:
            self.assertEqual(general_deviation("CHAMFER_SIZE", nominal), expected, nominal)
            self.assertEqual(general_deviation("RADIUS", nominal), expected, nominal)

    def test_out_of_table(self):
        self.assertIsNone(general_deviation("LINEAR_DIMENSION", 0.3))
        self.assertIsNone(general_deviation("LINEAR_DIMENSION", 5000))
        self.assertIsNone(general_deviation("THREAD_SPEC", 16))
        self.assertIsNone(general_deviation("LINEAR_DIMENSION", None))


class ParseDimension(unittest.TestCase):
    def test_general_applied_when_no_tolerance(self):
        r = parse_dimension("⌀45", "mm")
        self.assertEqual(r["tolerance_source"], "GENERAL")
        self.assertEqual((r["lower_limit"], r["upper_limit"]), (44.7, 45.3))

    def test_drawing_tolerance_symmetric_and_deviation(self):
        r = parse_dimension("26±0.05", "mm")
        self.assertEqual(r["tolerance_source"], "DRAWING")
        self.assertEqual((r["lower_limit"], r["upper_limit"]), (25.95, 26.05))
        r = parse_dimension("7 +0.02/-0.01", "mm")
        self.assertEqual(r["tolerance_source"], "DRAWING")
        self.assertEqual((r["lower_limit"], r["upper_limit"]), (6.99, 7.02))

    def test_thread_and_out_of_range_have_no_limits(self):
        self.assertIsNone(parse_dimension("M16", "mm")["tolerance_source"])
        r = parse_dimension("0.3", "mm")
        self.assertIsNone(r["tolerance_source"])
        self.assertIsNone(r["lower_limit"])


class DimensionText(unittest.TestCase):
    def test_valid_and_invalid(self):
        for text in ["26", "⌀12±0.01", "26 +0.02/-0.01", "R5", "C0.5", "M16", "M16x1.5"]:
            self.assertTrue(DIM_TEXT_RE.match(text), text)
        for text in ["⌀", "26±", "1O", "0.5.2", "C3,", "7mm"]:
            self.assertFalse(DIM_TEXT_RE.match(text), text)

    def test_compose_rejects_broken_text(self):
        with self.assertRaises(ReviewError):
            compose_dimension_text({"text": "C3,"})
        self.assertEqual(compose_dimension_text({"text": "C3"}), "C3")


def dimension_item(raw):
    return {"id": "DIMENSION_001", "category": "DIMENSION", "raw_text": raw,
            "unit": "mm", **parse_dimension(raw, "mm")}


BASE = {"measurement_mode": "numeric", "feature_type": "PLANE", "unit": "mm",
        "instrument": "버니어 캘리퍼스", "gauge_criteria": "", "position_confirmed": True}


class InspectionSettings(unittest.TestCase):
    def test_general_computed_by_server(self):
        # 화면이 보낸 기준치수·편차는 무시하고 표기에서 다시 계산한다.
        item = apply_inspection_settings(
            dimension_item("80"),
            {**BASE, "tolerance_source": "general", "nominal_value": 1,
             "upper_deviation": 99, "lower_deviation": -99},
        )
        self.assertEqual(item["tolerance_source"], "GENERAL")
        self.assertEqual((item["lower_limit"], item["upper_limit"]), (79.7, 80.3))
        self.assertFalse(item["requires_review"])

    def test_special(self):
        item = apply_inspection_settings(
            dimension_item("65"),
            {**BASE, "tolerance_source": "special", "upper_deviation": 0.05, "lower_deviation": -0.02},
        )
        self.assertEqual(item["tolerance_source"], "SPECIAL")
        self.assertEqual((item["lower_limit"], item["upper_limit"]), (64.98, 65.05))

    def test_drawing(self):
        item = apply_inspection_settings(dimension_item("26±0.05"), {**BASE, "tolerance_source": "drawing"})
        self.assertEqual((item["lower_limit"], item["upper_limit"]), (25.95, 26.05))

    def test_rejects_unavailable_sources(self):
        with self.assertRaises(HTTPException):  # 도면에 공차 없음
            apply_inspection_settings(dimension_item("80"), {**BASE, "tolerance_source": "drawing"})
        with self.assertRaises(HTTPException):  # 일반공차 표 범위 밖
            apply_inspection_settings(dimension_item("0.3"), {**BASE, "tolerance_source": "general"})
        with self.assertRaises(HTTPException):  # 특별 공차 값 없음
            apply_inspection_settings(dimension_item("80"), {**BASE, "tolerance_source": "special"})
        with self.assertRaises(HTTPException):  # 모르는 출처
            apply_inspection_settings(dimension_item("80"), {**BASE, "tolerance_source": "guess"})

    def test_legacy_request_without_source(self):
        item = apply_inspection_settings(
            dimension_item("80"),
            {**BASE, "nominal_value": 80, "upper_deviation": 0.1, "lower_deviation": -0.1},
        )
        self.assertEqual(item["tolerance_source"], "SPECIAL")
        self.assertEqual((item["lower_limit"], item["upper_limit"]), (79.9, 80.1))

    def test_gdt_requires_pass_fail_mode(self):
        gdt = {"id": "GDT_001", "category": "GDT", "raw_text": "⏥|0.0025|A"}
        with self.assertRaises(HTTPException):
            apply_inspection_settings(gdt, {**BASE, "tolerance_source": "general"})
        item = apply_inspection_settings(
            gdt, {**BASE, "measurement_mode": "gauge", "gauge_criteria": "⏥ 평면도 0.0025 이하"}
        )
        self.assertEqual(item["measurement_mode"], "gauge")


if __name__ == "__main__":
    unittest.main()
