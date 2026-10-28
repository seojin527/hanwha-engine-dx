"""목적별 Chroma 컬렉션 반영·검색 (공통 코드).

임베딩 모델(E5)은 기존 것을 함께 쓰고, 컬렉션은 목적마다 따로 쓴다.
컬렉션이 비어 있으면 빈 결과를 돌려주며, 기존 공통 컬렉션으로 넘어가지 않는다.
"""

from .purposes import STORES, Purpose, PurposeStore
from . import store as case_store

MODEL_NAME = "intfloat/multilingual-e5-small"


def ensure_collections(client) -> dict[Purpose, object]:
    """세 목적의 컬렉션을 준비한다. 없으면 빈 컬렉션을 만든다 (서버가 빈 상태로도 시작되도록)."""
    return {
        purpose: client.get_or_create_collection(
            name=purpose_store.collection,
            embedding_function=None,
            metadata={"embedding_model": MODEL_NAME, "purpose": purpose.value},
        )
        for purpose, purpose_store in STORES.items()
    }


def _metadata(store: PurposeStore, row: dict, source_file: str) -> dict:
    metadata = {key: str(row.get(key) or "") for key in store.schema.METADATA_FIELDS}
    metadata["purpose"] = store.purpose.value
    metadata["source_file"] = source_file
    metadata["embedding_model"] = MODEL_NAME
    return metadata


def index_cases(store: PurposeStore, collection, model, case_ids: list[str], source_file: str) -> str:
    """원문 테이블의 사례를 이 목적의 컬렉션에 반영한다. 결과 상태('ready'|'failed')를 기록·반환한다."""
    rows = case_store.get_cases(store, case_ids)
    if len(rows) != len(case_ids):
        raise LookupError("원문 테이블에 없는 사례가 있습니다.")
    try:
        documents = [row["search_text"] for row in rows]
        vectors = model.encode(
            ["passage: " + text for text in documents],
            normalize_embeddings=True,
        )
        collection.upsert(
            ids=[row["case_id"] for row in rows],
            documents=documents,
            embeddings=vectors.tolist(),
            metadatas=[_metadata(store, row, source_file) for row in rows],
        )
    except Exception:
        # 원문은 보존한다. 사례를 다시 등록하지 않고 재시도한다.
        case_store.set_vector_status(store, case_ids, "failed")
        return "failed"
    case_store.set_vector_status(store, case_ids, "ready")
    return "ready"


def search(store: PurposeStore, collection, model, *, query_text: str, part_families: list[str], item: dict, top_k: int) -> list[dict]:
    where = store.schema.search_filter(part_families, item)
    candidates = collection.get(where=where, include=["metadatas"])
    if not candidates["ids"]:
        return []
    return query_active(store, collection, model, query_text=query_text, where=where,
                        candidate_ids=candidates["ids"], top_k=top_k)


def query_active(store: PurposeStore, collection, model, *, query_text: str, where: dict,
                 candidate_ids: list[str], top_k: int) -> list[dict]:
    """활성 사례만 돌려준다.

    비활성 여부는 원문 테이블(active)로 판단한다. 비활성화 뒤 벡터가 남아 있거나 벡터 반영에 실패해도
    검색 결과에 나오지 않는다. 비활성 사례만큼 더 받아서 거르므로 top_k 개수가 줄지 않는다.
    """
    active = case_store.active_case_ids(store, list(candidate_ids))
    if not active:
        return []
    vector = model.encode(["query: " + query_text], normalize_embeddings=True)
    result = collection.query(
        query_embeddings=vector.tolist(),
        where=where,
        n_results=min(top_k + len(candidate_ids) - len(active), len(candidate_ids)),
        include=["metadatas", "distances"],
    )
    return [
        {**(metadata or {}), "case_id": case_id, "distance": float(distance)}
        for case_id, metadata, distance in zip(
            result["ids"][0], result["metadatas"][0], result["distances"][0]
        )
        if case_id in active
    ][:top_k]
