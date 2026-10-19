"""화면 연결용 기능 테스트: 치수 값 수정 + /api/ocr-review (router).  backend 폴더에서: python -m unittest discover -s tests"""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from ocr_review import OcrTxt, ReviewError, apply_review  # noqa: E402

FIX = os.path.join(HERE, "fixtures")


def origin(name):
    with open(os.path.join(FIX, f"{name}_origin.txt"), encoding="utf-8", newline="") as f:
        return f.read()


def edits(name):
    with open(os.path.join(FIX, f"{name}_edits.json"), encoding="utf-8") as f:
        return json.load(f)


class TestDimensionEdit(unittest.TestCase):
    def test_edit_dimension_value_keeps_columns(self):
        e = edits("HDH_63_3")
        e["dimensions"] = [{"item_id": "D06", "value": "84"}, {"item_id": "D15", "value": "41", "kind": "diameter"}]
        reviewed, log = apply_review(origin("HDH_63_3"), e)
        doc = OcrTxt.parse(reviewed)
        d6 = next(d for d in doc.dims if d.no == 6)
        d15 = next(d for d in doc.dims if d.no == 15)
        self.assertEqual((d6.text, d6.x, d6.y), ("84", 534, 1408))
        self.assertEqual(d15.text, "⌀41")
        line = [l for l in reviewed.splitlines() if l.startswith("6 ")][0]
        self.assertEqual(line.index("["), 33)                      # 좌표 열 위치 그대로
        self.assertEqual(log["summary"]["dimensions_edited"], 2)
        ch = [c for c in log["changes"] if c["type"] == "DIMENSION" and c["action"] == "edited"]
        self.assertEqual([(c["before"], c["after"]) for c in ch], [("80", "84"), ("⌀40", "⌀41")])

    def test_same_value_is_not_a_change(self):
        e = edits("HDH_63_3")
        e["dimensions"] = [{"item_id": "D06", "value": "80"}]
        _, log = apply_review(origin("HDH_63_3"), e)
        self.assertEqual(log["summary"]["dimensions_edited"], 0)

    def test_bad_dimension_edits_rejected(self):
        for bad in ([{"item_id": "D99", "value": "1"}], [{"item_id": "D06", "value": "abc"}],
                    [{"item_id": "D06", "value": "1"}, {"item_id": "D06", "value": "2"}]):
            e = edits("HDH_63_3")
            e["dimensions"] = bad
            with self.assertRaises(ReviewError, msg=str(bad)):
                apply_review(origin("HDH_63_3"), e)

    def test_log_text_shows_dimension_fix(self):
        from ocr_review.logs import format_log_text
        e = edits("HDH_63_3")
        e["dimensions"] = [{"item_id": "D06", "value": "84"}]
        _, log = apply_review(origin("HDH_63_3"), e, name="HDH_63_3")
        self.assertIn("수정  D06    치수     80 → 84", format_log_text(log))


def screen_items(name):
    """화면이 들고 있는 항목 목록 흉내 (ocr_to_metadata.py 와 같은 id 규칙, 정답 값)."""
    doc = OcrTxt.parse(origin(name))
    reviewed, _ = apply_review(origin(name), edits(name), name=name)
    rdoc = OcrTxt.parse(reviewed)
    items = [{"id": f"DIMENSION_{d.no:03d}", "category": "DIMENSION", "raw_text": d.text,
              "position": {"x": d.x + 56, "y": d.y + 56}} for d in rdoc.dims]
    for e in rdoc.gdt:
        for r, row in enumerate(e.rows, 1):
            items.append({"id": f"GDT_{e.no:03d}_{r}", "category": "GDT", "raw_text": row})
    return items


class TestScreenItems(unittest.TestCase):
    def test_items_rebuild_same_reviewed_txt(self):
        from ocr_review.review import edits_from_items
        for n in ("HDH_61_2", "HDH_62_2", "HDH_63_3"):
            e, warnings = edits_from_items(origin(n), screen_items(n), "관리자", frame_offset=[56, 56])
            got, _ = apply_review(origin(n), e, name=n)
            want, _ = apply_review(origin(n), edits(n), name=n)
            self.assertEqual(OcrTxt.parse(got).text().replace("\r", ""), OcrTxt.parse(want).text().replace("\r", ""), n)
            self.assertEqual(warnings, [], n)

    def test_fix_add_and_datum(self):
        from ocr_review.review import edits_from_items
        items = screen_items("HDH_63_3")
        for it in items:
            if it["id"] == "DIMENSION_006":
                it["raw_text"] = "84"
            if it["id"] == "GDT_005_1":
                it["tolerance_value"] = 0.02
                it["datum_references"] = ["A", "B"]
        items.append({"id": "ADM1", "category": "DIMENSION", "raw_text": "⌀12", "position": {"x": 600, "y": 500}})
        e, _ = edits_from_items(origin("HDH_63_3"), items, frame_offset=[56, 56])
        self.assertEqual(e["dimensions"], [{"item_id": "D06", "text": "84"}])
        self.assertEqual([a["text"] for a in e["added_dimensions"]], ["7", "⌀12"])   # 검수 때 추가된 7 + 관리자 추가
        reviewed, log = apply_review(origin("HDH_63_3"), e)
        doc = OcrTxt.parse(reviewed)
        self.assertEqual(doc.gdt[4].text, "⏊|0.02|A|B")
        self.assertEqual(log["summary"]["dimensions_edited"], 1)
        self.assertEqual(log["summary"]["dimensions_added"], 2)

    def test_missing_gdt_rejected(self):
        from ocr_review.review import edits_from_items
        items = [i for i in screen_items("HDH_63_3") if i["id"] != "GDT_001_1"]
        e, _ = edits_from_items(origin("HDH_63_3"), items)
        with self.assertRaises(ReviewError):
            apply_review(origin("HDH_63_3"), e)


class TestApiRouter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
        except ImportError:
            raise unittest.SkipTest("fastapi 없음")
        import ocr_review.api as api
        import ocr_review.files as files
        cls.api, cls.files = api, files
        cls.tmp = tempfile.mkdtemp()
        cls.saved = (files.REPO_DATA_DIR, api.REPO_DATA_DIR, api.ORIGIN_DIR, api.LOG_DIR)
        data = os.path.join(cls.tmp, "data")
        os.makedirs(os.path.join(data, "origin"))
        shutil.copy(os.path.join(FIX, "HDH_63_3_origin.txt"), os.path.join(data, "origin"))
        files.REPO_DATA_DIR = api.REPO_DATA_DIR = data
        api.ORIGIN_DIR = os.path.join(data, "origin")
        api.LOG_DIR = os.path.join(cls.tmp, "logs")
        cls.saved_front = api.FRONT_DRAWINGS_DIR
        front = os.path.join(cls.tmp, "frontend", "public", "drawings")
        os.makedirs(front)
        shutil.copy(os.path.join(os.path.dirname(HERE), "demo", "samples", "HDH_63_3_result.jpg"),
                    os.path.join(front, "HDH_63_3.jpg"))                # 화면 도면 이미지로 결과 이미지 만들기
        api.FRONT_DRAWINGS_DIR = front
        app = FastAPI()
        app.include_router(api.router)                            # app.py 와 같은 방식으로 붙임
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.files.REPO_DATA_DIR, cls.api.REPO_DATA_DIR, cls.api.ORIGIN_DIR, cls.api.LOG_DIR = cls.saved
        cls.api.FRONT_DRAWINGS_DIR = cls.saved_front
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_origin_and_review_by_name(self):
        r = self.client.get("/api/ocr-review/origin/HDH_63_3")
        self.assertEqual(r.status_code, 200)
        self.assertIn("[ DIMENSIONS ]", r.json()["origin_txt"])
        r = self.client.post("/api/ocr-review/review", json={"name": "HDH_63_3"})
        self.assertEqual(r.json()["summary"]["gdt_format_error"], 1)

    def test_missing_and_bad_names(self):
        self.assertEqual(self.client.get("/api/ocr-review/origin/NOPE").status_code, 404)
        self.assertEqual(self.client.post("/api/ocr-review/review", json={"name": "../x"}).status_code, 422)

    def test_apply_save_writes_files(self):
        e = edits("HDH_63_3")
        e["dimensions"] = [{"item_id": "D06", "value": "84"}]
        r = self.client.post("/api/ocr-review/apply", json={"name": "HDH_63_3", "edits": e, "save": True})
        self.assertEqual(r.status_code, 200, r.text)
        saved = r.json()["saved"]
        self.assertIn("data/reviewed/HDH_63_3_reviewed.txt", saved)
        self.assertIn("data/logs/HDH_63_3_edits.json", saved)
        path = os.path.join(self.tmp, "data", "reviewed", "HDH_63_3_reviewed.txt")
        with open(path, encoding="utf-8") as f:
            self.assertIn("84", f.read())
        self.assertEqual(self.client.get("/api/ocr-review/history").status_code, 200)

    def test_submit_screen_items(self):
        items = screen_items("HDH_63_3")
        items.append({"id": "ADM1", "category": "DIMENSION", "raw_text": "9", "position": {"x": 700, "y": 700}})
        r = self.client.post("/api/ocr-review/submit", json={"name": "HDH_63_3", "items": items, "reviewer": "관리자"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["log"]["summary"]["dimensions_added"], 2)
        self.assertIn("data/reviewed/HDH_63_3_reviewed.txt", body["saved"])

    def test_result_files_after_submit(self):
        r = self.client.post("/api/ocr-review/submit",
                             json={"name": "HDH_63_3", "items": screen_items("HDH_63_3"), "reviewer": "관리자"})
        self.assertEqual(r.status_code, 200, r.text)
        kinds = {f["kind"] for f in self.client.get("/api/ocr-review/result/HDH_63_3").json()["files"]}
        self.assertEqual(kinds, {"reviewed_txt", "review_log", "reviewed_jpg", "edits_log_jpg", "edits_json"})
        img = self.client.get("/api/ocr-review/result/HDH_63_3/reviewed_jpg")
        self.assertEqual((img.status_code, img.headers["content-type"]), (200, "image/jpeg"))
        self.assertIn("수정·추가 내역", self.client.get("/api/ocr-review/result/HDH_63_3/review_log").text)
        self.assertEqual(self.client.get("/api/ocr-review/result/HDH_63_3/nope").status_code, 404)
        self.assertEqual(self.client.get("/api/ocr-review/result/NONE/reviewed_txt").status_code, 404)
        self.assertEqual(self.client.get("/api/ocr-review/result/NONE").json()["files"], [])

    def test_apply_with_text_from_screen_and_errors(self):
        r = self.client.post("/api/ocr-review/apply", json={"name": "SCREEN_1", "origin_txt": origin("HDH_63_3"),
                                                            "edits": {"gdt": []}})
        self.assertEqual(r.status_code, 422)                     # 기하공차 미확정 → 거부
        self.assertTrue(any("확정하지 않은" in m for m in r.json()["detail"]))


if __name__ == "__main__":
    unittest.main()
