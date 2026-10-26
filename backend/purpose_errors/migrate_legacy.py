"""기존 공통 오류사례(error_cases)를 지정한 목적의 저장소로 옮기는 명령.

기존 원문(error_cases·point_error_reports)과 기존 컬렉션(error_cases_e5_small_v1)은 읽기만 하며,
--apply 를 붙여도 바꾸거나 지우지 않는다. 사례와 목적은 사용자가 직접 고른다.

사용 예 (backend 폴더에서):
    python -m purpose_errors.migrate_legacy --list
    python -m purpose_errors.migrate_legacy --purpose assembly --case-id EC-001 --case-id EC-002          # 미리보기
    python -m purpose_errors.migrate_legacy --purpose assembly --case-id EC-001 --case-id EC-002 --apply  # 실제 이관
"""

import argparse
from pathlib import Path

from drawing_library import database, init_library

from . import store as case_store
from . import vectors
from .purposes import STORES, Purpose, get_store

BASE_DIR = Path(__file__).resolve().parents[1]
VECTOR_DB_PATH = BASE_DIR / "vector_db"
LEGACY_TABLE = "error_cases"
LEGACY_REPORT_TABLE = "point_error_reports"


def _table_exists(db, name: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _in_store(db, store, case_id: str) -> bool:
    """목적 테이블에 사례가 있는지 (테이블이 아직 없으면 없음). 읽기만 한다."""
    if not _table_exists(db, store.case_table):
        return False
    return db.execute(f"SELECT 1 FROM {store.case_table} WHERE case_id=?", (case_id,)).fetchone() is not None


def list_legacy_cases() -> list[dict]:
    with database() as db:
        if not _table_exists(db, LEGACY_TABLE):
            return []
        rows = [dict(row) for row in db.execute(
            f"SELECT case_id, data_origin, part_family, case_title FROM {LEGACY_TABLE} ORDER BY case_id"
        )]
        for row in rows:
            row["migrated_to"] = [p.value for p, s in STORES.items() if _in_store(db, s, row["case_id"])]
    return rows


def plan(purpose, case_ids: list[str]) -> dict:
    """선택한 사례별 이관 가능 여부를 확인한다. 아무것도 쓰지 않는다."""
    store = get_store(purpose)
    if not case_ids:
        raise ValueError("이관할 사례를 --case-id 로 하나 이상 지정해주세요.")
    if len(case_ids) != len(set(case_ids)):
        raise ValueError("같은 case_id 를 두 번 지정했습니다.")

    items = []
    with database() as db:
        has_reports = _table_exists(db, LEGACY_REPORT_TABLE)
        for case_id in case_ids:
            legacy = db.execute(f"SELECT * FROM {LEGACY_TABLE} WHERE case_id=?", (case_id,)).fetchone() \
                if _table_exists(db, LEGACY_TABLE) else None
            reports = [dict(row) for row in db.execute(
                f"SELECT * FROM {LEGACY_REPORT_TABLE} WHERE case_id=?", (case_id,)
            )] if has_reports else []
            other = [p.value for p, s in STORES.items() if p != store.purpose and _in_store(db, s, case_id)]
            in_target = _in_store(db, store, case_id)
            if legacy is None:
                action, reason = "error", "기존 error_cases 에 없는 사례입니다."
            elif other:
                action, reason = "error", f"이미 다른 목적({', '.join(other)})으로 이관된 사례입니다."
            elif in_target:
                action, reason = "skip", "이미 이 목적에 있습니다."
            else:
                action, reason = "copy", ""
            items.append({
                "case_id": case_id,
                "action": action,
                "reason": reason,
                "case_title": legacy["case_title"] if legacy else "",
                "data_origin": legacy["data_origin"] if legacy else "",
                "point_reports": len(reports),
                "_legacy": dict(legacy) if legacy else None,
                "_reports": reports,
            })
    return {"purpose": store.purpose.value, "target_table": store.case_table, "target_collection": store.collection, "items": items}


def apply(purpose, case_ids: list[str], *, model=None, client=None) -> dict:
    """미리보기와 같은 검사를 통과한 사례만 목적 저장소로 복사한다. 기존 데이터는 바꾸지 않는다."""
    store = get_store(purpose)
    case_store.init_purpose_tables()
    result = plan(purpose, case_ids)
    errors = [item for item in result["items"] if item["action"] == "error"]
    if errors:
        raise ValueError("이관할 수 없는 사례가 있어 중단했습니다: " + "; ".join(f"{e['case_id']}: {e['reason']}" for e in errors))

    to_copy = [item for item in result["items"] if item["action"] == "copy"]
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        for item in to_copy:
            record = store.schema.excel_record(item["_legacy"])
            case_store.insert_case(db, store, record)
            for report in item["_reports"]:
                db.execute(
                    f"""
                    INSERT INTO {store.report_table} (
                        report_id, case_id, drawing_id, item_id, ocr_revision, item_snapshot_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (report["report_id"], report["case_id"], report["drawing_id"], report["item_id"],
                     report["ocr_revision"], report["item_snapshot_json"], report["created_at"]),
                )

    status = "skipped"
    if to_copy:
        if model is None:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(vectors.MODEL_NAME, device="cpu")
        if client is None:
            import chromadb

            client = chromadb.PersistentClient(path=str(VECTOR_DB_PATH))
        collection = vectors.ensure_collections(client)[store.purpose]
        status = vectors.index_cases(
            store, collection, model, [item["case_id"] for item in to_copy], source_file="legacy:error_cases"
        )
    return {
        "purpose": store.purpose.value,
        "copied": [item["case_id"] for item in to_copy],
        "skipped": [item["case_id"] for item in result["items"] if item["action"] == "skip"],
        "vector_status": status,
    }


def _print_plan(result: dict):
    print(f"대상 목적: {result['purpose']} → {result['target_table']} / {result['target_collection']}")
    for item in result["items"]:
        mark = {"copy": "이관 예정", "skip": "건너뜀", "error": "불가"}[item["action"]]
        extra = f" · 포인트 연결 {item['point_reports']}건" if item["point_reports"] else ""
        print(f"  [{mark}] {item['case_id']} {item['case_title']} ({item['data_origin']}){extra}"
              + (f" — {item['reason']}" if item["reason"] else ""))


def main(argv=None):
    parser = argparse.ArgumentParser(description="기존 공통 오류사례를 지정한 목적 저장소로 이관 (기본: 미리보기)")
    parser.add_argument("--list", action="store_true", help="기존 공통 사례 목록과 이관 상태 보기")
    parser.add_argument("--purpose", choices=[p.value for p in Purpose], help="이관할 작업 목적")
    parser.add_argument("--case-id", action="append", default=[], help="이관할 사례 (여러 번 지정)")
    parser.add_argument("--apply", action="store_true", help="실제로 이관한다 (없으면 미리보기만)")
    args = parser.parse_args(argv)

    init_library()
    if args.list:
        for row in list_legacy_cases():
            moved = ", ".join(row["migrated_to"]) or "-"
            print(f"{row['case_id']}\t{row['data_origin']}\t{row['part_family']}\t{row['case_title']}\t이관: {moved}")
        return 0
    if not args.purpose:
        parser.error("--purpose 를 지정해주세요.")
    if not args.case_id:
        parser.error("--case-id 로 이관할 사례를 하나 이상 지정해주세요.")

    if not args.apply:
        _print_plan(plan(args.purpose, args.case_id))
        print("\n미리보기입니다. 실제로 이관하려면 --apply 를 붙여 다시 실행하세요.")
        return 0

    result = apply(args.purpose, args.case_id)
    print(f"이관 완료: {len(result['copied'])}건 · 건너뜀 {len(result['skipped'])}건 · 벡터 {result['vector_status']}")
    return 0 if result["vector_status"] in ("ready", "skipped") else 1


if __name__ == "__main__":
    raise SystemExit(main())
