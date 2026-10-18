import json
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer


BASE_DIR = Path(__file__).resolve().parent

# OCR JSON 읽기
json_path = BASE_DIR.parent / "data" / "1_metadata.json"
drawing = json.loads(json_path.read_text(encoding="utf-8-sig"))

# M10 항목 선택
item = next(
    item for item in drawing["items"]
    if item["raw_text"] == "M10"
)

# 저장할 때 사용한 것과 같은 모델
model = SentenceTransformer(
    "intfloat/multilingual-e5-small",
    device="cpu",
)

# 검색 문장에는 query: 접두어 사용
query_vector = model.encode(
    [f"query: {item['retrieval_query']}"],
    normalize_embeddings=True,
)

# 기존 DB 열기: 없으면 새로 만들지 않고 오류 발생
client = chromadb.PersistentClient(
    path=str(BASE_DIR / "vector_db")
)
collection = client.get_collection(
    name="error_cases_e5_small_v1",
    embedding_function=None,
)

count = collection.count()
if count == 0:
    raise SystemExit("오류사례 DB가 비어 있습니다.")

# 우선 벡터 유사도만으로 검색
result = collection.query(
    query_embeddings=query_vector.tolist(),
    n_results=min(3, count),
    include=["documents", "metadatas", "distances"],
)

print(f"\n도면: {drawing['drawing_id']}")
print(f"선택 항목: {item['item_id']}")
print(f"도면 표기: {item['raw_text']}")
print(f"검색어: {item['retrieval_query']}")
print(f"원도면 확인 필요: {item['requires_review']}")

for rank, (case_id, metadata, distance) in enumerate(
    zip(
        result["ids"][0],
        result["metadatas"][0],
        result["distances"][0],
    ),
    start=1,
):
    print(f"\n[{rank}] {case_id}")
    print("제목:", metadata.get("case_title", ""))
    print("형상:", metadata.get("feature_type", ""))
    print("주의사항:", metadata.get("precaution", ""))
    print("적용 조건:", metadata.get("applicable_condition", ""))
    print("제외 조건:", metadata.get("exclude_condition", ""))
    print("벡터 거리:", round(distance, 4))