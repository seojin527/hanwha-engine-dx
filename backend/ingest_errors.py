from pathlib import Path

import chromadb
import pandas as pd
from sentence_transformers import SentenceTransformer


BASE_DIR = Path(__file__).resolve().parent
EXCEL_PATH = (
    BASE_DIR.parent
    / "data"
    / "error_cases"
    / "RAGFlow_가상오류DB.xlsx"
)
DB_PATH = BASE_DIR / "vector_db"
MODEL_NAME = "intfloat/multilingual-e5-small"


def main():
    # 1. 엑셀 읽기
    df = pd.read_excel(
        EXCEL_PATH,
        sheet_name="오류주의사항DB",
        dtype=str,
        keep_default_na=False,
    )

    required = {"case_id", "search_text"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"필수 컬럼이 없습니다: {sorted(missing)}")

    df["case_id"] = df["case_id"].str.strip()
    df["search_text"] = df["search_text"].str.strip()

    if df.empty:
        raise ValueError("엑셀에 오류사례가 없습니다.")

    if (df["case_id"].eq("") | df["search_text"].eq("")).any():
        raise ValueError("case_id 또는 search_text가 비어 있는 행이 있습니다.")

    if df["case_id"].duplicated().any():
        raise ValueError("엑셀 안에 중복 case_id가 있습니다.")

    # 2. 모델 불러오기
    print("임베딩 모델 불러오는 중...")
    model = SentenceTransformer(MODEL_NAME, device="cpu")

    documents = df["search_text"].tolist()
    ids = df["case_id"].tolist()

    # E5 모델은 저장할 문서 앞에 passage: 를 붙임
    print(f"오류사례 {len(documents)}건을 벡터로 변환하는 중...")
    embeddings = model.encode(
        [f"passage: {text}" for text in documents],
        normalize_embeddings=True,
        show_progress_bar=True,
    )

    # 3. 원본 컬럼을 메타데이터로 보관
    metadatas = []
    for row in df.to_dict(orient="records"):
        metadata = {
            str(key): str(value)
            for key, value in row.items()
            if key != "search_text"
        }
        metadata["source_file"] = EXCEL_PATH.name
        metadata["embedding_model"] = MODEL_NAME
        metadatas.append(metadata)

    # 4. 로컬 벡터DB 열기
    client = chromadb.PersistentClient(path=str(DB_PATH))

    collection = client.get_or_create_collection(
        name="error_cases_e5_small_v1",
        embedding_function=None,
        metadata={"embedding_model": MODEL_NAME},
    )

    # 5. 새 ID는 추가, 기존 ID는 갱신
    collection.upsert(
        ids=ids,
        documents=documents,
        embeddings=embeddings.tolist(),
        metadatas=metadatas,
    )

    print(f"\n이번 적재: {len(ids)}건")
    print(f"DB 전체 사례 수: {collection.count()}건")
    print(f"DB 저장 위치: {DB_PATH}")


if __name__ == "__main__":
    main()