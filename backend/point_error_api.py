"""선택한 도면 포인트에서 오류사례 등록."""

import json
from uuid import uuid4

from fastapi import APIRouter, Body, HTTPException, Request

from drawing_library import database
from error_case_api import (
    build_search_text,
    index_case,
    validate_input,
)
from ocr_results import read_ocr_result


router = APIRouter(
    prefix="/api/drawings",
    tags=["포인트 오류사례"],
)

# 사용자가 직접 작성할 내용.
# 도면·항목 정보는 요청값을 믿지 않고 서버에서 가져온다.
MANUAL_FIELDS = {
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
}


def init_point_errors():
    with database() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS point_error_reports (
                report_id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL UNIQUE
                    REFERENCES error_cases(case_id),
                drawing_id TEXT NOT NULL
                    REFERENCES drawings(drawing_id),
                item_id TEXT NOT NULL,
                ocr_revision TEXT NOT NULL,
                item_snapshot_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


@router.post(
    "/{drawing_id}/items/{item_id}/error-cases",
    status_code=201,
)
def create_point_error(
    drawing_id: str,
    item_id: str,
    request: Request,
    payload: dict = Body(...),
):
    unknown = set(payload) - MANUAL_FIELDS - {"revision"}
    if unknown:
        raise HTTPException(
            422,
            f"지원하지 않는 필드: {sorted(unknown)}",
        )

    snapshot = read_ocr_result(drawing_id)

    if snapshot["result"] is None:
        raise HTTPException(409, "OCR 결과가 없는 도면입니다.")

    revision = payload.get("revision")
    if revision != snapshot["revision"]:
        raise HTTPException(
            409,
            "OCR 결과가 변경됐습니다. 도면을 다시 선택해주세요.",
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
        raise HTTPException(404, "해당 도면의 항목이 아닙니다.")

    with database() as db:
        part = db.execute(
            """
            SELECT p.name
            FROM drawings d
            JOIN parts p ON p.part_id = d.part_id
            WHERE d.drawing_id = ?
            """,
            (drawing_id,),
        ).fetchone()

    if part is None:
        raise HTTPException(404, "소속 부품을 찾을 수 없습니다.")

    # 도면과 선택 항목에서 자동으로 채우는 값
    values = {
        key: payload[key]
        for key in MANUAL_FIELDS
        if key in payload
    }
    values.update({
        "part_family": part["name"],
        "feature_type": item.get("feature_type") or "UNKNOWN",
        "measurement_characteristic": (
            item.get("measurement_characteristic") or ""
        ),
        "tol_type": item.get("tol_type") or "UNSPECIFIED",
        "drawing_text_example": item["raw_text"],
    })

    data = validate_input(values)
    data["case_id"] = "USR-" + uuid4().hex
    data["data_origin"] = "USER_REPORTED"
    data["search_text"] = build_search_text(data)

    report_id = "RPT-" + uuid4().hex
    fields = list(data)
    columns = ", ".join(fields)
    placeholders = ", ".join("?" for _ in fields)

    init_point_errors()

    # 사례 원문과 포인트 연결 기록을 함께 저장한다.
    with database() as db:
        current = db.execute(
            "SELECT revision FROM ocr_results WHERE drawing_id=?",
            (drawing_id,),
        ).fetchone()

        if current is None or current["revision"] != revision:
            raise HTTPException(
                409,
                "저장 중 OCR 결과가 변경됐습니다. 다시 확인해주세요.",
            )

        db.execute(
            f"INSERT INTO error_cases ({columns}) VALUES ({placeholders})",
            [data[field] for field in fields],
        )

        db.execute(
            """
            INSERT INTO point_error_reports (
                report_id,
                case_id,
                drawing_id,
                item_id,
                ocr_revision,
                item_snapshot_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                report_id,
                data["case_id"],
                drawing_id,
                item_id,
                revision,
                json.dumps(item, ensure_ascii=False),
            ),
        )

    # 기존 등록 API의 벡터화 함수를 재사용한다.
    result = index_case(data["case_id"], request)

    return {
        **result,
        "report_id": report_id,
        "drawing_id": drawing_id,
        "item_id": item_id,
        "revision": revision,
    }