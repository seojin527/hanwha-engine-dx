"""목적별 오류사례 엑셀 일괄 적재.

실행 (backend 폴더에서):
    python -m purpose_errors.ingest --purpose manufacturing --file 오류사례.xlsx

지정한 목적의 원문 테이블과 컬렉션에만 저장한다. 목적은 반드시 지정해야 한다.
같은 case_id 는 갱신하고, 벡터 반영에 실패하면 원문은 남기고 vector_status='failed' 로 둔다.
"""

import argparse
from pathlib import Path

import pandas as pd

from drawing_library import database, init_library

from . import store as case_store
from . import vectors
from .purposes import Purpose, get_store

BASE_DIR = Path(__file__).resolve().parents[1]
VECTOR_DB_PATH = BASE_DIR / "vector_db"
DEFAULT_SHEET = "오류주의사항DB"


def read_records(store, excel_path: Path, sheet: str) -> list[dict]:
    df = pd.read_excel(excel_path, sheet_name=sheet, dtype=str, keep_default_na=False)
    required = {"case_id", "case_title", "search_text"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"필수 컬럼 누락: {sorted(missing)}")
    if df.empty:
        raise ValueError("등록할 오류사례가 없습니다.")
    records = [store.schema.excel_record(row) for row in df.to_dict(orient="records")]
    ids = [record["case_id"] for record in records]
    if len(ids) != len(set(ids)):
        raise ValueError("엑셀에 중복 case_id가 있습니다.")
    return records


def ingest_excel(purpose, excel_path, *, sheet=DEFAULT_SHEET, model=None, client=None) -> dict:
    store = get_store(purpose)
    excel_path = Path(excel_path).resolve()
    records = read_records(store, excel_path, sheet)

    init_library()
    case_store.init_purpose_tables()

    with database() as db:
        for record in records:
            case_store.insert_case(db, store, record, upsert=True)
    print(f"[{store.label}] SQLite 원문 저장: {len(records)}건 → {store.case_table}")

    if model is None:
        from sentence_transformers import SentenceTransformer

        print("임베딩 모델 불러오는 중...")
        model = SentenceTransformer(vectors.MODEL_NAME, device="cpu")
    if client is None:
        import chromadb

        client = chromadb.PersistentClient(path=str(VECTOR_DB_PATH))

    collection = vectors.ensure_collections(client)[store.purpose]
    ids = [record["case_id"] for record in records]
    status = vectors.index_cases(store, collection, model, ids, source_file=excel_path.name)

    print(f"[{store.label}] 벡터 반영: {status} ({len(ids)}건) → {store.collection}")
    print(f"[{store.label}] SQLite 전체: {case_store.count_cases(store)}건 · Chroma 전체: {collection.count()}건")
    if status != "ready":
        print("벡터 반영에 실패했습니다. 원문은 저장됐으며 같은 명령으로 다시 실행하거나 재시도 API 를 사용하세요.")
    return {"purpose": store.purpose.value, "imported": len(ids), "vector_status": status}


def main(argv=None):
    parser = argparse.ArgumentParser(description="목적별 오류사례 엑셀 적재")
    parser.add_argument("--purpose", required=True, choices=[p.value for p in Purpose], help="적재할 작업 목적")
    parser.add_argument("--file", required=True, help="오류사례 엑셀 경로")
    parser.add_argument("--sheet", default=DEFAULT_SHEET, help=f"시트 이름 (기본: {DEFAULT_SHEET})")
    args = parser.parse_args(argv)
    result = ingest_excel(args.purpose, args.file, sheet=args.sheet)
    return 0 if result["vector_status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
