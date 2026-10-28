"""관리자 오류 DB 관리 · 작업 진행 현황 테스트.

임시 SQLite 파일과 임시 Chroma 폴더만 사용한다 (운영 storage·vector_db 는 건드리지 않는다).
실행 (backend 폴더에서): python -m unittest tests.test_admin_error_db -v
"""
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chromadb
import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

import drawing_library as library
from machining_api import init_machining
from measurement_api import init_measurements
from ocr_results import init_ocr_results
from purpose_errors import excel
from purpose_errors.admin_api import router as admin_router
from purpose_errors.api import router as purpose_router
from purpose_errors.ingest import ingest_files
from purpose_errors.purposes import STORES, Purpose
from purpose_errors.store import init_purpose_tables
from purpose_errors.vectors import ensure_collections
from workflow_status import router as workflow_router

from tests.test_purpose_errors import FakeModel, FlakyCollection

ITEMS = [
    dict(id="D1", category="DIMENSION", raw_text="26±0.05", feature_type="SHAFT", tol_type="DIMENSION",
         position={"x": 100, "y": 100}, measurement_mode="numeric", nominal_value=26,
         lower_limit=25.95, upper_limit=26.05),
    dict(id="D2", category="DIMENSION", raw_text="M10", feature_type="THREAD", tol_type="THREAD_SPEC",
         position={"x": 200, "y": 200}, measurement_mode="gauge"),
    dict(id="D3", category="DIMENSION", raw_text="R5", feature_type="RADIUS", tol_type="DIMENSION",
         position={"x": 300, "y": 300}, measurement_mode="gauge"),
]


def row(case_id, title, **extra):
    return {"case_id": case_id, "data_origin": "SYNTHETIC", "part_family": "피스톤 로드", "feature_type": "THREAD",
            "case_title": title, "error_description": f"{title} 상황", "precaution": f"{title} 주의",
            "search_text": f"{title} 검색", **extra}


def xlsx(rows, sheet="오류주의사항DB") -> bytes:
    buffer = io.BytesIO()
    pd.DataFrame(rows).to_excel(buffer, sheet_name=sheet, index=False)
    return buffer.getvalue()


class AdminBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.temp.name)
        self.old_db = library.DB_PATH
        library.DB_PATH = root / "library.sqlite3"
        library.init_library()
        init_ocr_results()
        init_measurements()
        init_machining()
        init_purpose_tables()
        with library.database() as db:
            # 검색 범위가 피스톤 로드가 되도록 기본 부품(피스톤로드)에 도면을 붙인다.
            db.execute("INSERT OR IGNORE INTO parts (part_id, name) VALUES ('part-a', '피스톤로드')")
            part_id = db.execute("SELECT part_id FROM parts WHERE name='피스톤로드'").fetchone()[0]
            db.execute(
                """INSERT INTO drawings (drawing_id, part_id, name, original_filename, stored_filename, media_type, size_bytes)
                   VALUES ('drawing-a', ?, 'a', 'a.pdf', 'a.pdf', 'application/pdf', 1)""",
                (part_id,),
            )
        self.set_ocr("rev-1", reviewed=True)

        self.chroma = chromadb.PersistentClient(path=str(root / "vector_db"))
        self.model = FakeModel()
        app = FastAPI()
        app.include_router(purpose_router)
        app.include_router(admin_router)
        app.include_router(workflow_router)
        app.state.model = self.model
        self.flaky = {p: FlakyCollection(c) for p, c in ensure_collections(self.chroma).items()}
        app.state.purpose_collections = self.flaky
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        library.DB_PATH = self.old_db
        self.temp.cleanup()

    def set_ocr(self, revision, reviewed=True):
        document = {"drawing_id": "drawing-a", "part_name": "", "image": {"width_px": 1000, "height_px": 1000},
                    "items": ITEMS, "review_status": "reviewed" if reviewed else "pending"}
        with library.database() as db:
            db.execute(
                """INSERT INTO ocr_results (drawing_id, metadata_json, image_filename, revision) VALUES ('drawing-a', ?, 'a.jpg', ?)
                   ON CONFLICT(drawing_id) DO UPDATE SET metadata_json=excluded.metadata_json, revision=excluded.revision""",
                (json.dumps(document), revision),
            )

    def base(self, purpose):
        return f"/api/admin/purposes/{purpose}"

    def upload(self, purpose, files, preview=False):
        payload = [("files", (name, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                   for name, data in files]
        return self.client.post(f"{self.base(purpose)}/uploads{'/preview' if preview else ''}", files=payload)

    def rows(self, purpose):
        with library.database() as db:
            return {r["case_id"]: dict(r) for r in db.execute(f"SELECT * FROM {STORES[Purpose(purpose)].case_table}")}

    def collection_ids(self, purpose):
        return sorted(self.chroma.get_collection(STORES[Purpose(purpose)].collection).get()["ids"])

    def history_actions(self, purpose, case_id):
        items = self.client.get(f"{self.base(purpose)}/history", params={"case_id": case_id}).json()["items"]
        return [entry["action"] for entry in reversed(items)]


class ExcelUploadTests(AdminBase):
    def test_preview_writes_nothing_and_counts_changes(self):
        response = self.upload("verification", [("a.xlsx", xlsx([row("V-1", "하나"), row("V-2", "둘")]))], preview=True)
        body = response.json()
        self.assertTrue(body["ok"], body)
        self.assertEqual((body["created"], body["updated"], body["unchanged"]), (2, 0, 0))
        self.assertEqual(self.rows("verification"), {})
        with library.database() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM error_case_uploads").fetchone()[0], 0)

    def test_apply_isolated_by_purpose_and_upsert_rules(self):
        first = self.upload("verification", [("a.xlsx", xlsx([row("V-1", "하나"), row("V-2", "둘")]))])
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["created"], 2)
        self.assertEqual(first.json()["vector_status"], "ready")
        for other in ("manufacturing", "assembly"):
            self.assertEqual(self.rows(other), {})
            self.assertEqual(self.collection_ids(other), [])

        # 비활성 상태는 재업로드로 바뀌지 않는다. 파일에 없는 사례(V-2)는 그대로 남는다.
        self.client.post(f"{self.base('verification')}/error-cases/V-1/deactivate")
        preview = self.upload("verification", [("b.xlsx", xlsx([row("V-1", "하나 수정"), row("V-3", "셋")]))], preview=True).json()
        self.assertEqual((preview["created"], preview["updated"], preview["unchanged"]), (1, 1, 0))
        second = self.upload("verification", [("b.xlsx", xlsx([row("V-1", "하나 수정"), row("V-3", "셋")]))]).json()
        cases = self.rows("verification")
        self.assertEqual(sorted(cases), ["V-1", "V-2", "V-3"])
        self.assertEqual(cases["V-1"]["case_title"], "하나 수정")
        self.assertEqual(cases["V-1"]["active"], 0)
        self.assertEqual(cases["V-3"]["active"], 1)
        self.assertEqual((second["created"], second["updated"], second["unchanged"]), (1, 1, 0))

        # 같은 파일을 다시 올리면 변경 없음 (원문·이력을 건드리지 않는다).
        before = self.rows("verification")["V-3"]["updated_at"]
        third = self.upload("verification", [("b.xlsx", xlsx([row("V-1", "하나 수정"), row("V-3", "셋")]))]).json()
        self.assertEqual((third["created"], third["updated"], third["unchanged"]), (0, 0, 2))
        self.assertEqual(third["vector_status"], "none")
        self.assertEqual(self.rows("verification")["V-3"]["updated_at"], before)
        self.assertEqual(self.history_actions("verification", "V-1"), ["create", "deactivate", "update"])

        uploads = self.client.get(f"{self.base('verification')}/uploads").json()["items"]
        self.assertEqual(len(uploads), 3)
        self.assertEqual(self.client.get(f"{self.base('assembly')}/uploads").json()["items"], [])

    def test_invalid_files_rejected_before_any_write(self):
        cases = [
            ("missing.xlsx", xlsx([{"case_id": "X-1", "case_title": "t"}])),                       # 필수 열 누락
            ("sheet.xlsx", xlsx([row("X-2", "t")], sheet="다른시트")),                              # 시트 없음
            ("value.xlsx", xlsx([row("X-3", "t", feature_type="BAD")])),                            # 값 형식
            ("blank.xlsx", xlsx([row("X-4", "t"), row("", "빈 ID")])),                             # 빈 case_id
            ("dup.xlsx", xlsx([row("X-5", "t"), row("X-5", "t2")])),                               # 파일 안 중복
        ]
        for name, data in cases:
            body = self.upload("assembly", [(name, data)], preview=True).json()
            self.assertFalse(body["ok"], name)
            self.assertEqual(body["errors"][0]["file"], name)
        dup = self.upload("assembly", [("dup.xlsx", cases[4][1])], preview=True).json()["errors"][0]
        self.assertEqual((dup["row"], dup["case_id"]), (3, "X-5"))

        # 파일 간 중복: 반영 요청도 서버에서 다시 검증해 거부하고 아무것도 저장하지 않는다.
        response = self.upload("assembly", [("a.xlsx", xlsx([row("C-1", "a")])), ("b.xlsx", xlsx([row("C-1", "b")]))])
        self.assertEqual(response.status_code, 422)
        errors = response.json()["detail"]["errors"]
        self.assertEqual((errors[0]["file"], errors[0]["row"], errors[0]["case_id"]), ("b.xlsx", 2, "C-1"))
        self.assertEqual(self.rows("assembly"), {})
        self.assertEqual(self.collection_ids("assembly"), [])
        uploads = self.client.get(f"{self.base('assembly')}/uploads").json()["items"]
        self.assertEqual([u["status"] for u in uploads], ["rejected"])

    def test_vector_failure_kept_and_retry_without_duplicates(self):
        self.flaky[Purpose.manufacturing].fail = True
        result = self.upload("manufacturing", [("m.xlsx", xlsx([row("M-1", "하나"), row("M-2", "둘")]))]).json()
        self.assertTrue(result["saved"])
        self.assertEqual(result["vector_status"], "failed")
        self.assertEqual({c["vector_status"] for c in self.rows("manufacturing").values()}, {"failed"})
        summary = self.client.get(f"{self.base('manufacturing')}/summary").json()
        self.assertEqual(summary["vector"], {"ready": 0, "failed": 2, "pending": 0})

        self.flaky[Purpose.manufacturing].fail = False
        retry = self.client.post(f"{self.base('manufacturing')}/vector/retry", json={}).json()
        self.assertEqual((retry["requested"], retry["ready"]), (2, 2))
        self.client.post(f"{self.base('manufacturing')}/vector/retry", json={"case_ids": ["M-1"]})
        self.assertEqual(self.collection_ids("manufacturing"), ["M-1", "M-2"])

    def test_export_round_trip_keeps_inactive(self):
        self.upload("verification", [("a.xlsx", xlsx([row("V-1", "하나"), row("V-2", "둘")]))])
        self.client.post(f"{self.base('verification')}/error-cases/V-2/deactivate")
        exported = self.client.get(f"{self.base('verification')}/export.xlsx")
        self.assertEqual(exported.status_code, 200)
        frame = pd.read_excel(io.BytesIO(exported.content), sheet_name="오류주의사항DB", dtype=str, keep_default_na=False)
        self.assertEqual(list(frame["case_id"]), ["V-1", "V-2"])
        self.assertEqual(list(frame["active"]), ["Y", "N"])
        # 참고 열(active='Y')을 바꿔 올려도 활성 상태는 바뀌지 않는다.
        frame.loc[1, "active"] = "Y"
        buffer = io.BytesIO()
        frame.to_excel(buffer, sheet_name="오류주의사항DB", index=False)
        again = self.upload("verification", [("export.xlsx", buffer.getvalue())]).json()
        self.assertEqual(again["unchanged"], 2)
        self.assertEqual(self.rows("verification")["V-2"]["active"], 0)

    def test_cli_uses_same_validation_and_logs_upload(self):
        path = Path(self.temp.name) / "cli.xlsx"
        path.write_bytes(xlsx([row("CLI-1", "명령줄"), row("CLI-1", "중복")]))
        with self.assertRaises(excel.ExcelValidationError) as caught:
            ingest_files("assembly", [path], model=self.model, client=self.chroma)
        self.assertEqual(caught.exception.errors[0]["row"], 3)
        path.write_bytes(xlsx([row("CLI-1", "명령줄")]))
        ingest_files("assembly", [path], model=self.model, client=self.chroma)
        uploads = self.client.get(f"{self.base('assembly')}/uploads").json()["items"]
        self.assertEqual([(u["source"], u["status"]) for u in uploads], [("cli", "applied"), ("cli", "rejected")])


class CaseEditAndLinkTests(AdminBase):
    def create(self, purpose, title):
        response = self.client.post(f"{self.base(purpose)}/error-cases", json={
            "part_family": "피스톤 로드", "feature_type": "THREAD", "case_title": title,
            "error_description": f"{title} 상황", "precaution": f"{title} 주의"})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["case_id"]

    def search_ids(self, purpose, item="D2"):
        body = self.client.get(f"/api/purposes/{purpose}/drawings/drawing-a/items/{item}/errors").json()
        return [entry["case_id"] for entry in body["errors"]]

    def test_edit_deactivate_reactivate_and_search(self):
        case_id = self.create("assembly", "나사 체결")
        self.assertIn(case_id, self.search_ids("assembly"))
        self.assertEqual(self.search_ids("verification"), [])

        edit = self.client.put(f"{self.base('assembly')}/error-cases/{case_id}", json={
            "part_family": "피스톤 로드", "feature_type": "THREAD", "case_title": "나사 체결 수정",
            "error_description": "상황", "precaution": "주의"}).json()
        self.assertEqual(edit["vector_status"], "ready")
        self.assertIn("case_title", edit["changed_fields"])
        same = self.client.put(f"{self.base('assembly')}/error-cases/{case_id}", json={
            "part_family": "피스톤 로드", "feature_type": "THREAD", "case_title": "나사 체결 수정",
            "error_description": "상황", "precaution": "주의"}).json()
        self.assertFalse(same["saved"])

        self.client.post(f"{self.base('assembly')}/error-cases/{case_id}/deactivate")
        self.assertNotIn(case_id, self.search_ids("assembly"))
        listed = self.client.get(f"{self.base('assembly')}/error-cases", params={"active": "inactive"}).json()
        self.assertEqual([c["case_id"] for c in listed["items"]], [case_id])

        self.client.post(f"{self.base('assembly')}/error-cases/{case_id}/reactivate")
        self.assertIn(case_id, self.search_ids("assembly"))
        self.assertEqual(self.history_actions("assembly", case_id), ["create", "update", "deactivate", "reactivate"])

    def test_inactive_hidden_even_if_vector_update_failed(self):
        case_id = self.create("assembly", "나사 체결")
        self.flaky[Purpose.assembly].fail = True
        self.client.put(f"{self.base('assembly')}/error-cases/{case_id}", json={
            "part_family": "피스톤 로드", "feature_type": "THREAD", "case_title": "수정",
            "error_description": "상황", "precaution": "주의"})
        self.client.post(f"{self.base('assembly')}/error-cases/{case_id}/deactivate")
        self.assertEqual(self.rows("assembly")[case_id]["vector_status"], "failed")
        self.assertEqual(self.search_ids("assembly"), [])

    def test_unlink_keeps_case_and_other_links(self):
        report = self.client.post("/api/purposes/manufacturing/drawings/drawing-a/items/D2/error-cases", json={
            "revision": "rev-1", "request_id": str(uuid4()), "case_title": "현장 등록",
            "error_description": "상황", "precaution": "주의"}).json()
        case_id = report["case_id"]
        other = self.client.post(f"{self.base('manufacturing')}/links", json={
            "case_id": case_id, "drawing_id": "drawing-a", "item_id": "D1", "revision": "rev-1"})
        self.assertEqual(other.status_code, 201, other.text)
        duplicate = self.client.post(f"{self.base('manufacturing')}/links", json={
            "case_id": case_id, "drawing_id": "drawing-a", "item_id": "D1", "revision": "rev-1"})
        self.assertEqual(duplicate.status_code, 409)

        links = self.client.get(f"{self.base('manufacturing')}/links").json()["items"]
        d2 = next(link for link in links if link["item_id"] == "D2")
        self.assertEqual(d2["source"], "point_report")
        self.client.post(f"{self.base('manufacturing')}/links/{d2['link_id']}/unlink")

        active = self.client.get(f"{self.base('manufacturing')}/links").json()["items"]
        self.assertEqual([link["item_id"] for link in active], ["D1"])
        self.assertIsNotNone(self.rows("manufacturing").get(case_id))
        # 작업 화면의 '등록된 오류사례'에서도 해제한 항목에서만 빠진다.
        d2_list = self.client.get("/api/purposes/manufacturing/drawings/drawing-a/items/D2/error-cases?revision=rev-1").json()
        d1_list = self.client.get("/api/purposes/manufacturing/drawings/drawing-a/items/D1/error-cases?revision=rev-1").json()
        self.assertEqual(d2_list["reports"], [])
        self.assertEqual([r["case_id"] for r in d1_list["reports"]], [case_id])
        self.assertEqual(self.history_actions("manufacturing", case_id), ["create", "link", "link", "unlink"])
        # 다른 목적에는 연결·이력이 없다.
        self.assertEqual(self.client.get(f"{self.base('assembly')}/links").json()["items"], [])

        # 비활성 사례는 새로 연결할 수 없지만 기존 연결은 남고 비활성으로 표시된다.
        self.client.post(f"{self.base('manufacturing')}/error-cases/{case_id}/deactivate")
        blocked = self.client.post(f"{self.base('manufacturing')}/links", json={
            "case_id": case_id, "drawing_id": "drawing-a", "item_id": "D3", "revision": "rev-1"})
        self.assertEqual(blocked.status_code, 409)
        kept = self.client.get(f"{self.base('manufacturing')}/links").json()["items"]
        self.assertEqual([(link["item_id"], link["case_active"]) for link in kept], [("D1", False)])

        # OCR 버전이 바뀌면 과거 연결은 옮기지 않고, 위치를 열 수 없다고 표시한다.
        self.set_ocr("rev-2")
        moved = self.client.get(f"{self.base('manufacturing')}/links").json()["items"][0]
        self.assertEqual(moved["ocr_revision"], "rev-1")
        self.assertFalse(moved["location"]["openable"])
        history = self.client.get(f"{self.base('manufacturing')}/history", params={"case_id": case_id}).json()["items"]
        self.assertTrue(all(entry["actor"] is None for entry in history))

    def test_migration_is_repeatable_and_copies_old_reports_without_history(self):
        store = STORES[Purpose.verification]
        with library.database() as db:
            db.execute(f"INSERT INTO {store.case_table} (case_id, case_title, search_text) VALUES ('OLD-1', '이전', '이전')")
            db.execute(f"""INSERT INTO {store.report_table} (report_id, case_id, drawing_id, item_id, ocr_revision, item_snapshot_json)
                           VALUES ('RPT-old', 'OLD-1', 'drawing-a', 'D1', 'rev-1', '{{}}')""")
        init_purpose_tables()
        init_purpose_tables()
        with library.database() as db:
            links = db.execute(f"SELECT link_id, source FROM {store.link_table}").fetchall()
            history = db.execute(f"SELECT COUNT(*) FROM {store.history_table}").fetchone()[0]
            active = db.execute(f"SELECT active FROM {store.case_table} WHERE case_id='OLD-1'").fetchone()[0]
        self.assertEqual([tuple(link) for link in links], [("LNK-RPT-old", "point_report")])
        self.assertEqual(history, 0)
        self.assertEqual(active, 1)


class ProgressTests(AdminBase):
    def setUp(self):
        super().setUp()
        # 가공 기준 템플릿이 없는 부품 → 모든 항목이 정삭(3) 측정 대상이 된다.
        with library.database() as db:
            db.execute("INSERT INTO parts (part_id, name) VALUES ('part-x', '템플릿 없는 부품')")
            db.execute("UPDATE drawings SET part_id='part-x' WHERE drawing_id='drawing-a'")

    def measure(self, purpose, item_id, judgement, confirmed, revision="rev-1"):
        with library.database() as db:
            db.execute(
                """INSERT INTO measurement_records (drawing_id, ocr_revision, work_purpose, item_id, measured_value,
                       judgement, judgement_reason, item_snapshot_json, confirmed)
                   VALUES ('drawing-a', ?, ?, ?, '1', ?, '', '{}', ?)""",
                (revision, purpose, item_id, judgement, int(confirmed)),
            )

    def machining(self, serial, item_id, judgement, confirmed, stage="3"):
        with library.database() as db:
            db.execute(
                """INSERT INTO machining_stage_records (drawing_id, ocr_revision, serial, item_id, stage, measurement_mode,
                       judgement, judgement_reason, confirmed, criteria_json)
                   VALUES ('drawing-a', 'rev-1', ?, ?, ?, 'numeric', ?, '', ?, '{}')""",
                (serial, item_id, stage, judgement, int(confirmed)),
            )

    def test_unreviewed_ocr_is_not_a_work_target(self):
        self.set_ocr("rev-1", reviewed=False)
        body = self.client.get("/api/admin/drawings/drawing-a/progress").json()
        self.assertEqual({card["state"] for card in body["stages"].values()}, {"unavailable"})
        self.assertEqual(body["items"], [])

    def test_counts_follow_real_records(self):
        body = self.client.get("/api/admin/drawings/drawing-a/progress").json()
        mfg = body["stages"]["manufacturing"]
        self.assertEqual(mfg["state"], "unavailable")  # 제품 번호 기록이 없으면 0% 가 아니라 산정 불가
        self.assertIsNone(mfg["progress"])
        self.assertEqual(body["stages"]["assembly"]["progress"], 0)

        self.measure("assembly", "D1", "pass", True)      # 완료
        self.measure("assembly", "D2", "fail", False)     # 불합격
        self.measure("assembly", "D3", "pass", False)     # 확정 전 → 미완료
        self.measure("verification", "D1", "pass", True, revision="rev-0")  # 이전 OCR 버전 → 진행률에서 제외
        self.machining("PR01", "D1", "pass", True)
        self.machining("PR01", "D2", "fail", False)
        self.machining("PR02", "D1", "pass", True)

        body = self.client.get("/api/admin/drawings/drawing-a/progress").json()
        asm = body["stages"]["assembly"]
        self.assertEqual((asm["target"], asm["completed"], asm["failed"], asm["incomplete"]), (3, 1, 1, 1))
        self.assertEqual(asm["unconfirmed"], 1)
        self.assertAlmostEqual(asm["progress"], 1 / 3, places=3)
        ver = body["stages"]["verification"]
        self.assertEqual((ver["completed"], ver["previous_revision_records"]), (0, 1))

        mfg = body["stages"]["manufacturing"]
        # 템플릿 없는 부품: 모든 항목이 정삭(3) 대상. 제품 2개 × 항목 3개 = 6
        self.assertEqual(mfg["units"], ["PR01", "PR02"])
        self.assertEqual((mfg["target"], mfg["completed"], mfg["failed"], mfg["incomplete"]), (6, 2, 1, 3))
        self.assertEqual(mfg["stages"]["3"]["target"], 6)
        self.assertEqual(mfg["stages"]["1"]["target"], 0)
        d1 = next(item for item in body["items"] if item["item_id"] == "D1")
        self.assertEqual(d1["manufacturing"]["stages"]["3"]["completed"], 2)
        self.assertEqual(d1["assembly"]["status"], "completed")

        detail = self.client.get("/api/admin/drawings/drawing-a/progress/items/D2", params={"revision": "rev-1"}).json()
        self.assertEqual(detail["assembly"]["record"]["status"], "remeasure")
        self.assertEqual([r["serial"] for r in detail["manufacturing"]["records"]], ["PR01"])
        stale = self.client.get("/api/admin/drawings/drawing-a/progress/items/D2", params={"revision": "rev-0"})
        self.assertEqual(stale.status_code, 409)


if __name__ == "__main__":
    unittest.main()
