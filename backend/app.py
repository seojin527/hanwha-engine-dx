import json
from contextlib import asynccontextmanager

import chromadb
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer

from drawing_library import init_library
from drawing_library import router as library_router
from error_case_api import router as error_case_router
from error_case_store import init_error_cases, legacy_collection
from ocr_api import router as ocr_router
from ocr_results import init_ocr_results
from ocr_review.api import router as review_router
from measurement_api import init_measurements
from measurement_api import router as measurement_router
from purpose_errors.api import router as purpose_error_router
from purpose_errors.admin_api import router as purpose_admin_router
from workflow_status import router as workflow_status_router
from purpose_errors.store import init_purpose_tables
from purpose_errors.vectors import ensure_collections
from paths import LEGACY_ERROR_COLLECTION, SAMPLE_METADATA, VECTOR_DB_DIR
from machining_api import init_machining
from machining_api import router as machining_router
from deploy_guard import guard_middleware, mode_info



@asynccontextmanager
async def lifespan(app: FastAPI):
    # SQLite 테이블 준비
    init_library()
    init_ocr_results()
    init_error_cases()
    init_measurements()
    # 작업 목적(부품제작·조립·검증)별 오류사례 원문·연결 기록 테이블
    init_purpose_tables()
    # 부품제작 황삭·중삭·정삭 기록 테이블
    init_machining()
    # 이전 단일 도면 API에서 사용하는 JSON
    app.state.drawing = json.loads(
        SAMPLE_METADATA.read_text(encoding="utf-8-sig")
    )

    # 검색과 신규 오류사례 임베딩에 사용할 모델
    app.state.model = SentenceTransformer(
        "intfloat/multilingual-e5-small",
        device="cpu",
    )

    # 벡터DB 연결
    app.state.client = chromadb.PersistentClient(
        path=str(VECTOR_DB_DIR)
    )
    # 기존 공통 컬렉션 (보존용·이전 API 전용). 없으면 만들지 않고 이전 API 만 503 을 돌려준다.
    existing = {collection.name for collection in app.state.client.list_collections()}
    app.state.collection = (
        app.state.client.get_collection(name=LEGACY_ERROR_COLLECTION, embedding_function=None)
        if LEGACY_ERROR_COLLECTION in existing
        else None
    )

    # 목적별 오류사례 컬렉션. 비어 있어도 서버는 시작한다 (공통 컬렉션으로 대체하지 않음).
    app.state.purpose_collections = ensure_collections(app.state.client)

    yield


app = FastAPI(lifespan=lifespan)

# 부품·도면 관리
app.include_router(library_router)

# OCR 결과 조회·관련 오류사례 검색
app.include_router(ocr_router)


app.include_router(review_router)

app.include_router(measurement_router)

# 부품제작(가공 중 측정) 황삭·중삭·정삭
app.include_router(machining_router)

# 사용자 오류사례 등록·자동 벡터화
app.include_router(error_case_router)

# 작업 목적별 오류사례 등록·검색·재시도·포인트 연결
app.include_router(purpose_error_router)
# 관리자 오류 DB 관리 · 도면별 작업 진행 현황 (화면에서만 관리자에게 보인다. 서버 인증은 없다)
app.include_router(purpose_admin_router)
app.include_router(workflow_status_router)

# 로컬 프론트엔드 접근 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


# 공개 배포(DEPLOY_MODE=public)에서 변경 요청을 서버 측에서 막는다. 로컬 실행은 그대로다.
app.middleware("http")(guard_middleware)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/deploy-mode")
def get_deploy_mode(request: Request):
    return mode_info(request)


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

    collection = legacy_collection(app)
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