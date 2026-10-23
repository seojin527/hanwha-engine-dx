import json
from contextlib import asynccontextmanager
from pathlib import Path

import chromadb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer

from drawing_library import init_library
from drawing_library import router as library_router
from error_case_api import router as error_case_router
from error_case_store import init_error_cases
from ocr_api import router as ocr_router
from ocr_results import init_ocr_results
from ocr_review.api import router as review_router
from measurement_api import init_measurements
from measurement_api import router as measurement_router

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    # SQLite 테이블 준비
    init_library()
    init_ocr_results()
    init_error_cases()
    init_measurements()
    # 이전 단일 도면 API에서 사용하는 JSON
    json_path = BASE_DIR.parent / "data" / "1_metadata.json"
    app.state.drawing = json.loads(
        json_path.read_text(encoding="utf-8-sig")
    )

    # 검색과 신규 오류사례 임베딩에 사용할 모델
    app.state.model = SentenceTransformer(
        "intfloat/multilingual-e5-small",
        device="cpu",
    )

    # 기존 오류사례 벡터DB 연결
    app.state.client = chromadb.PersistentClient(
        path=str(BASE_DIR / "vector_db")
    )
    app.state.collection = app.state.client.get_collection(
        name="error_cases_e5_small_v1",
        embedding_function=None,
    )

    yield


app = FastAPI(lifespan=lifespan)

# 부품·도면 관리
app.include_router(library_router)

# OCR 결과 조회·관련 오류사례 검색
app.include_router(ocr_router)


app.include_router(review_router)

app.include_router(measurement_router)

# 사용자 오류사례 등록·자동 벡터화
app.include_router(error_case_router)

# 로컬 프론트엔드 접근 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


# 아래 두 경로는 이전 단일 도면 테스트용으로 유지한다.
# 현재 도면별 화면은 ocr_api.py의 API를 사용한다.

@app.get("/api/drawing")
def get_drawing():
    return app.state.drawing


@app.get("/api/items/{item_id}/errors")
def get_related_errors(
    item_id: str,
    top_k: int = Query(default=3, ge=1, le=10),
):
    drawing = app.state.drawing

    # 구형 item_id와 신형 id 모두 지원
    item = next(
        (
            entry
            for entry in drawing.get("items", [])
            if entry.get("item_id", entry.get("id")) == item_id
        ),
        None,
    )

    if item is None:
        raise HTTPException(404, "측정항목을 찾을 수 없습니다.")

    collection = app.state.collection
    feature = item.get("feature_type")

    # 현재 피스톤로드 테스트용 검색 범위
    conditions = [{"part_family": "피스톤 로드"}]

    if feature and feature != "UNKNOWN":
        conditions.append({"feature_type": feature})

    where = (
        {"$and": conditions}
        if len(conditions) > 1
        else conditions[0]
    )

    candidates = collection.get(
        where=where,
        include=["metadatas"],
    )
    candidate_count = len(candidates["ids"])

    errors = []

    if candidate_count:
        from ocr_api import retrieval_query

        query_text = item.get("retrieval_query") or retrieval_query(item)

        vector = app.state.model.encode(
            [f"query: {query_text}"],
            normalize_embeddings=True,
        )

        result = collection.query(
            query_embeddings=vector.tolist(),
            n_results=min(top_k, candidate_count),
            where=where,
            include=["metadatas", "distances"],
        )

        for case_id, metadata, distance in zip(
            result["ids"][0],
            result["metadatas"][0],
            result["distances"][0],
        ):
            errors.append(
                {
                    **(metadata or {}),
                    "case_id": case_id,
                    "distance": float(distance),
                }
            )

    return {
        "drawing_id": drawing["drawing_id"],
        "item_id": item_id,
        "raw_text": item["raw_text"],
        "requires_review": item.get("requires_review", False),
        "review_reasons": item.get("review_reasons", []),
        "result_type": "candidate",
        "errors": errors,
    }


from point_error_api import router as point_error_router
app.include_router(point_error_router)