"""등록 부품 ↔ 3D 엔진 부품 종류 연결과 도면 목록의 검토 상태.

임시 SQLite 만 사용한다. 실행 (backend 폴더에서): python -m unittest tests.test_engine_part_link -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import drawing_library as library  # noqa: E402
from ocr_results import init_ocr_results  # noqa: E402


class LibraryBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.old_db = library.DB_PATH
        library.DB_PATH = Path(self.temp.name) / "library.sqlite3"
        library.init_library()
        library.init_library()  # 반복 실행해도 열 추가가 한 번만 일어난다
        init_ocr_results()
        app = FastAPI()
        app.include_router(library.router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        library.DB_PATH = self.old_db
        self.temp.cleanup()


class EnginePartLinkTests(LibraryBase):
    def test_existing_parts_are_not_linked_and_link_is_explicit(self):
        parts = self.client.get("/api/parts").json()["parts"]
        self.assertEqual([p["engine_part_key"] for p in parts], [None])  # 이름이 피스톤로드여도 자동 연결하지 않음

        part_id = parts[0]["part_id"]
        linked = self.client.put(f"/api/parts/{part_id}/engine-part", json={"engine_part_key": "PR"})
        self.assertEqual(linked.status_code, 200, linked.text)
        self.assertEqual(linked.json()["engine_part_key"], "PR")
        self.assertEqual(self.client.put(f"/api/parts/{part_id}/engine-part", json={"engine_part_key": "XX"}).status_code, 422)
        self.assertEqual(self.client.put(f"/api/parts/{part_id}/engine-part", json={"engine_part_key": None}).json()["engine_part_key"], None)

        created = self.client.post("/api/parts", json={"name": "크로스헤드 A", "engine_part_key": "CH"}).json()
        self.assertEqual(created["engine_part_key"], "CH")

    def test_drawing_list_includes_review_state(self):
        part_id = self.client.get("/api/parts").json()["parts"][0]["part_id"]
        with library.database() as db:
            for drawing_id in ("d-1", "d-2"):
                db.execute(
                    """INSERT INTO drawings (drawing_id, part_id, name, original_filename, stored_filename, media_type, size_bytes)
                       VALUES (?, ?, 'a', 'a.pdf', ?, 'application/pdf', 1)""",
                    (drawing_id, part_id, f"{drawing_id}.pdf"),
                )
            db.execute(
                "INSERT INTO ocr_results (drawing_id, metadata_json, image_filename, revision) VALUES ('d-1', ?, 'a.jpg', 'rev-9')",
                (json.dumps({"items": [], "review_status": "reviewed"}),),
            )
        drawings = {d["drawing_id"]: d for d in self.client.get(f"/api/parts/{part_id}/drawings").json()["drawings"]}
        self.assertEqual((drawings["d-1"]["ocr_revision"], drawings["d-1"]["review_status"]), ("rev-9", "reviewed"))
        self.assertEqual((drawings["d-2"]["ocr_revision"], drawings["d-2"]["review_status"]), (None, None))


if __name__ == "__main__":
    unittest.main()


class DrawingMoveTests(LibraryBase):
    def setUp(self):
        super().setUp()
        from machining_api import init_machining
        from measurement_api import init_measurements
        init_measurements()
        init_machining()
        self.source = self.client.get("/api/parts").json()["parts"][0]["part_id"]   # 피스톤로드
        self.target = self.client.post("/api/parts", json={"name": "크로스헤드"}).json()["part_id"]
        with library.database() as db:
            db.execute(
                """INSERT INTO drawings (drawing_id, part_id, name, original_filename, stored_filename, media_type, size_bytes)
                   VALUES ('d-1', ?, 'a', 'a.pdf', 'd-1.pdf', 'application/pdf', 1)""",
                (self.source,),
            )
            db.execute(
                """INSERT INTO measurement_records (drawing_id, ocr_revision, work_purpose, item_id, measured_value,
                       judgement, judgement_reason, item_snapshot_json) VALUES ('d-1', 'r', 'assembly', 'D1', '1', 'pass', '', '{}')"""
            )

    def move(self, part_id, expected=None):
        return self.client.put("/api/drawings/d-1/part", json={"part_id": part_id, "expected_part_id": expected or self.source})

    def test_move_changes_part_and_keeps_records(self):
        impact = self.client.get("/api/drawings/d-1/part-move-impact", params={"to_part_id": self.target}).json()
        self.assertEqual(impact["kept"]["measurements"], 1)
        self.assertTrue(impact["needs_confirmation"])  # 피스톤 로드 템플릿 → 크로스헤드 템플릿
        self.assertTrue(any("가공 단계" in change for change in impact["changes"]))

        moved = self.move(self.target)
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertTrue(moved.json()["changed"])
        self.assertEqual([d["drawing_id"] for d in self.client.get(f"/api/parts/{self.target}/drawings").json()["drawings"]], ["d-1"])
        self.assertEqual(self.client.get(f"/api/parts/{self.source}/drawings").json()["drawings"], [])
        with library.database() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM measurement_records WHERE drawing_id='d-1'").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT from_part_id, to_part_id FROM drawing_part_moves").fetchall()[0][:], (self.source, self.target))

    def test_same_part_stale_and_missing_targets_change_nothing(self):
        self.assertFalse(self.move(self.source).json()["changed"])
        self.assertEqual(self.move(self.target, expected="other-part").status_code, 409)   # 다른 곳에서 이미 바뀐 경우
        self.assertEqual(self.move("no-such-part").status_code, 404)
        with library.database() as db:
            self.assertEqual(db.execute("SELECT part_id FROM drawings WHERE drawing_id='d-1'").fetchone()[0], self.source)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM drawing_part_moves").fetchone()[0], 0)
