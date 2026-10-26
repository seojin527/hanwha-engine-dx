"""작업 목적별 오류사례 저장소 격리 테스트.

임시 SQLite 파일과 임시 Chroma 폴더만 사용한다 (운영 storage·vector_db 는 건드리지 않는다).
임베딩 모델은 글자 기반의 결정적 테스트 대역을 쓴다.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from uuid import uuid4

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chromadb
import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

import drawing_library as library
from error_case_store import init_error_cases
from ocr_results import init_ocr_results
from point_error_api import init_point_errors
from purpose_errors import migrate_legacy
from purpose_errors.api import router as purpose_router
from purpose_errors.ingest import ingest_excel
from purpose_errors.purposes import STORES, Purpose
from purpose_errors.store import init_purpose_tables
from purpose_errors.vectors import ensure_collections

PURPOSES = [p.value for p in Purpose]
LEGACY_COLLECTION = "error_cases_e5_small_v1"


class FakeModel:
    """같은 문장은 같은 벡터. 차원 16."""
    def encode(self, texts, **kwargs):
        rows = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            vector = np.frombuffer(digest[:16], dtype=np.uint8).astype(float) + 1.0
            rows.append(vector / np.linalg.norm(vector))
        return np.array(rows)


class FlakyCollection:
    """upsert 만 실패시킬 수 있는 실제 컬렉션 래퍼."""
    def __init__(self, inner):
        self.inner = inner
        self.fail = False

    def upsert(self, **kwargs):
        if self.fail:
            raise RuntimeError("test vector failure")
        return self.inner.upsert(**kwargs)

    def __getattr__(self, name):
        return getattr(self.inner, name)


ITEMS = [
    dict(id="D1", category="DIMENSION", raw_text="26±0.05", feature_type="SHAFT",
         tol_type="DIMENSION", requires_review=False),
    dict(id="D2", category="DIMENSION", raw_text="M10", feature_type="THREAD",
         tol_type="THREAD_SPEC", requires_review=True),
]


class PurposeIsolationBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.temp.name)
        self.old_db = library.DB_PATH
        library.DB_PATH = root / "library.sqlite3"
        library.init_library()
        init_ocr_results()
        init_error_cases()
        init_point_errors()

        with library.database() as db:
            db.execute(
                """INSERT INTO drawings (drawing_id, part_id, name, original_filename, stored_filename, media_type, size_bytes)
                   VALUES ('drawing-a', 'part-piston-rod', 'a', 'a.pdf', 'a.pdf', 'application/pdf', 1)"""
            )
            db.execute(
                "INSERT INTO ocr_results (drawing_id, metadata_json, image_filename, revision) VALUES (?, ?, ?, ?)",
                ("drawing-a", json.dumps({"drawing_id": "drawing-a", "items": ITEMS}), "a.jpg", "rev-1"),
            )

        self.chroma = chromadb.PersistentClient(path=str(root / "vector_db"))
        self.model = FakeModel()

    def tearDown(self):
        library.DB_PATH = self.old_db
        self.temp.cleanup()

    # -------------------------------------------------- 도우미
    def table_rows(self, table):
        with library.database() as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
            if not exists:
                return []
            return [dict(row) for row in db.execute(f"SELECT * FROM {table} ORDER BY case_id")]

    def collection_ids(self, purpose):
        return sorted(self.chroma.get_collection(STORES[Purpose(purpose)].collection).get()["ids"])


class ApiIsolationTests(PurposeIsolationBase):
    def setUp(self):
        super().setUp()
        init_purpose_tables()
        app = FastAPI()
        app.include_router(purpose_router)
        app.state.model = self.model
        app.state.client = self.chroma
        collections = ensure_collections(self.chroma)
        self.flaky = {p: FlakyCollection(c) for p, c in collections.items()}
        app.state.purpose_collections = self.flaky

        # 기존 공통 컬렉션에 검색될 만한 사례를 넣어 두고, 목적 검색에 섞이지 않는지 본다.
        legacy = self.chroma.get_or_create_collection(LEGACY_COLLECTION, embedding_function=None)
        legacy.upsert(
            ids=["LEGACY-1"], documents=["legacy"], embeddings=self.model.encode(["legacy"]).tolist(),
            metadatas=[{"part_family": "피스톤 로드", "feature_type": "THREAD", "case_title": "기존 공통 사례"}],
        )
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def register(self, purpose, title, item="D2", request_id=None):
        return self.client.post(
            f"/api/purposes/{purpose}/drawings/drawing-a/items/{item}/error-cases",
            json={
                "revision": "rev-1",
                "request_id": request_id or str(uuid4()),
                "case_title": title,
                "error_description": f"{title} 상황",
                "precaution": f"{title} 주의",
            },
        )

    def history(self, purpose, item="D2"):
        return self.client.get(f"/api/purposes/{purpose}/drawings/drawing-a/items/{item}/error-cases?revision=rev-1")

    def search(self, purpose, item="D2"):
        return self.client.get(f"/api/purposes/{purpose}/drawings/drawing-a/items/{item}/errors")

    # -------------------------------------------------- 등록 · 이력 · 검색
    def test_registration_history_and_search_stay_in_purpose(self):
        made = {}
        for purpose in PURPOSES:
            response = self.register(purpose, f"{purpose} 나사 오류")
            self.assertEqual(response.status_code, 201, response.text)
            body = response.json()
            self.assertEqual(body["purpose"], purpose)
            self.assertEqual(body["vector_status"], "ready")
            self.assertTrue(body["case_id"].startswith(STORES[Purpose(purpose)].case_prefix + "-"))
            made[purpose] = body["case_id"]

        for purpose in PURPOSES:
            store = STORES[Purpose(purpose)]
            # 원문 · 연결 기록 · 벡터가 자기 목적에만 있다.
            self.assertEqual([row["case_id"] for row in self.table_rows(store.case_table)], [made[purpose]])
            reports = self.table_rows(store.report_table)
            self.assertEqual([row["case_id"] for row in reports], [made[purpose]])
            self.assertEqual(json.loads(reports[0]["item_snapshot_json"])["id"], "D2")
            self.assertEqual(reports[0]["ocr_revision"], "rev-1")
            self.assertEqual(self.collection_ids(purpose), [made[purpose]])

            history = self.history(purpose).json()["reports"]
            self.assertEqual([row["case_id"] for row in history], [made[purpose]])

            found = self.search(purpose).json()
            self.assertEqual(found["purpose"], purpose)
            self.assertEqual([row["case_id"] for row in found["errors"]], [made[purpose]])
            self.assertEqual(found["errors"][0]["purpose"], purpose)

        # 기존 공통 테이블·컬렉션은 그대로다.
        self.assertEqual(self.table_rows("error_cases"), [])
        self.assertEqual(self.chroma.get_collection(LEGACY_COLLECTION).get()["ids"], ["LEGACY-1"])

    def test_point_autofill_and_duplicate_request(self):
        request_id = str(uuid4())
        first = self.register("assembly", "중복 확인", request_id=request_id).json()
        second = self.register("assembly", "중복 확인", request_id=request_id).json()
        self.assertEqual(first["case_id"], second["case_id"])
        rows = self.table_rows("assembly_error_cases")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["drawing_text_example"], "M10")
        self.assertEqual(rows[0]["part_family"], "피스톤 로드")
        self.assertEqual(rows[0]["feature_type"], "THREAD")
        # 같은 request_id 라도 다른 목적에는 영향이 없다.
        self.assertEqual(self.table_rows("manufacturing_error_cases"), [])
        # 자동 채움 필드를 요청으로 덮어쓰지 못한다.
        bad = self.client.post(
            "/api/purposes/assembly/drawings/drawing-a/items/D2/error-cases",
            json={"revision": "rev-1", "case_title": "x", "error_description": "x", "precaution": "x", "part_family": "fake"},
        )
        self.assertEqual(bad.status_code, 422)

    def test_empty_collection_returns_empty_without_fallback(self):
        for purpose in PURPOSES:
            response = self.search(purpose)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["errors"], [])

    def test_search_does_not_cross_purposes(self):
        case_id = self.register("verification", "검증 전용").json()["case_id"]
        self.assertEqual(self.search("manufacturing").json()["errors"], [])
        self.assertEqual(self.search("assembly").json()["errors"], [])
        self.assertEqual([row["case_id"] for row in self.search("verification").json()["errors"]], [case_id])

    # -------------------------------------------------- 재시도
    def test_retry_only_within_purpose(self):
        self.flaky[Purpose.assembly].fail = True
        failed = self.register("assembly", "벡터 실패").json()
        self.assertEqual(failed["vector_status"], "failed")
        case_id = failed["case_id"]
        self.assertEqual(self.table_rows("assembly_error_cases")[0]["vector_status"], "failed")
        self.assertEqual(self.collection_ids("assembly"), [])
        # 원문과 연결 기록은 남는다.
        self.assertEqual(len(self.history("assembly").json()["reports"]), 1)

        self.flaky[Purpose.assembly].fail = False
        # 다른 목적으로는 재시도할 수 없다.
        for other in ("manufacturing", "verification"):
            response = self.client.post(f"/api/purposes/{other}/error-cases/{case_id}/retry-index")
            self.assertEqual(response.status_code, 404)
            self.assertEqual(self.collection_ids(other), [])

        retried = self.client.post(f"/api/purposes/assembly/error-cases/{case_id}/retry-index").json()
        self.assertEqual(retried["vector_status"], "ready")
        self.assertEqual(self.collection_ids("assembly"), [case_id])
        self.assertEqual(self.table_rows("assembly_error_cases")[0]["vector_status"], "ready")

    def test_case_lookup_and_generic_registration(self):
        created = self.client.post("/api/purposes/manufacturing/error-cases", json={
            "part_family": "피스톤로드", "case_title": "가공 버", "error_description": "버 발생", "precaution": "디버링",
        })
        self.assertEqual(created.status_code, 201, created.text)
        case_id = created.json()["case_id"]
        self.assertEqual(self.client.get(f"/api/purposes/manufacturing/error-cases/{case_id}").json()["part_family"], "피스톤 로드")
        self.assertEqual(self.client.get(f"/api/purposes/assembly/error-cases/{case_id}").status_code, 404)
        missing = self.client.post("/api/purposes/manufacturing/error-cases", json={"case_title": "필수 누락"})
        self.assertEqual(missing.status_code, 422)

    # -------------------------------------------------- 목적 오류
    def test_invalid_purpose_is_rejected_without_writes(self):
        for bad in ("unknown", "Manufacturing", "error_cases"):
            self.assertEqual(self.register(bad, "x").status_code, 422)
            self.assertEqual(self.history(bad).status_code, 422)
            self.assertEqual(self.search(bad).status_code, 422)
            self.assertEqual(self.client.post(f"/api/purposes/{bad}/error-cases/X/retry-index").status_code, 422)
            self.assertEqual(self.client.post(f"/api/purposes/{bad}/error-cases", json={}).status_code, 422)
        # 목적이 빠진 경로는 없는 경로다.
        self.assertEqual(self.client.get("/api/purposes//drawings/drawing-a/items/D2/errors").status_code, 404)
        for store in STORES.values():
            self.assertEqual(self.table_rows(store.case_table), [])
            self.assertEqual(self.table_rows(store.report_table), [])
        self.assertEqual(self.table_rows("error_cases"), [])


class ExcelIngestTests(PurposeIsolationBase):
    def write_excel(self, rows):
        path = Path(self.temp.name) / f"cases-{uuid4().hex}.xlsx"
        pd.DataFrame(rows).to_excel(path, sheet_name="오류주의사항DB", index=False)
        return path

    def test_ingest_writes_only_selected_purpose(self):
        path = self.write_excel([
            {"case_id": "XL-1", "data_origin": "SYNTHETIC", "part_family": "피스톤로드", "feature_type": "shaft",
             "case_title": "엑셀 1", "search_text": "엑셀 1 검색"},
            {"case_id": "XL-2", "data_origin": "SYNTHETIC", "part_family": "피스톤 로드", "feature_type": "THREAD",
             "case_title": "엑셀 2", "search_text": "엑셀 2 검색"},
        ])
        result = ingest_excel("verification", path, model=self.model, client=self.chroma)
        self.assertEqual(result, {"purpose": "verification", "imported": 2, "vector_status": "ready"})
        rows = self.table_rows("verification_error_cases")
        self.assertEqual([row["case_id"] for row in rows], ["XL-1", "XL-2"])
        self.assertEqual(rows[0]["part_family"], "피스톤 로드")
        self.assertEqual(rows[0]["feature_type"], "SHAFT")
        self.assertEqual(self.collection_ids("verification"), ["XL-1", "XL-2"])
        for other in ("manufacturing", "assembly"):
            self.assertEqual(self.table_rows(STORES[Purpose(other)].case_table), [])
            self.assertEqual(self.collection_ids(other), [])
        self.assertEqual(self.table_rows("error_cases"), [])

        # 같은 case_id 는 갱신된다.
        path2 = self.write_excel([{"case_id": "XL-1", "case_title": "엑셀 1 수정", "search_text": "수정"}])
        ingest_excel("verification", path2, model=self.model, client=self.chroma)
        self.assertEqual(self.table_rows("verification_error_cases")[0]["case_title"], "엑셀 1 수정")

    def test_ingest_requires_valid_purpose_and_columns(self):
        path = self.write_excel([{"case_id": "XL-1", "case_title": "t", "search_text": "s"}])
        with self.assertRaises(ValueError):
            ingest_excel("unknown", path, model=self.model, client=self.chroma)
        with self.assertRaises(SystemExit):
            from purpose_errors.ingest import main
            main(["--file", str(path)])  # --purpose 누락
        bad = self.write_excel([{"case_id": "XL-1", "case_title": "t"}])
        with self.assertRaises(ValueError):
            ingest_excel("assembly", bad, model=self.model, client=self.chroma)
        self.assertEqual(self.table_rows("assembly_error_cases"), [])


    def test_bulk_ingest_checks_all_files_before_writing(self):
        from purpose_errors.ingest import ingest_files
        a = self.write_excel([{"case_id": "B-1", "case_title": "a", "search_text": "a"}])
        b = self.write_excel([{"case_id": "B-2", "case_title": "b", "search_text": "b"}])
        result = ingest_files("manufacturing", [a, b], model=self.model, client=self.chroma)
        self.assertEqual(result["imported"], 2)
        self.assertEqual([entry["imported"] for entry in result["files"]], [1, 1])
        self.assertEqual(self.collection_ids("manufacturing"), ["B-1", "B-2"])
        # 파일 사이에 같은 case_id 가 있으면 아무것도 저장하지 않는다.
        c = self.write_excel([{"case_id": "C-1", "case_title": "c", "search_text": "c"}])
        dup = self.write_excel([{"case_id": "C-1", "case_title": "d", "search_text": "d"}])
        with self.assertRaises(ValueError):
            ingest_files("assembly", [c, dup], model=self.model, client=self.chroma)
        self.assertEqual(self.table_rows("assembly_error_cases"), [])

    def test_all_reads_only_the_purpose_folder(self):
        import purpose_errors.ingest as ingest
        folder = Path(self.temp.name) / "assembly_excels"
        folder.mkdir()
        pd.DataFrame([{"case_id": "F-1", "case_title": "f", "search_text": "f"}]).to_excel(
            folder / "f.xlsx", sheet_name="오류주의사항DB", index=False)
        (folder / "~$f.xlsx").write_bytes(b"lock")  # 엑셀 임시 파일은 건너뛴다
        old = ingest.ERROR_EXCEL_DIRS["assembly"]
        ingest.ERROR_EXCEL_DIRS["assembly"] = folder
        try:
            self.assertEqual([p.name for p in ingest.excel_files_for("assembly")], ["f.xlsx"])
        finally:
            ingest.ERROR_EXCEL_DIRS["assembly"] = old
        with self.assertRaises(SystemExit):
            ingest.main(["--purpose", "assembly", "--file", "x.xlsx", "--all"])  # 둘 다 지정 불가


class LegacyMigrationTests(PurposeIsolationBase):
    def setUp(self):
        super().setUp()
        with library.database() as db:
            for index in (1, 2, 3):
                db.execute(
                    """INSERT INTO error_cases (case_id, data_origin, part_family, case_title, error_description,
                       precaution, search_text, vector_status) VALUES (?, 'SYNTHETIC', '피스톤 로드', ?, '설명', '주의', ?, 'ready')""",
                    (f"EC-{index}", f"기존 {index}", f"기존 {index} 검색"),
                )
            db.execute(
                """INSERT INTO point_error_reports (report_id, case_id, drawing_id, item_id, ocr_revision, item_snapshot_json)
                   VALUES ('RPT-OLD', 'EC-2', 'drawing-a', 'D2', 'rev-1', '{"id": "D2"}')"""
            )
        legacy = self.chroma.get_or_create_collection(LEGACY_COLLECTION, embedding_function=None)
        legacy.upsert(ids=["EC-1", "EC-2", "EC-3"], documents=["a", "b", "c"],
                      embeddings=self.model.encode(["a", "b", "c"]).tolist())

    def legacy_snapshot(self):
        with library.database() as db:
            cases = [tuple(row) for row in db.execute("SELECT * FROM error_cases ORDER BY case_id")]
            reports = [tuple(row) for row in db.execute("SELECT * FROM point_error_reports ORDER BY report_id")]
            tables = sorted(row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'"))
        vectors = self.chroma.get_collection(LEGACY_COLLECTION).get(include=["embeddings", "documents"])
        return cases, reports, tables, vectors["ids"], vectors["documents"]

    def test_preview_changes_nothing(self):
        before = self.legacy_snapshot()
        result = migrate_legacy.plan("assembly", ["EC-1", "EC-2", "NOPE"])
        actions = {item["case_id"]: item["action"] for item in result["items"]}
        self.assertEqual(actions, {"EC-1": "copy", "EC-2": "copy", "NOPE": "error"})
        self.assertEqual(result["items"][1]["point_reports"], 1)
        self.assertEqual(migrate_legacy.main(["--purpose", "assembly", "--case-id", "EC-1"]), 0)
        self.assertEqual(self.legacy_snapshot(), before)  # 목적 테이블도 만들지 않는다.
        self.assertNotIn("assembly_error_cases", before[2])
        self.assertEqual([c.name for c in self.chroma.list_collections()], [LEGACY_COLLECTION])

    def test_apply_copies_only_selected_cases_to_selected_purpose(self):
        cases_before, reports_before, _, ids_before, docs_before = self.legacy_snapshot()
        result = migrate_legacy.apply("manufacturing", ["EC-1", "EC-2"], model=self.model, client=self.chroma)
        self.assertEqual(result["copied"], ["EC-1", "EC-2"])
        self.assertEqual(result["vector_status"], "ready")

        self.assertEqual([row["case_id"] for row in self.table_rows("manufacturing_error_cases")], ["EC-1", "EC-2"])
        self.assertEqual(self.table_rows("manufacturing_error_cases")[0]["data_origin"], "SYNTHETIC")
        self.assertEqual([row["case_id"] for row in self.table_rows("manufacturing_point_error_reports")], ["EC-2"])
        self.assertEqual(self.collection_ids("manufacturing"), ["EC-1", "EC-2"])
        for other in ("assembly", "verification"):
            self.assertEqual(self.table_rows(STORES[Purpose(other)].case_table), [])
            self.assertEqual(self.collection_ids(other), [])

        # 기존 원문·연결 기록·벡터는 그대로다.
        cases_after, reports_after, _, ids_after, docs_after = self.legacy_snapshot()
        self.assertEqual((cases_after, reports_after, ids_after, docs_after), (cases_before, reports_before, ids_before, docs_before))

        # 다시 실행하면 건너뛰고, 다른 목적으로 같은 사례를 옮기려 하면 거부한다.
        self.assertEqual(migrate_legacy.apply("manufacturing", ["EC-1"], model=self.model, client=self.chroma)["skipped"], ["EC-1"])
        with self.assertRaises(ValueError):
            migrate_legacy.apply("assembly", ["EC-1", "EC-3"], model=self.model, client=self.chroma)
        self.assertEqual(self.table_rows("assembly_error_cases"), [])

    def test_explicit_selection_required(self):
        for argv in (["--case-id", "EC-1"], ["--purpose", "assembly"], ["--purpose", "bad", "--case-id", "EC-1"]):
            with self.assertRaises(SystemExit):
                migrate_legacy.main(argv)
        with self.assertRaises(ValueError):
            migrate_legacy.plan("assembly", [])
        with self.assertRaises(ValueError):
            migrate_legacy.apply("assembly", ["NOPE"], model=self.model, client=self.chroma)


class StartupTests(PurposeIsolationBase):
    def test_missing_legacy_collection_only_blocks_legacy_api(self):
        from types import SimpleNamespace
        from fastapi import HTTPException
        from error_case_store import legacy_collection
        app = SimpleNamespace(state=SimpleNamespace(collection=None))
        with self.assertRaises(HTTPException) as caught:
            legacy_collection(app)
        self.assertEqual(caught.exception.status_code, 503)
        # 목적별 컬렉션은 기존 컬렉션 없이도 준비된다.
        self.assertEqual(len(ensure_collections(self.chroma)), 3)
        self.assertNotIn("error_cases_e5_small_v1", [c.name for c in self.chroma.list_collections()])

    def test_collections_created_empty(self):
        collections = ensure_collections(self.chroma)
        self.assertEqual(sorted(c.name for c in collections.values()),
                         ["assembly_errors_v1", "manufacturing_errors_v1", "verification_errors_v1"])
        self.assertTrue(all(c.count() == 0 for c in collections.values()))
        # 두 번 불러도 같은 컬렉션을 쓴다.
        self.assertEqual(sorted(c.name for c in ensure_collections(self.chroma).values()),
                         sorted(c.name for c in collections.values()))


if __name__ == "__main__":
    unittest.main()
