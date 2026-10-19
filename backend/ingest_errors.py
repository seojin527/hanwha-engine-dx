"""엑셀 오류사례를 SQLite에 저장하고 Chroma 검색에 반영한다."""

import argparse
from pathlib import Path

import chromadb
import pandas as pd
from sentence_transformers import SentenceTransformer

from drawing_library import database, init_library
from error_case_store import init_error_cases


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "vector_db"
MODEL_NAME = "intfloat/multilingual-e5-small"
COLLECTION_NAME = "error_cases_e5_small_v1"

FIELDS = [
    "case_id",
    "data_origin",
    "part_family",
    "feature_type",
    "feature_name",
    "measurement_characteristic",
    "tol_type",
    "drawing_text_example",
    "error_category",
    "case_title",
    "error_description",
    "cause",
    "precaution",
    "recommended_instrument",
    "applicable_condition",
    "exclude_condition",
    "priority",
    "part_zone",
    "error_type_code",
    "error_type",
    "severity",
    "process_stage",
    "impact",
    "corrective_action",
    "ocr_note",
    "keywords",
    "search_text",
]


def ingest_excel(excel_path):
    excel_path = Path(excel_path).resolve()

    df = pd.read_excel(
        excel_path,
        sheet_name="오류주의사항DB",
        dtype=str,
        keep_default_na=False,
    )

    required = {"case_id", "case_title", "search_text"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"필수 컬럼 누락: {sorted(missing)}")

    if df.empty:
        raise ValueError("등록할 오류사례가 없습니다.")

    # 선택 컬럼이 없으면 빈 값으로 보완한다.
    for field in FIELDS:
        if field not in df.columns:
            df[field] = ""
        df[field] = df[field].astype(str).str.strip()

    for field in required:
        if df[field].eq("").any():
            raise ValueError(f"{field}가 비어 있는 행이 있습니다.")

    if df["case_id"].duplicated().any():
        raise ValueError("엑셀에 중복 case_id가 있습니다.")

    records = df[FIELDS].to_dict(orient="records")
    ids = [row["case_id"] for row in records]

    init_library()
    init_error_cases()

    columns = ", ".join(FIELDS)
    placeholders = ", ".join("?" for _ in FIELDS)
    updates = ", ".join(
        f"{field}=excluded.{field}"
        for field in FIELDS
        if field != "case_id"
    )

    # 원문부터 저장한다. 같은 case_id는 갱신한다.
    with database() as db:
        for row in records:
            db.execute(
                f"""
                INSERT INTO error_cases ({columns})
                VALUES ({placeholders})
                ON CONFLICT(case_id) DO UPDATE SET
                    {updates},
                    vector_status='pending',
                    updated_at=CURRENT_TIMESTAMP
                """,
                [row[field] for field in FIELDS],
            )

    print(f"SQLite 원문 저장: {len(records)}건")

    try:
        print("임베딩 모델 불러오는 중...")
        model = SentenceTransformer(MODEL_NAME, device="cpu")

        documents = [row["search_text"] for row in records]
        embeddings = model.encode(
            [f"passage: {text}" for text in documents],
            normalize_embeddings=True,
            show_progress_bar=True,
        )

        metadatas = [
            {
                **{
                    key: value
                    for key, value in row.items()
                    if key != "search_text"
                },
                "source_file": excel_path.name,
                "embedding_model": MODEL_NAME,
            }
            for row in records
        ]

        client = chromadb.PersistentClient(path=str(DB_PATH))
        collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=None,
            metadata={"embedding_model": MODEL_NAME},
        )

        collection.upsert(
            ids=ids,
            documents=documents,
            embeddings=embeddings.tolist(),
            metadatas=metadatas,
        )

    except Exception:
        with database() as db:
            db.executemany(
                """
                UPDATE error_cases
                SET vector_status='failed', updated_at=CURRENT_TIMESTAMP
                WHERE case_id=?
                """,
                [(case_id,) for case_id in ids],
            )
        raise

    with database() as db:
        db.executemany(
            """
            UPDATE error_cases
            SET vector_status='ready', updated_at=CURRENT_TIMESTAMP
            WHERE case_id=?
            """,
            [(case_id,) for case_id in ids],
        )
        sqlite_count = db.execute(
            "SELECT COUNT(*) FROM error_cases"
        ).fetchone()[0]

    print(f"이번 벡터 적재: {len(ids)}건")
    print(f"SQLite 전체 오류사례: {sqlite_count}건")
    print(f"Chroma 전체 오류사례: {collection.count()}건")

    return {"imported": len(ids)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="오류사례 엑셀 경로")
    args = parser.parse_args()
    ingest_excel(args.file)


if __name__ == "__main__":
    main()