"""작업 목적별 오류사례 등록·조회·재시도·포인트 연결·검색 API.

모든 경로에 목적(manufacturing·assembly·verification)이 들어가며,
각 요청은 그 목적의 원문 테이블·연결 기록 테이블·컬렉션만 사용한다.
목적이 잘못되면 FastAPI 가 422 로 거부한다 (다른 저장소로 대체하지 않음).
"""

from uuid import UUID, uuid4

from fastapi import APIRouter, Body, HTTPException, Query, Request

from drawing_library import database
from ocr_results import read_ocr_result

from . import store as case_store
from . import vectors
from .purposes import Purpose, PurposeStore, get_store

router = APIRouter(prefix="/api/purposes/{purpose}", tags=["목적별 오류사례"])


# ------------------------------------------------------------------ 공통 도우미

def _collection(request: Request, store: PurposeStore):
    collections = getattr(request.app.state, "purpose_collections", None)
    if not collections or store.purpose not in collections:
        raise HTTPException(503, f"{store.label} 오류사례 검색 저장소가 준비되지 않았습니다.")
    return collections[store.purpose]


def _validate(store: PurposeStore, values: dict) -> dict:
    try:
        return store.schema.validate_input(values)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def _new_case(store: PurposeStore, data: dict) -> dict:
    data["case_id"] = f"{store.case_prefix}-USR-{uuid4().hex}"
    data["data_origin"] = "USER_REPORTED"
    data["search_text"] = store.schema.build_search_text(data)
    return data


def _index(request: Request, store: PurposeStore, case_id: str) -> dict:
    status = vectors.index_cases(
        store,
        _collection(request, store),
        request.app.state.model,
        [case_id],
        source_file="user_form",
    )
    return {
        "purpose": store.purpose.value,
        "case_id": case_id,
        "saved": True,
        "vector_status": status,
        "message": (
            "원문 저장과 검색 반영이 완료됐습니다."
            if status == "ready"
            else "원문 저장 완료. 검색 반영에 실패해 재시도가 필요합니다."
        ),
    }


def _ocr_item(drawing_id: str, item_id: str):
    snapshot = read_ocr_result(drawing_id)
    if snapshot["result"] is None:
        raise HTTPException(409, "OCR 결과가 없는 도면입니다.")
    item = next((entry for entry in snapshot["result"]["items"] if entry["id"] == item_id), None)
    if item is None:
        raise HTTPException(404, "해당 도면의 항목이 아닙니다.")
    return snapshot, item


def _part_name(drawing_id: str) -> str:
    with database() as db:
        row = db.execute(
            """
            SELECT p.name FROM drawings d
            JOIN parts p ON p.part_id = d.part_id
            WHERE d.drawing_id = ?
            """,
            (drawing_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "소속 부품을 찾을 수 없습니다.")
    return row["name"]


# ------------------------------------------------------------------ 사례 등록·조회·재시도

@router.post("/error-cases", status_code=201)
def create_case(purpose: Purpose, request: Request, payload: dict = Body(...)):
    store = get_store(purpose)
    data = _new_case(store, _validate(store, payload))
    with database() as db:
        case_store.insert_case(db, store, data)
        case_store.add_history(db, store, data["case_id"], "create", detail={"via": "form"})
    return _index(request, store, data["case_id"])


@router.get("/error-cases/{case_id}")
def read_case(purpose: Purpose, case_id: str):
    store = get_store(purpose)
    row = case_store.get_case(store, case_id)
    if row is None:
        raise HTTPException(404, f"{store.label} 오류사례에서 찾을 수 없습니다.")
    return {**row, "purpose": store.purpose.value}


@router.post("/error-cases/{case_id}/retry-index")
def retry_index(purpose: Purpose, case_id: str, request: Request):
    store = get_store(purpose)
    # 이 목적의 원문 테이블에 있는 사례만 재시도한다.
    if case_store.get_case(store, case_id) is None:
        raise HTTPException(404, f"{store.label} 오류사례에서 찾을 수 없습니다.")
    return _index(request, store, case_id)


# ------------------------------------------------------------------ 도면 포인트 연결

@router.post("/drawings/{drawing_id}/items/{item_id}/error-cases", status_code=201)
def create_point_error(purpose: Purpose, drawing_id: str, item_id: str, request: Request, payload: dict = Body(...)):
    store = get_store(purpose)
    schema = store.schema

    unknown = set(payload) - set(schema.MANUAL_FIELDS) - {"revision", "request_id"}
    if unknown:
        raise HTTPException(422, f"지원하지 않는 필드: {sorted(unknown)}")

    snapshot, item = _ocr_item(drawing_id, item_id)
    revision = payload.get("revision")
    if revision != snapshot["revision"]:
        raise HTTPException(409, "OCR 결과가 변경됐습니다. 도면을 다시 선택해주세요.")

    # 도면·항목 정보는 요청값을 믿지 않고 서버에서 채운다.
    values = {key: payload[key] for key in schema.MANUAL_FIELDS if key in payload}
    values.update(schema.point_autofill(_part_name(drawing_id), item))
    data = _new_case(store, _validate(store, values))

    try:
        token = UUID(payload["request_id"]).hex if "request_id" in payload else uuid4().hex
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, "request_id가 올바르지 않습니다.")
    report_id = "RPT-" + token

    # 사례 원문 · 포인트 등록 기록 · 이 항목과의 명시 연결 · 이력을 한 트랜잭션에서 저장한다.
    # 등록한 항목에만 연결된다. 같은 사례를 다른 항목에 쓰려면 관리자 화면에서 따로 연결한다.
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute(
            "SELECT revision FROM ocr_results WHERE drawing_id=?",
            (drawing_id,),
        ).fetchone()
        if current is None or current["revision"] != revision:
            raise HTTPException(409, "저장 중 OCR 결과가 변경됐습니다. 다시 확인해주세요.")

        existing = case_store.find_report(db, store, report_id)
        if existing:
            if (existing["drawing_id"], existing["item_id"], existing["ocr_revision"]) != (drawing_id, item_id, revision):
                raise HTTPException(409, "등록 요청이 다른 포인트에 사용됐습니다.")
            data["case_id"] = existing["case_id"]
        else:
            case_store.insert_case(db, store, data)
            case_store.insert_report(
                db, store,
                report_id=report_id,
                case_id=data["case_id"],
                drawing_id=drawing_id,
                item_id=item_id,
                revision=revision,
                item=item,
            )
            link_id = case_store.insert_link(
                db, store,
                case_id=data["case_id"], drawing_id=drawing_id, revision=revision, item_id=item_id,
                item=item, source="point_report", report_id=report_id,
            )
            point = dict(drawing_id=drawing_id, revision=revision, item_id=item_id)
            case_store.add_history(db, store, data["case_id"], "create", **point, detail={"via": "point"})
            case_store.add_history(db, store, data["case_id"], "link", **point, link_id=link_id,
                                   detail={"source": "point_report"})

    result = _index(request, store, data["case_id"])
    return {**result, "report_id": report_id, "drawing_id": drawing_id, "item_id": item_id, "revision": revision}


@router.get("/drawings/{drawing_id}/items/{item_id}/error-cases")
def list_point_errors(purpose: Purpose, drawing_id: str, item_id: str, revision: str):
    store = get_store(purpose)
    snapshot, _ = _ocr_item(drawing_id, item_id)
    if snapshot["revision"] != revision:
        raise HTTPException(409, "OCR 결과가 변경됐습니다. 도면을 다시 선택해주세요.")
    return {
        "purpose": store.purpose.value,
        "drawing_id": drawing_id,
        "item_id": item_id,
        "revision": revision,
        "reports": case_store.list_point_reports(store, drawing_id, item_id, revision),
    }


# ------------------------------------------------------------------ 검색

def part_families(drawing_id: str, snapshot: dict) -> list[str]:
    """기존 검색과 같은 부품 범위 (도면 소속 부품 + 표제란 피스톤로드)."""
    family = ""
    with database() as db:
        part = db.execute(
            "SELECT p.name FROM drawings d JOIN parts p ON p.part_id=d.part_id WHERE d.drawing_id=?",
            (drawing_id,),
        ).fetchone()
    if part:
        family = part["name"]
    if family.replace(" ", "") == "피스톤로드":
        family = "피스톤 로드"
    families = [family] if family else []
    part_name = str(snapshot["result"].get("part_name") or "").replace(" ", "").upper()
    if part_name in ("PISTONROD", "피스톤로드") and "피스톤 로드" not in families:
        families.append("피스톤 로드")
    return families


@router.get("/drawings/{drawing_id}/items/{item_id}/errors")
def item_errors(
    purpose: Purpose,
    drawing_id: str,
    item_id: str,
    request: Request,
    top_k: int = Query(default=3, ge=1, le=10),
):
    from ocr_api import retrieval_query

    store = get_store(purpose)
    snapshot = read_ocr_result(drawing_id)
    if snapshot["result"] is None:
        raise HTTPException(409, "OCR 추출 결과를 먼저 저장해주세요.")
    item = next((entry for entry in snapshot["result"]["items"] if entry["id"] == item_id), None)
    if item is None:
        raise HTTPException(404, "이 도면의 측정항목을 찾을 수 없습니다.")

    families = part_families(drawing_id, snapshot)
    if not families:
        raise HTTPException(409, "도면의 소속 부품을 확인해주세요.")

    errors = vectors.search(
        store,
        _collection(request, store),
        request.app.state.model,
        query_text=retrieval_query(item),
        part_families=families,
        item=item,
        top_k=top_k,
    )
    return {
        "purpose": store.purpose.value,
        "drawing_id": drawing_id,
        "item_id": item_id,
        "revision": snapshot["revision"],
        "result_type": "candidate",
        "errors": errors,
    }
