"""도면별 OCR 결과 조회 및 관련 오류사례 검색 API."""

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse

from ocr_results import get_result_image, read_ocr_result
from drawing_library import database


router = APIRouter(
    prefix="/api/drawings",
    tags=["OCR 결과"],
)


@router.get("/{drawing_id}/ocr")
def get_ocr(drawing_id: str):
    return read_ocr_result(drawing_id)


@router.post("/{drawing_id}/ocr/sample")
def apply_sample(drawing_id: str):
    raise HTTPException(
        409,
        "기존 PNG 샘플 적용은 중단했습니다. "
        "도면에 맞는 JPG·TXT를 적재해주세요.",
    )


@router.get("/{drawing_id}/ocr/image")
def ocr_image(drawing_id: str, revision: str | None = None):
    path = get_result_image(drawing_id, revision)

    media_type = (
        "image/jpeg"
        if path.suffix.lower() in {".jpg", ".jpeg"}
        else "image/png"
    )

    return FileResponse(path, media_type=media_type)


def retrieval_query(item):
    parts = [f"도면 표기 {item['raw_text']}"]

    fields = [
        ("measurement_characteristic", "검사 특성"),
        ("feature_type", "형상"),
        ("tol_type", "공차 유형"),
    ]

    for key, label in fields:
        value = item.get(key)
        if value and value not in ("UNKNOWN", "UNSPECIFIED"):
            parts.append(f"{label} {value}")

    parts.append("관련 측정 오류사례와 주의사항 검색")
    return ". ".join(parts)


@router.get("/{drawing_id}/items/{item_id}/errors")
def item_errors(
    drawing_id: str,
    item_id: str,
    request: Request,
    top_k: int = Query(default=3, ge=1, le=10),
):
    snapshot = read_ocr_result(drawing_id)

    if snapshot["result"] is None:
        raise HTTPException(
            409,
            "OCR추출 결과를 먼저 저장해주세요.".replace("抽出", "추출"),
        )

    item = next(
        (
            entry
            for entry in snapshot["result"]["items"]
            if entry["id"] == item_id
        ),
        None,
    )

    if item is None:
        raise HTTPException(
            404,
            "이 도면의 측정항목을 찾을 수 없습니다.",
        )

    collection = request.app.state.collection
    feature = item.get("feature_type")

    with database() as db:
        part = db.execute("SELECT p.name FROM drawings d JOIN parts p ON p.part_id=d.part_id WHERE d.drawing_id=?", (drawing_id,)).fetchone()
    family = part["name"] if part else ""
    if family.replace(" ", "") == "피스톤로드":
        family = "피스톤 로드"
    families = [family] if family else []
    # 원문 표제란이 피스톤로드인 경우 기존 공통 피스톤로드 사례도 함께 검색한다.
    part_name = str(snapshot['result'].get('part_name') or '').replace(' ', '').upper()
    if part_name in ('PISTONROD', '피스톤로드') and '피스톤 로드' not in families:
        families.append('피스톤 로드')
    if not families:
        raise HTTPException(409, "도면의 소속 부품을 확인해주세요.")
    conditions = [{"part_family": {"$in": families}}]

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

    errors = []

    if candidates["ids"]:
        vector = request.app.state.model.encode(
            ["query: " + retrieval_query(item)],
            normalize_embeddings=True,
        )

        result = collection.query(
            query_embeddings=vector.tolist(),
            where=where,
            n_results=min(top_k, len(candidates["ids"])),
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
        "drawing_id": drawing_id,
        "item_id": item_id,
        "revision": snapshot["revision"],
        "result_type": "candidate",
        "errors": errors,
    }