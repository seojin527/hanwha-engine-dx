"""목적별 오류사례 엑셀 적재 (단일·일괄).

실행 (backend 폴더에서):
    # 파일 하나
    python -m purpose_errors.ingest --purpose manufacturing --file ../data/manufacturing/RAGFlow_피스톤로드_가공_오류DB.xlsx
    # 여러 파일
    python -m purpose_errors.ingest --purpose verification --file A.xlsx --file B.xlsx
    # data/<목적>/ 의 모든 엑셀
    python -m purpose_errors.ingest --purpose verification --all

지정한 목적의 원문 테이블과 컬렉션에만 저장한다. 목적은 반드시 지정해야 한다.
여러 파일은 먼저 모두 검사하고 (필수 컬럼·값 형식·파일 간 중복 case_id), 문제가 없을 때만 저장한다.
같은 case_id 는 갱신하고, 벡터 반영에 실패하면 원문은 남기고 vector_status='failed' 로 둔다.
검증·반영 규칙은 관리자 화면과 같은 purpose_errors/excel.py 에 있다.
"""

import argparse
from pathlib import Path

from drawing_library import init_library
from paths import ERROR_EXCEL_DIRS, VECTOR_DB_DIR as VECTOR_DB_PATH

from . import excel
from . import store as case_store
from . import vectors
from .purposes import Purpose, get_store

DEFAULT_SHEET = excel.DEFAULT_SHEET


def excel_files_for(purpose) -> list[Path]:
    """data/<목적>/ 의 엑셀 파일 (임시 파일 ~$ 제외)."""
    folder = ERROR_EXCEL_DIRS[get_store(purpose).purpose.value]
    return sorted(path for path in folder.glob("*.xlsx") if not path.name.startswith("~$"))


def ingest_files(purpose, excel_paths, *, sheet=DEFAULT_SHEET, model=None, client=None) -> dict:
    """검증·반영은 관리자 화면과 같은 excel 모듈을 쓴다. 적재 이력에는 source='cli' 로 남는다."""
    store = get_store(purpose)
    paths = [Path(path).resolve() for path in excel_paths]
    if not paths:
        raise ValueError("적재할 엑셀 파일이 없습니다.")

    init_library()
    case_store.init_purpose_tables()

    # 1) 모든 파일을 먼저 읽고 검사한다. 하나라도 문제가 있으면 아무것도 저장하지 않는다.
    try:
        files = excel.validate_files(store, [(path.name, path) for path in paths], sheet)
    except excel.ExcelValidationError as error:
        excel.record_rejected(store, [path.name for path in paths], error.errors, source="cli", sheet=sheet)
        raise

    # 2) 원문 저장 · 3) 벡터 반영
    if model is None:
        from sentence_transformers import SentenceTransformer

        print("임베딩 모델 불러오는 중...")
        model = SentenceTransformer(vectors.MODEL_NAME, device="cpu")
    if client is None:
        import chromadb

        client = chromadb.PersistentClient(path=str(VECTOR_DB_PATH))
    collection = vectors.ensure_collections(client)[store.purpose]

    result = excel.apply(store, files, model=model, collection=collection, source="cli")
    print(f"[{store.label}] SQLite 원문 저장: {result['rows']}건 ({len(files)}개 파일) → {store.case_table}"
          f" · 신규 {result['created']} · 갱신 {result['updated']} · 변경 없음 {result['unchanged']}")
    for entry in result["files"]:
        print(f"  {entry['file']}: {entry['rows']}건 · 벡터 {entry['vector_status']} ({entry['indexed']}건 반영)")
    print(f"[{store.label}] SQLite 전체: {case_store.count_cases(store)}건 · Chroma 전체: {collection.count()}건 ({store.collection})")
    if result["vector_status"] == "failed":
        print("벡터 반영에 실패한 파일이 있습니다. 원문은 저장됐으며 같은 명령으로 다시 실행하면 됩니다.")
    return {
        "purpose": store.purpose.value,
        "imported": result["rows"],
        "vector_status": "failed" if result["vector_status"] == "failed" else "ready",
        "files": [{"file": entry["file"], "imported": entry["rows"], "vector_status": entry["vector_status"]}
                  for entry in result["files"]],
        "upload_id": result["upload_id"],
    }


def ingest_excel(purpose, excel_path, *, sheet=DEFAULT_SHEET, model=None, client=None) -> dict:
    """파일 하나 적재 (이전 호출 방식 유지)."""
    result = ingest_files(purpose, [excel_path], sheet=sheet, model=model, client=client)
    return {key: result[key] for key in ("purpose", "imported", "vector_status")}


def main(argv=None):
    parser = argparse.ArgumentParser(description="목적별 오류사례 엑셀 적재")
    parser.add_argument("--purpose", required=True, choices=[p.value for p in Purpose], help="적재할 작업 목적")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--file", action="append", help="오류사례 엑셀 경로 (여러 번 지정 가능)")
    source.add_argument("--all", action="store_true", help="data/<목적>/ 의 모든 .xlsx 적재")
    parser.add_argument("--sheet", default=DEFAULT_SHEET, help=f"시트 이름 (기본: {DEFAULT_SHEET})")
    args = parser.parse_args(argv)

    files = excel_files_for(args.purpose) if args.all else args.file
    if args.all and not files:
        parser.error(f"{ERROR_EXCEL_DIRS[args.purpose]} 에 .xlsx 파일이 없습니다.")
    result = ingest_files(args.purpose, files, sheet=args.sheet)
    return 0 if result["vector_status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
