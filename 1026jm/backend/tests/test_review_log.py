"""기하공차 기호 수정과 검수 기록(TXT·누적 CSV) 문구 테스트.

실행 (backend 폴더에서): python -m unittest tests.test_review_log -v
"""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ocr_review.logs import append_history, format_log_text  # noqa: E402
from ocr_review.review import ReviewError, apply_review, build_review  # noqa: E402

ORIGIN = (Path(__file__).parent / "fixtures" / "HDH_63_3_origin.txt").read_text(encoding="utf-8-sig")


def all_rows(**override):
    rows = build_review(ORIGIN)["gdt"]
    return [{"item_id": r["item_id"], "value": r["value"] if r["status"] == "check" else "0.01",
             **override.get(r["item_id"], {})} for r in rows]


class SymbolEdit(unittest.TestCase):
    def test_symbol_change_is_applied_and_logged(self):
        first = build_review(ORIGIN)["gdt"][0]
        edits = {"reviewer": "테스트", "gdt": all_rows(**{first["item_id"]: {"symbol": "↗"}})}
        reviewed, log = apply_review(ORIGIN, edits)
        change = next(c for c in log["changes"] if c["item_id"] == first["item_id"])
        self.assertEqual(change["action"], "edited")
        self.assertTrue(change["symbol_changed"])
        self.assertTrue(change["after"].startswith("↗|"))
        self.assertIn("↗|", reviewed)

    def test_unknown_symbol_rejected(self):
        first = build_review(ORIGIN)["gdt"][0]
        with self.assertRaises(ReviewError):
            apply_review(ORIGIN, {"gdt": all_rows(**{first["item_id"]: {"symbol": "X"}})})


class LogText(unittest.TestCase):
    def setUp(self):
        first = build_review(ORIGIN)["gdt"][0]
        _, self.log = apply_review(ORIGIN, {
            "reviewer": "테스트",
            "gdt": all_rows(**{first["item_id"]: {"symbol": "↗", "value": "0.005"}}),
        })
        self.log["drawing_name"] = "HDH_63_3"
        self.log["changes"].append({
            "item_id": "DIMENSION_002", "type": "INSPECTION", "action": "edited", "raw_text": "80",
            "before": None,
            "after": "실측값 · 평면·길이 · 80 일반공차 ISO 2768-m ±0.3 → 79.7~80.3 mm · 버니어 캘리퍼스",
        })

    def test_text_sections(self):
        text = format_log_text(self.log)
        self.assertIn("HDH_63_3", text)
        self.assertIn("[ 작업자 검사 기준 ]", text)
        self.assertIn("79.7~80.3 mm", text)
        self.assertIn("→ ↗ 원주 흔들림", text)      # 기호 수정
        self.assertIn("값 ", text)                 # 값 수정
        self.assertNotIn("기호?", text)            # 예전에 깨지던 줄

    def test_history_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "history.csv"
            append_history(self.log, str(path))
            rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
        inspection = [r for r in rows if r["type"] == "INSPECTION"]
        self.assertEqual(len(inspection), 1)
        self.assertIn("버니어 캘리퍼스", inspection[0]["after"])
        self.assertEqual(inspection[0]["drawing"], "HDH_63_3")
        symbol_row = next(r for r in rows if r["type"] == "GDT" and r["action"] == "edited")
        self.assertTrue(symbol_row["after"].startswith("↗"))


if __name__ == "__main__":
    unittest.main()
