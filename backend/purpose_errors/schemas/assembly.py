"""조립 오류사례 원문 스키마와 입력 검증.

이 파일만 고치면 조립 사례의 필드·검증·검색 문장을 바꿀 수 있다.
부품제작·검증 스키마와는 코드를 공유하지 않는다 (처음에는 기존 error_cases 와 같은 필드).
"""

PURPOSE = "assembly"

# 사용자가 입력하거나 엑셀에서 읽는 필드
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

FEATURE_TYPES = {
    "UNKNOWN", "HOLE", "SHAFT", "PLANE", "SLOT",
    "THREAD", "EDGE", "RADIUS", "CHAMFER",
}

# 작업 화면의 포인트 등록 폼에서 사용자가 직접 쓰는 필드.
# 도면·항목 정보(point_autofill)는 요청값을 믿지 않고 서버에서 채운다.
MANUAL_FIELDS = frozenset({
    "case_title",
    "error_description",
    "cause",
    "precaution",
    "recommended_instrument",
    "applicable_condition",
    "exclude_condition",
    "priority",
    "part_zone",
    "error_category",
    "error_type_code",
    "error_type",
    "severity",
    "process_stage",
    "impact",
    "corrective_action",
    "ocr_note",
    "keywords",
})

# 원문 테이블에 저장하는 사례 필드 (엑셀 적재·이관과 같은 순서)
RECORD_FIELDS = ("case_id", "data_origin", *INPUT_FIELDS, "search_text")

# 벡터 메타데이터로 함께 저장하는 필드
METADATA_FIELDS = ("case_id", "data_origin", *INPUT_FIELDS)

MAX_LENGTH = 10000


def create_table_sql(table: str) -> str:
    """원문 테이블. 공통 관리 컬럼(vector_status·시각)을 포함한다."""
    columns = ",\n".join(
        f"{field} TEXT NOT NULL DEFAULT ''"
        if field not in ("case_title", "feature_type", "tol_type")
        else {
            "case_title": "case_title TEXT NOT NULL",
            "feature_type": "feature_type TEXT NOT NULL DEFAULT 'UNKNOWN'",
            "tol_type": "tol_type TEXT NOT NULL DEFAULT 'UNSPECIFIED'",
        }[field]
        for field in ("data_origin", *INPUT_FIELDS, "search_text")
    )
    return f"""
        CREATE TABLE IF NOT EXISTS {table} (
            case_id TEXT PRIMARY KEY,
            {columns},
            vector_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (vector_status IN ('pending', 'ready', 'failed')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """


def validate_input(payload: dict) -> dict:
    """입력값 검증·정규화. 잘못된 값은 ValueError (API 에서 422 로 바꾼다)."""
    unknown = set(payload) - set(INPUT_FIELDS)
    if unknown:
        raise ValueError(f"지원하지 않는 필드: {sorted(unknown)}")

    data = {}
    for field in INPUT_FIELDS:
        value = payload.get(field, "")
        if not isinstance(value, str):
            raise ValueError(f"{field}는 문자열이어야 합니다.")
        value = value.strip()
        if len(value) > MAX_LENGTH:
            raise ValueError(f"{field}는 10,000자 이하여야 합니다.")
        data[field] = value

    for field in REQUIRED_FIELDS:
        if not data[field]:
            raise ValueError(f"{LABELS[field]}을 입력해주세요.")

    data["feature_type"] = data["feature_type"].upper() or "UNKNOWN"
    data["tol_type"] = data["tol_type"].upper() or "UNSPECIFIED"

    if data["feature_type"] not in FEATURE_TYPES:
        raise ValueError("지원하지 않는 feature_type입니다.")

    data["part_family"] = normalize_part_family(data["part_family"])
    return data


def normalize_part_family(value: str) -> str:
    # 기존 엑셀의 표기와 일치하도록 정규화
    if value.replace(" ", "") == "피스톤로드":
        return "피스톤 로드"
    return value


def build_search_text(data: dict) -> str:
    return ". ".join(
        f"{LABELS[field]}: {data[field]}"
        for field in INPUT_FIELDS
        if data.get(field)
    )


def point_autofill(part_name: str, item: dict) -> dict:
    """작업 화면에서 선택한 도면 항목으로 자동 채우는 값."""
    return {
        "part_family": part_name,
        "feature_type": item.get("feature_type") or "UNKNOWN",
        "measurement_characteristic": item.get("measurement_characteristic") or "",
        "tol_type": item.get("tol_type") or "UNSPECIFIED",
        "drawing_text_example": item["raw_text"],
    }


def search_filter(part_families: list[str], item: dict) -> dict:
    """검색 후보를 좁히는 Chroma where 조건."""
    conditions = [{"part_family": {"$in": part_families}}]
    feature = item.get("feature_type")
    if feature and feature != "UNKNOWN":
        conditions.append({"feature_type": feature})
    return {"$and": conditions} if len(conditions) > 1 else conditions[0]


def excel_record(row: dict) -> dict:
    """엑셀 한 행을 원문 레코드로 정리한다. 필수 값이 없으면 ValueError."""
    record = {field: str(row.get(field, "") or "").strip() for field in RECORD_FIELDS}
    for field in ("case_id", "case_title", "search_text"):
        if not record[field]:
            raise ValueError(f"{field}가 비어 있는 행이 있습니다.")
    record["feature_type"] = record["feature_type"].upper() or "UNKNOWN"
    record["tol_type"] = record["tol_type"].upper() or "UNSPECIFIED"
    record["part_family"] = normalize_part_family(record["part_family"])
    return record
