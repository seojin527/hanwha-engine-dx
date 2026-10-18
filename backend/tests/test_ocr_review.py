"""ocr_review 테스트.  backend 폴더에서:  python -m unittest discover -s tests -v"""
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from ocr_review import (OcrTxt, ReviewError, apply_review, build_review,  # noqa: E402
                        compose_dimension_text)

FIXTURES = os.path.join(HERE, "fixtures")

NAMES = ["HDH_61_2", "HDH_62_2", "HDH_63_3"]

# 실제 도면 값 (정답대조표 기준)
TRUTH_GDT = {
    "HDH_61_2": ["∠|0.0017|A", "⌭|0.002|A", "⏊|0.003|A", "⌖|0.005|A\n◎|0.001",
                 "⏥|0.002|A\n⫽|0.011"],
    "HDH_62_2": ["○|0.0013|A\n⌯|0.002", "⏥|0.003|A\n⫽|0.016", "⌖|0.025|A\n◎|0.015",
                 "⏊|0.012|A", "⌭|0.001|A\n⏤|0.014"],
    "HDH_63_3": ["⏥|0.0035|A\n⫽|0.012", "○|0.0014|A\n⌯|0.015", "⌖|0.023|A\n◎|0.017",
                 "⌭|0.004|A\n⏤|0.012", "⏊|0.01|A"],
}
TRUTH_DIM_COUNT = {"HDH_61_2": 17, "HDH_62_2": 17, "HDH_63_3": 18}

# data/ocr_to_metadata.py 가 쓰는 정규식 (호환성 확인용, 그대로 복사)
OTM_SIZE = re.compile(r"Image size\s*:\s*(\d+)\s*x\s*(\d+)\s*px.*?PDF\s+(\d+)\s*dpi")
OTM_DIM = re.compile(r"^\s*(\d+)\s+(.+?)\s+\[(\d+),\s*(\d+)\]\s*$")
OTM_GDT = re.compile(r"^\s*(\d+)\.\s*\['(.+)',\s*\((\d+),\s*(\d+)\)\]\s*$")


def read(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        return f.read()


def origin(name):
    return read(os.path.join(FIXTURES, f"{name}_origin.txt"))


def edits(name):
    with open(os.path.join(FIXTURES, f"{name}_edits.json"), encoding="utf-8") as f:
        return json.load(f)


def confirm_all(text):
    """모든 기하공차를 OCR 값 그대로 확정하는 edits (형식 오류 줄은 제외)."""
    data = build_review(text)
    return {"gdt": [{"item_id": g["item_id"], "value": g["value"]}
                    for g in data["gdt"] if g["status"] == "check"]}


class TestTxtFormat(unittest.TestCase):
    def test_parse_and_write_back_is_identical(self):
        for n in NAMES:
            text = origin(n)
            self.assertEqual(OcrTxt.parse(text).text(), text, n)

    def test_crlf_is_kept(self):
        text = origin("HDH_63_3").replace("\n", "\r\n")
        self.assertEqual(OcrTxt.parse(text).text(), text)

    def test_counts(self):
        expect = {"HDH_61_2": (17, 5), "HDH_62_2": (16, 5), "HDH_63_3": (17, 5)}
        for n, (d, g) in expect.items():
            doc = OcrTxt.parse(origin(n))
            self.assertEqual((len(doc.dims), len(doc.gdt)), (d, g), n)
            self.assertEqual((doc.width, doc.height), (2339, 1654))
            self.assertEqual(doc.warnings, [], n)

    def test_old_format_from_ocr_branch(self):
        text = read(os.path.join(FIXTURES, "HDH_62_2_oldformat_OCR.txt"))
        doc = OcrTxt.parse(text)
        self.assertEqual(OcrTxt.parse(text).text(), text)
        self.assertEqual((len(doc.dims), len(doc.gdt), len(doc.tables)), (16, 5, 1))
        doc.add_dimension("7", 108, 278)
        line = [l for l in doc.lines if l.startswith("17")][0]
        self.assertTrue(line.startswith("17    7" + " " * 24 + "[108, 278]"), repr(line))  # 구버전 열 폭 유지
        self.assertIn("Detected dimensions : 17", doc.text())

    def test_numpy_repr_positions(self):
        text = origin("HDH_63_3").replace("(825, 704)", "(np.int64(825), np.int64(704))")
        doc = OcrTxt.parse(text)
        self.assertEqual((doc.gdt[4].x, doc.gdt[4].y), (825, 704))


class TestReview(unittest.TestCase):
    def test_build_review_flags_only_broken_values(self):
        expect = {"HDH_61_2": (7, 0), "HDH_62_2": (9, 0), "HDH_63_3": (9, 1)}
        for n, (rows, err) in expect.items():
            data = build_review(origin(n), name=n)
            self.assertEqual(data["summary"]["gdt_rows"], rows, n)
            self.assertEqual(data["summary"]["gdt_format_error"], err, n)
            self.assertTrue(all(d["status"] == "auto" for d in data["dimensions"]))
        bad = [g for g in build_review(origin("HDH_63_3"))["gdt"] if g["status"] == "format_error"]
        self.assertEqual(bad[0]["item_id"], "G05-1")
        self.assertEqual(bad[0]["value"], ",.01")

    def test_confirm_everything_unchanged_gives_same_file(self):
        for n in ["HDH_61_2", "HDH_62_2"]:
            text = origin(n)
            reviewed, log = apply_review(text, confirm_all(text), dpi=None)
            self.assertEqual(reviewed, text, n)
            self.assertEqual(log["summary"]["gdt_edited"], 0)

    def test_examples_reach_ground_truth(self):
        for n in NAMES:
            reviewed, log = apply_review(origin(n), edits(n), name=n)
            doc = OcrTxt.parse(reviewed)
            self.assertEqual([g.text for g in doc.gdt], TRUTH_GDT[n], n)
            self.assertEqual(len(doc.dims), TRUTH_DIM_COUNT[n], n)
            self.assertEqual(log["summary"]["gdt_unreviewed"], 0)
            self.assertEqual(OcrTxt.parse(reviewed).text(), reviewed)

    def test_added_dimension_uses_frame_coordinates(self):
        reviewed, log = apply_review(origin("HDH_63_3"), edits("HDH_63_3"))
        last = OcrTxt.parse(reviewed).dims[-1]
        self.assertEqual((last.no, last.text, last.x, last.y), (18, "7", 1267 - 56, 1103 - 56))
        added = [c for c in log["changes"] if c["action"] == "added"][0]
        self.assertEqual(added["position_image"], {"x": 1267, "y": 1103})

    def test_missing_rows_are_rejected(self):
        e = edits("HDH_63_3")
        e["gdt"] = e["gdt"][:3]
        with self.assertRaises(ReviewError) as ctx:
            apply_review(origin("HDH_63_3"), e)
        self.assertIn("확정하지 않은 기하공차", ctx.exception.errors[0])
        reviewed, log = apply_review(origin("HDH_63_3"), e, require_all=False)
        self.assertEqual(log["summary"]["gdt_unreviewed"], 6)

    def test_bad_inputs_are_rejected(self):
        cases = [
            {"gdt": [{"item_id": "G09-1", "value": "0.1"}]},
            {"gdt": [{"item_id": "G05-1", "value": ",.01"}]},
            {"gdt": [{"item_id": "G05-1", "value": "0.01"}, {"item_id": "G05-1", "value": "0.01"}]},
            {"added_dimensions": [{"value": "7"}]},
            {"added_dimensions": [{"value": "7", "x": 99999, "y": 5}]},
            {"added_dimensions": [{"value": "abc", "x": 10, "y": 10}]},
        ]
        for c in cases:
            with self.assertRaises(ReviewError, msg=str(c)):
                apply_review(origin("HDH_63_3"), c, require_all=False)

    def test_compose_dimension_text(self):
        self.assertEqual(compose_dimension_text({"value": "7"}), "7")
        self.assertEqual(compose_dimension_text({"value": "30", "kind": "diameter",
                                                 "tolerance": {"type": "symmetric", "value": "0.02"}}), "⌀30±0.02")
        self.assertEqual(compose_dimension_text({"value": "12", "kind": "diameter",
                                                 "tolerance": {"type": "deviation", "upper": "-0.006", "lower": "0.017"}}),
                         "⌀12 -0.006/-0.017")
        self.assertEqual(compose_dimension_text({"value": "5", "kind": "radius"}), "R5")
        self.assertEqual(compose_dimension_text({"text": "M10x1.5"}), "M10x1.5")


class TestLogs(unittest.TestCase):
    def test_log_text_and_history_accumulate(self):
        import csv
        import tempfile
        from ocr_review.logs import append_history, format_log_text, write_logs
        reviewed, log = apply_review(origin("HDH_63_3"), edits("HDH_63_3"), name="HDH_63_3")
        text = format_log_text(log, "HDH_63_3_origin.txt", "HDH_63_3_reviewed.txt")
        self.assertIn("수정  G01-1", text)
        self.assertIn("0.035 → 0.0035", text)
        self.assertIn("(형식 오류였음)", text)
        self.assertIn("추가  D18", text)
        with tempfile.TemporaryDirectory() as tmp:
            base = os.path.join(tmp, "HDH_63_3")
            saved = write_logs(log, base, os.path.join(tmp, "logs"), "HDH_63_3_origin.txt")
            self.assertEqual(len(saved), 3)
            hist = os.path.join(tmp, "logs", "review_history.csv")
            append_history(log, hist)                       # 두 번째 검수
            with open(hist, encoding="utf-8-sig", newline="") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(len(rows), 2 * 10)              # 기하공차 9 + 추가 치수 1, 두 번
            edited = [r for r in rows if r["action"] == "edited"]
            self.assertEqual(len(edited), 8)
            self.assertIn({"item_id": "G05-1", "before": ",.01", "after": "0.01", "format_error": "Y"},
                          [{k: r[k] for k in ("item_id", "before", "after", "format_error")} for r in edited])

    def test_reviewed_json(self):
        from ocr_review.review import build_reviewed_json
        reviewed, log = apply_review(origin("HDH_63_3"), edits("HDH_63_3"), name="HDH_63_3")
        data = build_reviewed_json(reviewed, log, "HDH_63_3")
        self.assertEqual([g["value"] for g in data["gdt"]],
                         ["0.0035", "0.012", "0.0014", "0.015", "0.023", "0.017", "0.004", "0.012", "0.01"])
        self.assertEqual(sum(g["source"] == "edited" for g in data["gdt"]), 4)
        self.assertEqual(data["dimensions"][-1]["source"], "added")
        self.assertEqual(data["dimensions"][-1]["position_image"], {"x": 1267, "y": 1103})


class TestImages(unittest.TestCase):
    """도면_reviewed.jpg = 추가한 치수만 형광펜 / 도면_edits_log.jpg = OK·FIX·ADD 기록"""

    @classmethod
    def setUpClass(cls):
        try:
            import PIL  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("Pillow 없음")

    def _make(self, edits_):
        import tempfile
        from PIL import Image
        from ocr_review.render import render_edits_log, render_reviewed
        reviewed, log = apply_review(origin("HDH_63_3"), edits_)
        tmp = tempfile.mkdtemp()
        src = os.path.join(tmp, "result.jpg")
        Image.new("RGB", (2339, 1654), "white").save(src)        # 흰 도면 (비교 쉽게)
        a = render_reviewed(src, reviewed, log, os.path.join(tmp, "reviewed.jpg"))
        b = render_edits_log(src, reviewed, log, os.path.join(tmp, "edits_log.jpg"))
        return Image.open(a).convert("RGB"), Image.open(b).convert("RGB")

    def test_reviewed_highlights_only_added_dimension(self):
        from ocr_review.render import DIM_COLOR
        e = edits("HDH_63_3")
        e["added_dimensions"][0]["box"] = [1250, 1080, 1290, 1126]
        reviewed_img, log_img = self._make(e)
        px = reviewed_img.getpixel((1270, 1100))
        self.assertTrue(all(abs(p - c) <= 8 for p, c in zip(px, DIM_COLOR)), px)   # 형광펜 색
        bbox = reviewed_img.convert("L").point(lambda v: 255 if v < 245 else 0).getbbox()
        self.assertEqual(bbox, (1250, 1080, 1290, 1126))          # 칠한 곳은 추가 치수 칸뿐 (FIX/OK 라벨 없음)
        self.assertNotEqual(log_img.convert("L").point(lambda v: 255 if v < 245 else 0).getbbox(), bbox)

    def test_bad_box_is_rejected(self):
        e = edits("HDH_63_3")
        e["added_dimensions"][0]["box"] = [10, 10, 5, 20]
        with self.assertRaises(ReviewError):
            apply_review(origin("HDH_63_3"), e)


class TestCompatibility(unittest.TestCase):
    """data/ocr_to_metadata.py 가 reviewed.txt 를 읽을 수 있는지 (정규식 기준)."""

    def test_reviewed_txt_matches_ocr_to_metadata_patterns(self):
        for n in NAMES:
            reviewed, _ = apply_review(origin(n), edits(n), name=n)
            self.assertIsNotNone(OTM_SIZE.search(reviewed), f"{n}: Image size/dpi")
            section, dims, gdts = None, 0, 0
            for line in reviewed.splitlines():
                head = re.fullmatch(r"\[\s*(.+?)\s*\]", line.strip())
                if head:
                    section = head[1]
                    continue
                if section == "DIMENSIONS" and OTM_DIM.match(line):
                    dims += 1
                if section == "GD&T" and OTM_GDT.match(line):
                    gdts += 1
            self.assertEqual(dims, TRUTH_DIM_COUNT[n], n)
            self.assertEqual(gdts, 5, n)

    def test_origin_txt_lacks_dpi(self):
        # 원본(수정이 형식)은 dpi가 없어서 ocr_to_metadata.py 첫 단계에서 멈춤 → reviewed.txt 에서 보완
        self.assertIsNone(OTM_SIZE.search(origin("HDH_63_3")))


if __name__ == "__main__":
    unittest.main()
