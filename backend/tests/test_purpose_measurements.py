"""작업 목적별 측정 기록·이력 격리, 이전 DB 이관, 미분류 기록 이동 테스트 (임시 SQLite 만 사용)."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import drawing_library as library
from measurement_api import UNCLASSIFIED, init_measurements, router as measurement_router
from ocr_results import init_ocr_results

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import assign_measurement_purpose as assign  # noqa: E402

PURPOSES = ("manufacturing", "assembly", "verification")
ITEMS = [
    dict(id="D1", category="DIMENSION", raw_text="26±0.05", feature_type="SHAFT", tol_type="DIMENSION",
         requires_review=False, lower_limit=25.95, upper_limit=26.05),
    dict(id="D2", category="DIMENSION", raw_text="10±0.1", feature_type="SHAFT", tol_type="DIMENSION",
         requires_review=False, lower_limit=9.9, upper_limit=10.1),
]


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.old_db = library.DB_PATH
        library.DB_PATH = Path(self.temp.name) / "library.sqlite3"
        library.init_library()
        init_ocr_results()
        with library.database() as db:
            db.execute(
                """INSERT INTO drawings (drawing_id, part_id, name, original_filename, stored_filename, media_type, size_bytes)
                   VALUES ('drawing-a', 'part-piston-rod', 'a', 'a.pdf', 'a.pdf', 'application/pdf', 1)"""
            )
            db.execute(
                "INSERT INTO ocr_results (drawing_id, metadata_json, image_filename, revision) VALUES (?, ?, ?, ?)",
                ("drawing-a", json.dumps({"items": ITEMS, "review_status": "reviewed"}), "a.jpg", "rev-1"),
            )

    def tearDown(self):
        library.DB_PATH = self.old_db
        self.temp.cleanup()

    def rows(self, sql, *params):
        with library.database() as db:
            return [dict(row) for row in db.execute(sql, params)]


class PurposeIsolationTests(Base):
    def setUp(self):
        super().setUp()
        init_measurements()
        app = FastAPI()
        app.include_router(measurement_router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def save(self, purpose, value, item="D1", confirmed=False):
        return self.client.post(f"/api/drawings/drawing-a/items/{item}/measurement", json={
            "revision": "rev-1", "work_purpose": purpose, "measured_value": value,
            "confirmed": confirmed, "instrument": f"{purpose}-기기", "note": f"{purpose}-메모"})

    def listing(self, purpose):
        return self.client.get(f"/api/drawings/drawing-a/measurements?revision=rev-1&purpose={purpose}")

    def attempts(self, purpose, item="D1"):
        return self.client.get(f"/api/drawings/drawing-a/items/{item}/measurement-attempts?revision=rev-1&purpose={purpose}")

    def test_same_item_three_purposes_are_independent(self):
        # 같은 도면·같은 항목에 목적마다 다른 값 · 판정 · 완료 여부
        self.assertEqual(self.save("manufacturing", "26.00", confirmed=True).json()["status"], "completed")
        self.assertEqual(self.save("assembly", "26.50").json()["judgement"], "fail")
        self.assertEqual(self.save("verification", "25.99").json()["status"], "pending")
        self.save("verification", "26.01")  # 검증만 두 번 저장 → 이력 2건
        self.save("manufacturing", "10.00", item="D2", confirmed=True)  # 제작만 D2 완료

        expected = {
            "manufacturing": ("26.00", "pass", "completed"),
            "assembly": ("26.50", "fail", "remeasure"),
            "verification": ("26.01", "pass", "pending"),
        }
        for purpose, (value, judgement, status) in expected.items():
            body = self.listing(purpose).json()
            self.assertEqual(body["work_purpose"], purpose)
            d1 = next(r for r in body["records"] if r["item_id"] == "D1")
            self.assertEqual((d1["measured_value"], d1["judgement"], d1["status"]), (value, judgement, status))
            self.assertEqual(d1["work_purpose"], purpose)
            self.assertEqual(d1["note"], f"{purpose}-메모")

        # 완료 수 (화면 진행률과 같은 기준: status == completed)
        done = {p: sum(r["status"] == "completed" for r in self.listing(p).json()["records"]) for p in PURPOSES}
        self.assertEqual(done, {"manufacturing": 2, "assembly": 0, "verification": 0})

        # 이력
        counts = {p: len(self.attempts(p).json()["attempts"]) for p in PURPOSES}
        self.assertEqual(counts, {"manufacturing": 1, "assembly": 1, "verification": 2})
        latest = self.attempts("verification").json()["attempts"][0]
        self.assertEqual((latest["measured_value"], latest["work_purpose"]), ("26.01", "verification"))

        # DB 에는 목적마다 한 행씩, 덮어쓰지 않았다.
        stored = self.rows("SELECT work_purpose, measured_value FROM measurement_records WHERE item_id='D1' ORDER BY work_purpose")
        self.assertEqual([(r["work_purpose"], r["measured_value"]) for r in stored],
                         [("assembly", "26.50"), ("manufacturing", "26.00"), ("verification", "26.01")])

    def test_purpose_is_required_and_validated(self):
        base = {"revision": "rev-1", "measured_value": "26"}
        self.assertEqual(self.client.post("/api/drawings/drawing-a/items/D1/measurement", json=base).status_code, 422)
        for bad in ("unknown", UNCLASSIFIED, "", "Manufacturing"):
            self.assertEqual(self.save(bad, "26").status_code, 422)
            self.assertEqual(self.listing(bad).status_code, 422)
            self.assertEqual(self.attempts(bad).status_code, 422)
        self.assertEqual(self.client.get("/api/drawings/drawing-a/measurements?revision=rev-1").status_code, 422)
        self.assertEqual(self.rows("SELECT * FROM measurement_records"), [])
        self.assertEqual(self.rows("SELECT * FROM measurement_attempts"), [])

    def test_revision_still_isolates_within_purpose(self):
        self.save("assembly", "26")
        with library.database() as db:
            db.execute("UPDATE ocr_results SET revision='rev-2' WHERE drawing_id='drawing-a'")
        self.assertEqual(self.client.get(
            "/api/drawings/drawing-a/measurements?revision=rev-2&purpose=assembly").json()["records"], [])
        self.assertEqual(self.save("assembly", "26").status_code, 409)


OLD_SCHEMA = """
CREATE TABLE measurement_records (
    drawing_id TEXT NOT NULL REFERENCES drawings(drawing_id),
    ocr_revision TEXT NOT NULL,
    item_id TEXT NOT NULL,
    measured_value TEXT NOT NULL,
    instrument TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    judgement TEXT NOT NULL CHECK(judgement IN ('pass','fail','review')),
    judgement_reason TEXT NOT NULL,
    item_snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (drawing_id, ocr_revision, item_id)
);
CREATE TABLE measurement_attempts (
    attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_id TEXT NOT NULL,
    ocr_revision TEXT NOT NULL,
    item_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


class LegacyMigrationTests(Base):
    """목적 열이 없던 이전 DB 를 init_measurements() 가 미분류로 보존하며 옮기는지."""

    def setUp(self):
        super().setUp()
        with library.database() as db:
            db.executescript(OLD_SCHEMA)
            db.execute("""INSERT INTO measurement_records (drawing_id, ocr_revision, item_id, measured_value, judgement,
                          judgement_reason, item_snapshot_json, updated_at)
                          VALUES ('drawing-a','rev-1','D1','26.01','pass','ok','{}','2026-10-20 10:00:00'),
                                 ('drawing-a','rev-1','D2','12','fail','bad','{}','2026-10-21 10:00:00')""")
            for index in range(3):
                db.execute("INSERT INTO measurement_attempts (drawing_id, ocr_revision, item_id, record_json) VALUES (?,?,?,?)",
                           ("drawing-a", "rev-1", "D1" if index < 2 else "D2", json.dumps({"n": index})))
        self.before_records = self.rows("SELECT * FROM measurement_records ORDER BY item_id")
        self.before_attempts = self.rows("SELECT * FROM measurement_attempts ORDER BY attempt_id")

    def test_old_rows_preserved_as_unclassified_once(self):
        init_measurements()
        init_measurements()  # 두 번 실행해도 같은 결과
        after = self.rows("SELECT * FROM measurement_records ORDER BY item_id")
        self.assertEqual(len(after), 2)
        for old, new in zip(self.before_records, after):
            self.assertEqual(new["work_purpose"], UNCLASSIFIED)
            self.assertEqual({k: new[k] for k in old}, {**old, "measurement_mode": "numeric", "gauge_result": None, "confirmed": 0}
                             if "measurement_mode" in old else old)
        attempts = self.rows("SELECT * FROM measurement_attempts ORDER BY attempt_id")
        self.assertEqual([a["attempt_id"] for a in attempts], [a["attempt_id"] for a in self.before_attempts])
        self.assertTrue(all(a["work_purpose"] == UNCLASSIFIED for a in attempts))
        self.assertEqual([a["record_json"] for a in attempts], [a["record_json"] for a in self.before_attempts])
        # 새 기본키: 같은 항목도 목적이 다르면 따로 저장된다
        pk = [row["name"] for row in self.rows("PRAGMA table_info(measurement_records)") if row["pk"]]
        self.assertEqual(sorted(pk), sorted(["drawing_id", "ocr_revision", "work_purpose", "item_id"]))
        # 미분류는 화면 조회에 나오지 않는다
        app = FastAPI(); app.include_router(measurement_router)
        with TestClient(app) as client:
            for purpose in PURPOSES:
                self.assertEqual(client.get(f"/api/drawings/drawing-a/measurements?revision=rev-1&purpose={purpose}").json()["records"], [])

    def test_assign_tool_preview_apply_and_conflict(self):
        init_measurements()
        snapshot = lambda: (self.rows("SELECT * FROM measurement_records ORDER BY item_id, work_purpose"),
                            self.rows("SELECT * FROM measurement_attempts ORDER BY attempt_id"))
        before = snapshot()

        rows, orphan = assign.list_unclassified()
        self.assertEqual(([r["item_id"] for r in rows], [r["attempts"] for r in rows], orphan), (["D1", "D2"], [2, 1], 0))

        preview = assign.plan("verification", "drawing-a", ["D1"])
        self.assertEqual([(r["item_id"], r["attempts"], r["conflict"]) for r in preview], [("D1", 2, False)])
        self.assertEqual(assign.main(["--purpose", "verification", "--drawing", "drawing-a", "--item", "D1"]), 0)
        self.assertEqual(snapshot(), before)  # 미리보기는 아무것도 바꾸지 않는다

        result = assign.apply("verification", "drawing-a", ["D1"])
        self.assertEqual(result, {"purpose": "verification", "records": 1, "attempts": 2})
        purposes = {r["item_id"]: r["work_purpose"] for r in self.rows("SELECT item_id, work_purpose FROM measurement_records")}
        self.assertEqual(purposes, {"D1": "verification", "D2": UNCLASSIFIED})
        self.assertEqual(len(self.rows("SELECT * FROM measurement_records")), 2)  # 복제하지 않았다
        self.assertEqual(len(self.rows("SELECT * FROM measurement_attempts WHERE work_purpose='verification'")), 2)

        # 이미 그 목적에 기록이 있으면 덮어쓰지 않는다
        with library.database() as db:
            db.execute("""INSERT INTO measurement_records (drawing_id, ocr_revision, work_purpose, item_id, measured_value,
                          judgement, judgement_reason, item_snapshot_json) VALUES
                          ('drawing-a','rev-1','assembly','D2','10','pass','ok','{}')""")
        with self.assertRaises(ValueError):
            assign.apply("assembly", "drawing-a", ["D2"])
        self.assertEqual(self.rows("SELECT work_purpose FROM measurement_records WHERE item_id='D2' ORDER BY work_purpose"),
                         [{"work_purpose": "assembly"}, {"work_purpose": UNCLASSIFIED}])

    def test_assign_tool_requires_explicit_selection(self):
        init_measurements()
        for argv in (["--drawing", "drawing-a", "--all-items"], ["--purpose", "assembly", "--all-items"],
                     ["--purpose", "assembly", "--drawing", "drawing-a"],
                     ["--purpose", "bad", "--drawing", "drawing-a", "--all-items"]):
            with self.assertRaises(SystemExit):
                assign.main(argv)
        with self.assertRaises(ValueError):
            assign.plan("assembly", "drawing-a", ["NOPE"])


if __name__ == "__main__":
    unittest.main()
