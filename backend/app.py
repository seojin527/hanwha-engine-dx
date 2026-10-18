import json
from contextlib import asynccontextmanager
from pathlib import Path

import chromadb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer


BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 시작 시 한 번만 불러오기
    json_path = BASE_DIR.parent / "data" / "1_metadata.json"
    app.state.drawing = json.loads(
        json_path.read_text(encoding="utf-8-sig")
    )

    app.state.model = SentenceTransformer(
        "intfloat/multilingual-e5-small",
        device="cpu",
    )

    app.state.client = chromadb.PersistentClient(
        path=str(BASE_DIR / "vector_db")
    )
    app.state.collection = app.state.client.get_collection(
        name="error_cases_e5_small_v1",
        embedding_function=None,
    )
    yield


app = FastAPI(lifespan=lifespan)

# 로컬 프론트 개발 서버에서 API 호출 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/drawing")
def get_drawing():
    return app.state.drawing


@app.get("/api/items/{item_id}/errors")
def get_related_errors(
    item_id: str,
    top_k: int = Query(default=3, ge=1, le=10),
):
    drawing = app.state.drawing
    item = next(
        (
            entry for entry in drawing["items"]
            if entry["item_id"] == item_id
        ),
        None,
    )

    if item is None:
        raise HTTPException(404, "측정항목을 찾을 수 없습니다.")

    collection = app.state.collection

    # 확정된 형상만 필터에 사용
    feature = item.get("feature_type")
    where = None
    if feature and feature != "UNKNOWN":
        where = {"feature_type": feature}

    candidates = collection.get(
        where=where,
        include=["metadatas"],
    )
    candidate_count = len(candidates["ids"])

    errors = []

    if candidate_count:
        vector = app.state.model.encode(
            [f"query: {item['retrieval_query']}"],
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
            errors.append({
                **(metadata or {}),
                "case_id": case_id,
                "distance": float(distance),
            })

    return {
        "drawing_id": drawing["drawing_id"],
        "item_id": item_id,
        "raw_text": item["raw_text"],
        "requires_review": item.get("requires_review", False),
        "review_reasons": item.get("review_reasons", []),
        "result_type": "candidate",
        "errors": errors,
    }