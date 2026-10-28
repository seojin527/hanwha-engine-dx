"""사용자 입력 오류사례 등록 및 벡터 검색 반영."""

from uuid import uuid4

from fastapi import APIRouter, Body, HTTPException, Request

from drawing_library import database
from error_case_store import init_error_cases, legacy_collection


router = APIRouter(prefix="/api/error-cases", tags=["오류사례"])

MODEL_NAME = "intfloat/multilingual-e5-small"

# 엑셀과 화면 입력에서 공통으로 사용하는 필드
INPUT_FIELDS = (
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
)

REQUIRED_FIELDS = (
    "part_family",
    "case_title",
    "error_description",
    "precaution",
)

LABELS = {
    "part_family": "부품",
    "feature_type": "형상",
    "feature_name": "형상 이름",
    "measurement_characteristic": "측정 특성",
    "tol_type": "공차 유형",
    "drawing_text_example": "도면 표기",
    "error_category": "오류 분류",
    "case_title": "오류 제목",
    "error_description": "오류 상황",
    "cause": "원인",
    "precaution": "주의사항",
    "recommended_instrument": "측정기 후보",
    "applicable_condition": "적용 조건",
    "exclude_condition": "제외 조건",
    "priority": "우선순위",
    "part_zone": "부품 구역",
    "error_type_code": "오류 유형 코드",
    "error_type": "오류 유형",
    "severity": "심각도",
    "process_stage": "공정",
    "impact": "영향",
    "corrective_action": "시정조치",
    "ocr_note": "OCR 참고",
    "keywords": "키워드",
}


def validate_input(payload):
    unknown = set(payload) - set(INPUT_FIELDS)
    if unknown:
        raise HTTPException(422, f"지원하지 않는 필드: {sorted(unknown)}")

    data = {}

    for field in INPUT_FIELDS:
        value = payload.get(field, "")
        if not isinstance(value, str):
            raise HTTPException(422, f"{field}는 문자열이어야 합니다.")

        value = value.strip()
        if len(value) > 10000:
            raise HTTPException(422, f"{field}는 10,000자 이하여야 합니다.")

        data[field] = value

    for field in REQUIRED_FIELDS:
        if not data[field]:
            raise HTTPException(422, f"{LABELS[field]}을 입력해주세요.")

    data["feature_type"] = data["feature_type"].upper() or "UNKNOWN"
    data["tol_type"] = data["tol_type"].upper() or "UNSPECIFIED"

    allowed_features = {
        "UNKNOWN", "HOLE", "SHAFT", "PLANE", "SLOT",
        "THREAD", "EDGE", "RADIUS", "CHAMFER", "SURFACE",
    }

    if data["feature_type"] not in allowed_features:
        raise HTTPException(422, "지원하지 않는 feature_type입니다.")

    # 기존 엑셀의 표기와 일치하도록 정규화
    if data["part_family"].replace(" ", "") == "피스톤로드":
        data["part_family"] = "피스톤 로드"

    return data


def build_search_text(data):
    return ". ".join(
        f"{LABELS[field]}: {data[field]}"
        for field in INPUT_FIELDS
        if data.get(field)
    )


def get_case(case_id):
    with database() as db:
        row = db.execute(
            "SELECT * FROM error_cases WHERE case_id=?",
            (case_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(404, "오류사례를 찾을 수 없습니다.")

    return dict(row)


def index_case(case_id, request):
    """SQLite 원문을 읽어 현재 백엔드의 모델·컬렉션에 반영한다."""
    row = get_case(case_id)

    try:
        vector = request.app.state.model.encode(
            ["passage: " + row["search_text"]],
            normalize_embeddings=True,
        )

        metadata = {
            key: row[key]
            for key in ("case_id", "data_origin", *INPUT_FIELDS)
        }
        metadata["source_file"] = "user_form"
        metadata["embedding_model"] = MODEL_NAME

        legacy_collection(request.app).upsert(
            ids=[case_id],
            documents=[row["search_text"]],
            embeddings=vector.tolist(),
            metadatas=[metadata],
        )

    except Exception:
        with database() as db:
            db.execute(
                """
                UPDATE error_cases
                SET vector_status='failed', updated_at=CURRENT_TIMESTAMP
                WHERE case_id=?
                """,
                (case_id,),
            )

        # 원문은 보존한다. 사용자는 사례를 중복 등록하지 않고 재시도한다.
        return {
            "case_id": case_id,
            "saved": True,
            "vector_status": "failed",
            "message": "원문 저장 완료. 검색 반영에 실패해 재시도가 필요합니다.",
        }

    with database() as db:
        db.execute(
            """
            UPDATE error_cases
            SET vector_status='ready', updated_at=CURRENT_TIMESTAMP
            WHERE case_id=?
            """,
            (case_id,),
        )

    return {
        "case_id": case_id,
        "saved": True,
        "vector_status": "ready",
        "message": "원문 저장과 검색 반영이 완료됐습니다.",
    }


@router.post("", status_code=201)
def create_case(request: Request, payload: dict = Body(...)):
    data = validate_input(payload)

    data["case_id"] = "USR-" + uuid4().hex
    data["data_origin"] = "USER_REPORTED"
    data["search_text"] = build_search_text(data)

    fields = list(data)
    columns = ", ".join(fields)
    placeholders = ", ".join("?" for _ in fields)

    with database() as db:
        db.execute(
            f"INSERT INTO error_cases ({columns}) VALUES ({placeholders})",
            [data[field] for field in fields],
        )

    return index_case(data["case_id"], request)


@router.post("/{case_id}/retry-index")
def retry_index(case_id: str, request: Request):
    return index_case(case_id, request)


@router.get("/{case_id}")
def read_case(case_id: str):
    return get_case(case_id)