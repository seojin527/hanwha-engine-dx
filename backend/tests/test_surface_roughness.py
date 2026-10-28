"""표면 거칠기(Ra) 읽기 테스트: 표제란 범례(R1 = Ra 0.8)와 도면의 Ra 표기.

실행 (backend 폴더에서): python -m unittest tests.test_surface_roughness -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

from ocr_metadata import convert, parse_dimension, roughness_legend  # noqa: E402
from ocr_review.api import apply_inspection_settings  # noqa: E402
from ocr_review.review import DIM_TEXT_RE  # noqa: E402


def word(text, left, top):
    return {"text": text, "left": left, "top": top, "width": 60, "height": 22}


def title_table(legend_words):
    """표제란 단어 목록. 범례는 맨 아래 줄(top≈1540)에 단어 단위로 흩어져 읽힌다."""
    cells = [word("PART", 100, 1400), word("NAME", 170, 1400), word("CONNECTING", 300, 1400),
             word("ROD", 480, 1400), word("SCALE", 100, 1470), word("1:50,", 300, 1470),
             word("A3", 400, 1470)]
    for index, (text, left) in enumerate(legend_words):
        cells.append(word(text, left, 1539 + (index % 3)))   # 같은 줄에서 위치가 조금씩 흔들림
    return cells


# OCR이 R1 을 'Ri' 로 읽은 실제 사례를 본뜬 범례
LEGEND_OCR = [("Ri", 100), ("=", 160), ("Ra", 190), ("0.8,", 240), ("R2", 330), ("=", 390), ("Ra", 420), ("0.8", 470)]


def origin(dimensions, legend_words=LEGEND_OCR):
    lines = ["Image size : 3308 x 2339 px", "Frame offset : 56, 56", "[DIMENSIONS]",
             f"Detected dimensions : {len(dimensions)}"]
    for number, text in enumerate(dimensions, 1):
        lines.append(f"{number} {text} [{200 + number * 50}, 300]")
    lines += ["[GD&T]", "Detected GD&T : 0", "[TITLE / TABLE]", f"table 1: {title_table(legend_words)!r}"]
    return "\n".join(lines) + "\n"


def items_by_text(doc):
    return {item["raw_text"]: item for item in doc["items"]}


class Legend(unittest.TestCase):
    def test_reads_ocr_split_words_and_ri_confusion(self):
        legend = roughness_legend("PART NAME ROD\nRi = Ra 0.8, R2 = Ra 0.8")
        self.assertEqual(set(legend), {"R1", "R2"})
        self.assertEqual(legend["R1"]["text"], "Ra 0.8")
        self.assertTrue(legend["R1"]["misread"])      # 'Ri' 는 R1 로 보정했다는 표시
        self.assertFalse(legend["R2"]["misread"])

    def test_clean_text_and_other_values(self):
        legend = roughness_legend("R1 = Ra 0.8, R2 = Ra 1.6  R3: Ra .4")
        self.assertEqual({key: value["text"] for key, value in legend.items()},
                         {"R1": "Ra 0.8", "R2": "Ra 1.6", "R3": "Ra 0.4"})
        self.assertFalse(any(value["misread"] for value in legend.values()))

    def test_conflicting_values_are_not_guessed(self):
        legend = roughness_legend("R1 = Ra 0.8\nR1 = Ra 1.6\nR2 = Ra 0.8")
        self.assertEqual(set(legend), {"R2"})

    def test_no_legend(self):
        self.assertEqual(roughness_legend("PART NAME ROD"), {})
        self.assertEqual(roughness_legend(""), {})
        self.assertEqual(roughness_legend(None), {})

    def test_radius_note_is_not_a_legend(self):
        # 'R5 = 5' 같은 문구나 Ra 없는 등호는 범례로 보지 않는다.
        self.assertEqual(roughness_legend("R5 = 5 mm"), {})


class ParseRoughness(unittest.TestCase):
    def test_explicit_ra(self):
        for raw, expected in [("Ra 0.8", "Ra 0.8"), ("Ra0.8", "Ra 0.8"), ("Ra.8", "Ra 0.8"), ("Ra 12.5", "Ra 12.5")]:
            result = parse_dimension(raw, "mm")
            self.assertEqual(result["feature_type"], "SURFACE", raw)
            self.assertEqual(result["measurement_characteristic"], "SURFACE_ROUGHNESS", raw)
            self.assertEqual(result["surface_roughness"], expected, raw)
            self.assertIsNone(result["nominal_value"], raw)
            self.assertIsNone(result["lower_limit"], raw)
            self.assertTrue(result["requires_review"], raw)

    def test_radius_still_radius(self):
        result = parse_dimension("R5", "mm")
        self.assertEqual((result["feature_type"], result["nominal_value"]), ("RADIUS", 5.0))
        self.assertEqual(result["tolerance_source"], "GENERAL")

    def test_misread_ra_is_not_guessed(self):
        # Rat.8 처럼 숫자를 알 수 없는 표기는 거칠기로 만들지 않고 형식 오류로 둔다.
        for raw in ("Rat.8", "Ra", "Ra 0.8.1"):
            result = parse_dimension(raw, "mm")
            self.assertNotEqual(result["feature_type"], "SURFACE", raw)
            self.assertEqual(result["tol_type"], "UNKNOWN", raw)    # 깨진 표기: 수치 확정 금지
            self.assertIsNone(result["nominal_value"], raw)
            self.assertTrue(result["requires_review"], raw)

    def test_edited_text_is_accepted(self):
        for text in ("Ra 0.8", "Ra0.8", "Ra .8", "R5"):
            self.assertTrue(DIM_TEXT_RE.match(text), text)
        for text in ("Ra", "Rat.8", "Ra 0.8 um"):
            self.assertFalse(DIM_TEXT_RE.match(text), text)


class ConvertWithLegend(unittest.TestCase):
    def setUp(self):
        self.doc = convert(origin(["R1", "R2", "R5", "Ra0.8", "⌀50", "Rat.8"]), "T", "T.jpg")
        self.items = items_by_text(self.doc)

    def test_legend_symbols_become_surface(self):
        for raw in ("R1", "R2"):
            item = self.items[raw]
            self.assertEqual(item["feature_type"], "SURFACE", raw)
            self.assertEqual(item["measurement_characteristic"], "SURFACE_ROUGHNESS", raw)
            self.assertEqual(item["surface_roughness"], "Ra 0.8", raw)
            self.assertEqual(item["roughness_symbol"], raw)
            self.assertIsNone(item["nominal_value"], raw)
            self.assertTrue(item["requires_review"], raw)
            self.assertTrue(any("반지름이면" in reason for reason in item["review_reasons"]), raw)
        self.assertEqual(self.doc["roughness_legend"], {"R1": "Ra 0.8", "R2": "Ra 0.8"})

    def test_original_text_is_kept(self):
        self.assertIn("R1", self.items)
        self.assertNotIn("Ra 0.8", self.items)

    def test_real_radius_and_other_items_unchanged(self):
        radius = self.items["R5"]          # 범례에 없는 기호는 반지름 그대로
        self.assertEqual((radius["feature_type"], radius["nominal_value"]), ("RADIUS", 5.0))
        self.assertNotIn("surface_roughness", radius)
        self.assertEqual(self.items["⌀50"]["measurement_characteristic"], "DIAMETER")

    def test_drawing_ra_without_legend_lookup(self):
        self.assertEqual(self.items["Ra0.8"]["surface_roughness"], "Ra 0.8")
        self.assertNotIn("roughness_symbol", self.items["Ra0.8"])

    def test_unreadable_ra_needs_review(self):
        item = self.items["Rat.8"]
        self.assertNotEqual(item["feature_type"], "SURFACE")
        self.assertEqual(item["tol_type"], "UNKNOWN")
        self.assertTrue(item["requires_review"])

    def test_without_legend_r1_stays_radius(self):
        doc = convert(origin(["R1", "R2"], legend_words=[]), "T", "T.jpg")
        for item in doc["items"]:
            self.assertEqual(item["feature_type"], "RADIUS", item["raw_text"])
        self.assertNotIn("roughness_legend", doc)

    def test_ri_item_is_flagged_as_misread(self):
        doc = convert(origin(["Ri"]), "T", "T.jpg")
        item = doc["items"][0]
        self.assertEqual((item["feature_type"], item["roughness_symbol"]), ("SURFACE", "R1"))
        self.assertTrue(any("오독" in reason for reason in item["review_reasons"]))


GAUGE = {"measurement_mode": "gauge", "feature_type": "SURFACE", "unit": "µm",
         "instrument": "표면 거칠기 측정기", "gauge_criteria": "Ra 0.8 이하이면 합격", "position_confirmed": True}


class SaveSettings(unittest.TestCase):
    def surface_item(self):
        return {"id": "DIMENSION_001", "category": "DIMENSION", "raw_text": "Ra 0.8",
                "unit": "mm", **parse_dimension("Ra 0.8", "mm")}

    def test_gauge_saved_without_limits(self):
        item = apply_inspection_settings(self.surface_item(), GAUGE)
        self.assertEqual(item["feature_type"], "SURFACE")
        self.assertEqual(item["measurement_mode"], "gauge")
        self.assertEqual(item["gauge_criteria"], "Ra 0.8 이하이면 합격")
        self.assertIsNone(item["lower_limit"])
        self.assertFalse(item["requires_review"])
        self.assertTrue(item["inspection_approved"])

    def test_numeric_is_rejected(self):
        with self.assertRaises(HTTPException):
            apply_inspection_settings(
                self.surface_item(),
                {**GAUGE, "measurement_mode": "numeric", "tolerance_source": "special",
                 "upper_deviation": 0.1, "lower_deviation": 0},
            )

    def test_criteria_is_required(self):
        with self.assertRaises(HTTPException):
            apply_inspection_settings(self.surface_item(), {**GAUGE, "gauge_criteria": " "})

    def test_corrected_to_radius(self):
        # 관리자가 거칠기로 읽힌 R1 을 반지름으로 바로잡은 경우: 거칠기 표시가 남지 않는다.
        legend_doc = convert(origin(["R1"]), "T", "T.jpg")
        item = apply_inspection_settings(
            legend_doc["items"][0],
            {"measurement_mode": "numeric", "feature_type": "RADIUS", "tolerance_source": "general",
             "unit": "mm", "instrument": "R 템플릿", "position_confirmed": True},
        )
        self.assertEqual(item["feature_type"], "RADIUS")
        self.assertEqual(item["measurement_characteristic"], "RADIUS")
        self.assertNotIn("surface_roughness", item)
        self.assertEqual((item["lower_limit"], item["upper_limit"]), (0.8, 1.2))


if __name__ == "__main__":
    unittest.main()
