"""관리자용 목적별 오류 DB 관리 API.

경로마다 목적(manufacturing·assembly·verification)이 들어가며, 요청은 그 목적의 원문·연결·이력 테이블과
컬렉션만 쓴다. 다른 목적의 사례를 섞어 보여주거나 검색하지 않는다.

주의: 서버 인증이 없다. 화면에서 관리자만 이 메뉴를 보여 줄 뿐이며, 이 API 자체는 누구나 호출할 수 있다.
이력의 작성자(actor)는 확보할 수 있는 값이 없어 비워 둔다.
"""

import json
from urllib.parse import quote

from fastapi import APIRouter, Body, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from drawing_library import database
from ocr_results import read_ocr_result

from . import excel
from . import store as case_store
from . import vectors
from .api import _collection, _index, _new_case, _validate
from .purposes import Purpose, PurposeStore, get_store

router = APIRouter(prefix="/api/admin/purposes/{purpose}", tags=["관리자 오류 DB"])

MAX_FILES = 20
MAX_FILE_BYTES = 20 * 1024 * 1024
RETRY_BATCH = 64


def _case_or_404(store: PurposeStore, case_id: str) -> dict:
    row = case_store.get_case(store, case_id)
    if row is None:
        raise HTTPException(404, f"{store.label} 오류사례에서 찾을 수 없습니다.")
    return row


def _case_out(row: dict) -> dict:
    return {
        **row,
        "active": bool(row.get("active", 1)),
        "created_at": case_store.local_time(row.get("created_at")),
        "updated_at": case_store.local_time(row.get("updated_at")),
    }


def _current_revisions(db, drawing_ids) -> dict[str, str]:
    ids = sorted({drawing_id for drawing_id in drawing_ids if drawing_id})
    if not ids:
        return {}
    placeholders = ", ".join("?" for _ in ids)
    return {
        row["drawing_id"]: row["revision"]
        for row in db.execute(f"SELECT drawing_id, revision FROM ocr_results WHERE drawing_id IN ({placeholders})", ids)
    }


def _location(row: dict, current: dict[str, str]) -> dict:
    """도면 위치를 열 수 있는지. 현재 OCR 버전일 때만 현재 도면에서 위치를 연다 (과거 버전 위치는 재현하지 않는다)."""
    drawing_id, revision = row.get("drawing_id"), row.get("ocr_revision")
    if not drawing_id:
        return {"openable": False, "reason": ""}
    if drawing_id not in current:
        return {"openable": False, "reason": "도면의 OCR 결과가 없습니다."}
    if current[drawing_id] != revision:
        return {"openable": False, "reason": "이전 OCR 버전의 항목입니다. 현재 도면에서 같은 위치를 재현할 수 없습니다."}
    return {"openable": True, "reason": ""}


# ------------------------------------------------------------------ 스키마 · 집계

@router.get("/schema")
def schema(purpose: Purpose):
    """이 목적의 입력 폼·엑셀 열 구성 (스키마 파일이 기준)."""
    store = get_store(purpose)
    module = store.schema
    return {
        "purpose": store.purpose.value,
        "label": store.label,
        "fields": [
            {"key": key, "label": module.LABELS.get(key, key), "required": key in module.REQUIRED_FIELDS}
            for key in module.INPUT_FIELDS
        ],
        "feature_types": sorted(module.FEATURE_TYPES),
        "excel": {
            "sheet": excel.DEFAULT_SHEET,
            "columns": list(module.RECORD_FIELDS),
            "required_columns": list(excel.REQUIRED_COLUMNS),
            "info_columns": list(excel.INFO_COLUMNS),
        },
    }


@router.get("/summary")
def summary(purpose: Purpose):
    """단계 카드 숫자. 단위가 다르다: 업로드는 파일·업로드 수, 오류 DB·벡터는 사례 수, 도면 연결은 연결 수."""
    store = get_store(purpose)
    with database() as db:
        uploads = db.execute(
            """
            SELECT
                SUM(status='applied') AS applied, SUM(status='rejected') AS rejected,
                COALESCE(SUM(CASE WHEN status='applied' THEN file_count END), 0) AS files,
                COALESCE(SUM(CASE WHEN status='applied' THEN row_count END), 0) AS rows,
                MAX(created_at) AS last
            FROM error_case_uploads WHERE purpose=?
            """,
            (store.purpose.value,),
        ).fetchone()
        cases = db.execute(
            f"""
            SELECT COUNT(*) AS total, COALESCE(SUM(active=1), 0) AS active, COALESCE(SUM(active=0), 0) AS inactive,
                   COALESCE(SUM(vector_status='ready'), 0) AS ready, COALESCE(SUM(vector_status='failed'), 0) AS failed,
                   COALESCE(SUM(vector_status='pending'), 0) AS pending
            FROM {store.case_table}
            """
        ).fetchone()
        links = db.execute(
            f"""
            SELECT COALESCE(SUM(unlinked_at IS NULL), 0) AS active,
                   COALESCE(SUM(unlinked_at IS NOT NULL), 0) AS unlinked,
                   COUNT(DISTINCT CASE WHEN unlinked_at IS NULL THEN case_id END) AS cases
            FROM {store.link_table}
            """
        ).fetchone()
    return {
        "purpose": store.purpose.value,
        "uploads": {
            "applied": uploads["applied"] or 0, "rejected": uploads["rejected"] or 0,
            "files": uploads["files"], "rows": uploads["rows"], "last": case_store.local_time(uploads["last"]),
        },
        "cases": {"total": cases["total"], "active": cases["active"], "inactive": cases["inactive"]},
        "vector": {"ready": cases["ready"], "failed": cases["failed"], "pending": cases["pending"]},
        "links": {"active": links["active"], "unlinked": links["unlinked"], "cases": links["cases"]},
    }


# ------------------------------------------------------------------ 사례 목록 · 상세 · 등록 · 수정

@router.get("/error-cases")
def list_cases(
    purpose: Purpose,
    q: str = Query(default="", max_length=200),
    active: str = Query(default="all", pattern="^(all|active|inactive)$"),
    vector: str = Query(default="all", pattern="^(all|ready|failed|pending)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    store = get_store(purpose)
    where, params = [], []
    if q.strip():
        like = f"%{q.strip()}%"
        where.append("(case_id LIKE ? OR case_title LIKE ? OR error_description LIKE ? OR part_family LIKE ? OR keywords LIKE ?)")
        params += [like] * 5
    if active != "all":
        where.append("active=?")
        params.append(1 if active == "active" else 0)
    if vector != "all":
        where.append("vector_status=?")
        params.append(vector)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with database() as db:
        total = db.execute(f"SELECT COUNT(*) FROM {store.case_table} {clause}", params).fetchone()[0]
        rows = db.execute(
            f"""
            SELECT c.case_id, c.case_title, c.error_description, c.part_family, c.feature_type, c.data_origin,
                   c.active, c.vector_status, c.created_at, c.updated_at,
                   (SELECT COUNT(*) FROM {store.link_table} l WHERE l.case_id=c.case_id AND l.unlinked_at IS NULL) AS link_count
            FROM {store.case_table} c {clause}
            ORDER BY c.updated_at DESC, c.case_id
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()
    return {
        "purpose": store.purpose.value,
        "total": total,
        "items": [_case_out(dict(row)) for row in rows],
    }


@router.get("/error-cases/{case_id}")
def case_detail(purpose: Purpose, case_id: str):
    store = get_store(purpose)
    row = _case_or_404(store, case_id)
    return {
        "purpose": store.purpose.value,
        "case": _case_out(row),
        "links": list_links(purpose, state="all", case_id=case_id, drawing_id=None, item_id=None, limit=1000)["items"],
        "history": list_history(purpose, case_id=case_id, drawing_id=None, item_id=None, action=None, limit=200)["items"],
    }


def _edit_values(store: PurposeStore, payload: dict) -> tuple[dict, str]:
    if not isinstance(payload, dict):
        raise HTTPException(422, "입력 형식이 올바르지 않습니다.")
    values = dict(payload)
    search_text = values.pop("search_text", "")
    if not isinstance(search_text, str):
        raise HTTPException(422, "search_text는 문자열이어야 합니다.")
    return _validate(store, values), search_text.strip()


@router.post("/error-cases", status_code=201)
def create_case(purpose: Purpose, request: Request, payload: dict = Body(...)):
    """관리자 개별 등록. 도면 항목과는 연결하지 않는다 (연결은 따로 한다)."""
    store = get_store(purpose)
    data, search_text = _edit_values(store, payload)
    data = _new_case(store, data)
    data["data_origin"] = "ADMIN_ENTERED"
    if search_text:
        data["search_text"] = search_text
    with database() as db:
        case_store.insert_case(db, store, data)
        case_store.add_history(db, store, data["case_id"], "create", detail={"via": "admin"})
    return _index(request, store, data["case_id"])


@router.put("/error-cases/{case_id}")
def update_case(purpose: Purpose, case_id: str, request: Request, payload: dict = Body(...)):
    """원문 수정. 검색 문장을 비우면 스키마 규칙으로 다시 만든다. 활성 상태·연결은 바꾸지 않는다."""
    store = get_store(purpose)
    data, search_text = _edit_values(store, payload)
    data["search_text"] = search_text or store.schema.build_search_text(data)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute(f"SELECT * FROM {store.case_table} WHERE case_id=?", (case_id,)).fetchone()
        if current is None:
            raise HTTPException(404, f"{store.label} 오류사례에서 찾을 수 없습니다.")
        changed = [field for field, value in data.items() if str(current[field] or "") != value]
        if changed:
            case_store.update_case_fields(db, store, case_id, data)
            case_store.add_history(db, store, case_id, "update", detail={"via": "admin", "fields": changed})
    if not changed:
        return {"purpose": store.purpose.value, "case_id": case_id, "saved": False, "changed_fields": [],
                "vector_status": current["vector_status"], "message": "바뀐 내용이 없습니다."}
    return {**_index(request, store, case_id), "changed_fields": changed}


def _set_active(store: PurposeStore, case_id: str, active: bool) -> dict:
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute(f"SELECT active FROM {store.case_table} WHERE case_id=?", (case_id,)).fetchone()
        if current is None:
            raise HTTPException(404, f"{store.label} 오류사례에서 찾을 수 없습니다.")
        changed = bool(current["active"]) != active
        if changed:
            case_store.set_active(db, store, case_id, active)
            case_store.add_history(db, store, case_id, "reactivate" if active else "deactivate")
    return {"purpose": store.purpose.value, "case_id": case_id, "active": active, "changed": changed}


@router.post("/error-cases/{case_id}/deactivate")
def deactivate_case(purpose: Purpose, case_id: str):
    """삭제하지 않는다. 신규 검색·연결에서 빠지고, 기존 연결과 이력은 그대로 남는다."""
    return _set_active(get_store(purpose), case_id, False)


@router.post("/error-cases/{case_id}/reactivate")
def reactivate_case(purpose: Purpose, case_id: str):
    return _set_active(get_store(purpose), case_id, True)


# ------------------------------------------------------------------ 벡터 반영 재시도

@router.post("/vector/retry")
def retry_vectors(purpose: Purpose, request: Request, payload: dict = Body(default={})):
    """반영 실패·대기 사례를 다시 반영한다. case_id 로 덮어쓰므로 벡터가 중복되지 않는다."""
    store = get_store(purpose)
    case_ids = payload.get("case_ids") if isinstance(payload, dict) else None
    with database() as db:
        if case_ids:
            if not isinstance(case_ids, list) or not all(isinstance(x, str) for x in case_ids) or len(case_ids) > 1000:
                raise HTTPException(422, "case_ids 형식이 올바르지 않습니다.")
            placeholders = ", ".join("?" for _ in case_ids)
            targets = [row["case_id"] for row in db.execute(
                f"SELECT case_id FROM {store.case_table} WHERE case_id IN ({placeholders})", case_ids)]
            if len(targets) != len(set(case_ids)):
                raise HTTPException(404, f"{store.label} 오류사례에 없는 case_id 가 있습니다.")
        else:
            targets = [row["case_id"] for row in db.execute(
                f"SELECT case_id FROM {store.case_table} WHERE vector_status IN ('failed', 'pending') ORDER BY case_id")]
    collection = _collection(request, store)
    ready = failed = 0
    for start in range(0, len(targets), RETRY_BATCH):
        batch = targets[start:start + RETRY_BATCH]
        status = vectors.index_cases(store, collection, request.app.state.model, batch, source_file="admin_retry")
        if status == "ready":
            ready += len(batch)
        else:
            failed += len(batch)
    return {"purpose": store.purpose.value, "requested": len(targets), "ready": ready, "failed": failed}


# ------------------------------------------------------------------ 도면 항목 연결

@router.get("/links")
def list_links(
    purpose: Purpose,
    state: str = Query(default="active", pattern="^(active|unlinked|all)$"),
    case_id: str | None = None,
    drawing_id: str | None = None,
    item_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
):
    store = get_store(purpose)
    where, params = [], []
    if state == "active":
        where.append("l.unlinked_at IS NULL")
    elif state == "unlinked":
        where.append("l.unlinked_at IS NOT NULL")
    for column, value in (("l.case_id", case_id), ("l.drawing_id", drawing_id), ("l.item_id", item_id)):
        if value:
            where.append(f"{column}=?")
            params.append(value)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with database() as db:
        rows = [dict(row) for row in db.execute(
            f"""
            SELECT l.link_id, l.case_id, l.drawing_id, l.ocr_revision, l.item_id, l.item_snapshot_json,
                   l.source, l.created_at, l.unlinked_at,
                   c.case_title, c.active AS case_active,
                   d.part_id, d.original_filename AS drawing_name, p.name AS part_name
            FROM {store.link_table} l
            JOIN {store.case_table} c ON c.case_id = l.case_id
            LEFT JOIN drawings d ON d.drawing_id = l.drawing_id
            LEFT JOIN parts p ON p.part_id = d.part_id
            {clause}
            ORDER BY COALESCE(l.unlinked_at, l.created_at) DESC, l.link_id
            LIMIT ?
            """,
            [*params, limit],
        )]
        current = _current_revisions(db, [row["drawing_id"] for row in rows])
    items = []
    for row in rows:
        snapshot = json.loads(row.pop("item_snapshot_json") or "{}")
        items.append({
            **row,
            "case_active": bool(row["case_active"]),
            "linked": row["unlinked_at"] is None,
            "raw_text": snapshot.get("raw_text", ""),
            "created_at": case_store.local_time(row["created_at"]),
            "unlinked_at": case_store.local_time(row["unlinked_at"]),
            "location": _location(row, current),
        })
    return {"purpose": store.purpose.value, "items": items}


@router.post("/links", status_code=201)
def create_link(purpose: Purpose, payload: dict = Body(...)):
    """사례를 도면 측정항목(도면 ID + OCR 버전 + 항목 ID)에 명시적으로 연결한다. 활성 사례·현재 OCR 버전만."""
    store = get_store(purpose)
    try:
        case_id, drawing_id = str(payload["case_id"]), str(payload["drawing_id"])
        item_id, revision = str(payload["item_id"]), str(payload["revision"])
    except (KeyError, TypeError):
        raise HTTPException(422, "case_id, drawing_id, item_id, revision 이 필요합니다.")
    snapshot = read_ocr_result(drawing_id)
    if snapshot["result"] is None:
        raise HTTPException(409, "OCR 결과가 없는 도면입니다.")
    if snapshot["revision"] != revision:
        raise HTTPException(409, "OCR 결과가 변경됐습니다. 도면을 다시 선택해주세요.")
    item = next((entry for entry in snapshot["result"]["items"] if entry["id"] == item_id), None)
    if item is None:
        raise HTTPException(404, "해당 도면의 항목이 아닙니다.")
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        case = db.execute(f"SELECT active FROM {store.case_table} WHERE case_id=?", (case_id,)).fetchone()
        if case is None:
            raise HTTPException(404, f"{store.label} 오류사례에서 찾을 수 없습니다.")
        if not case["active"]:
            raise HTTPException(409, "비활성 사례는 새로 연결할 수 없습니다.")
        current = db.execute("SELECT revision FROM ocr_results WHERE drawing_id=?", (drawing_id,)).fetchone()
        if current is None or current["revision"] != revision:
            raise HTTPException(409, "저장 중 OCR 결과가 변경됐습니다. 다시 확인해주세요.")
        if case_store.find_active_link(db, store, case_id=case_id, drawing_id=drawing_id, revision=revision, item_id=item_id):
            raise HTTPException(409, "이미 이 항목에 연결된 사례입니다.")
        link_id = case_store.insert_link(db, store, case_id=case_id, drawing_id=drawing_id, revision=revision,
                                         item_id=item_id, item=item, source="admin")
        case_store.add_history(db, store, case_id, "link", drawing_id=drawing_id, revision=revision,
                               item_id=item_id, link_id=link_id, detail={"source": "admin"})
    return {"purpose": store.purpose.value, "link_id": link_id, "case_id": case_id,
            "drawing_id": drawing_id, "item_id": item_id, "revision": revision}


@router.post("/links/{link_id}/unlink")
def unlink(purpose: Purpose, link_id: str):
    """이 연결만 해제한다. 사례 원문과 다른 항목의 연결은 그대로 둔다."""
    store = get_store(purpose)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        link = db.execute(f"SELECT * FROM {store.link_table} WHERE link_id=?", (link_id,)).fetchone()
        if link is None:
            raise HTTPException(404, "연결을 찾을 수 없습니다.")
        if link["unlinked_at"] is not None:
            return {"purpose": store.purpose.value, "link_id": link_id, "changed": False}
        db.execute(f"UPDATE {store.link_table} SET unlinked_at=CURRENT_TIMESTAMP WHERE link_id=?", (link_id,))
        case_store.add_history(db, store, link["case_id"], "unlink", drawing_id=link["drawing_id"],
                               revision=link["ocr_revision"], item_id=link["item_id"], link_id=link_id)
    return {"purpose": store.purpose.value, "link_id": link_id, "changed": True}


# ------------------------------------------------------------------ 이력

@router.get("/history")
def list_history(
    purpose: Purpose,
    case_id: str | None = None,
    drawing_id: str | None = None,
    item_id: str | None = None,
    action: str | None = Query(default=None, pattern="^(create|update|deactivate|reactivate|link|unlink)$"),
    limit: int = Query(default=200, ge=1, le=1000),
):
    store = get_store(purpose)
    where, params = [], []
    for column, value in (("h.case_id", case_id), ("h.drawing_id", drawing_id), ("h.item_id", item_id), ("h.action", action)):
        if value:
            where.append(f"{column}=?")
            params.append(value)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with database() as db:
        rows = [dict(row) for row in db.execute(
            f"""
            SELECT h.event_id, h.case_id, h.action, h.drawing_id, h.ocr_revision, h.item_id, h.link_id,
                   h.upload_id, h.detail_json, h.actor, h.created_at,
                   c.case_title, c.active AS case_active,
                   d.part_id, d.original_filename AS drawing_name, p.name AS part_name
            FROM {store.history_table} h
            LEFT JOIN {store.case_table} c ON c.case_id = h.case_id
            LEFT JOIN drawings d ON d.drawing_id = h.drawing_id
            LEFT JOIN parts p ON p.part_id = d.part_id
            {clause}
            ORDER BY h.event_id DESC
            LIMIT ?
            """,
            [*params, limit],
        )]
        current = _current_revisions(db, [row["drawing_id"] for row in rows])
    items = []
    for row in rows:
        row["detail"] = json.loads(row.pop("detail_json") or "{}")
        row["case_active"] = None if row["case_active"] is None else bool(row["case_active"])
        row["created_at"] = case_store.local_time(row["created_at"])
        row["purpose"] = store.purpose.value
        row["location"] = _location(row, current)
        items.append(row)
    return {"purpose": store.purpose.value, "items": items}


# ------------------------------------------------------------------ 엑셀 업로드 · 다운로드

async def _read_uploads(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    if not files:
        raise HTTPException(422, "엑셀 파일을 선택해주세요.")
    if len(files) > MAX_FILES:
        raise HTTPException(422, f"한 번에 {MAX_FILES}개까지 올릴 수 있습니다.")
    sources = []
    for upload in files:
        name = (upload.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        if not name.lower().endswith(".xlsx"):
            raise HTTPException(422, f"{name or '이름 없는 파일'}: .xlsx 파일만 올릴 수 있습니다.")
        data = await upload.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(422, f"{name}: 파일이 너무 큽니다 (20MB 이하).")
        sources.append((name, data))
    return sources


@router.post("/uploads/preview")
async def preview_upload(purpose: Purpose, files: list[UploadFile] = File(...)):
    """서버 검증 + 신규·갱신·변경 없음 계획. 아무것도 저장하지 않는다."""
    store = get_store(purpose)
    sources = await _read_uploads(files)
    try:
        parsed = excel.validate_files(store, sources)
    except excel.ExcelValidationError as error:
        return {"purpose": store.purpose.value, "ok": False, "errors": error.errors}
    return {"purpose": store.purpose.value, "ok": True, "errors": [], **excel.preview(store, parsed)}


@router.post("/uploads")
async def apply_upload(purpose: Purpose, request: Request, files: list[UploadFile] = File(...)):
    """반영. 미리보기와 상관없이 서버에서 다시 검증하고, 실패하면 사례를 하나도 저장하지 않는다."""
    store = get_store(purpose)
    sources = await _read_uploads(files)
    collection = _collection(request, store)
    try:
        parsed = excel.validate_files(store, sources)
    except excel.ExcelValidationError as error:
        upload_id = excel.record_rejected(store, [name for name, _ in sources], error.errors, source="admin_ui")
        return JSONResponse(status_code=422, content={"detail": {
            "message": "검증에 실패해 저장하지 않았습니다.", "upload_id": upload_id, "errors": error.errors,
        }})
    return excel.apply(store, parsed, model=request.app.state.model, collection=collection, source="admin_ui")


@router.get("/uploads")
def list_uploads(purpose: Purpose, limit: int = Query(default=100, ge=1, le=500)):
    store = get_store(purpose)
    with database() as db:
        uploads = [dict(row) for row in db.execute(
            "SELECT * FROM error_case_uploads WHERE purpose=? ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (store.purpose.value, limit),
        )]
        ids = [row["upload_id"] for row in uploads]
        files: dict[str, list] = {upload_id: [] for upload_id in ids}
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            for row in db.execute(
                f"SELECT * FROM error_case_upload_files WHERE upload_id IN ({placeholders}) ORDER BY upload_id, file_index", ids
            ):
                files[row["upload_id"]].append(dict(row))
    for upload in uploads:
        upload["errors"] = json.loads(upload.pop("errors_json") or "[]")
        upload["created_at"] = case_store.local_time(upload["created_at"])
        upload["files"] = files[upload["upload_id"]]
    return {"purpose": store.purpose.value, "items": uploads}


@router.get("/export.xlsx")
def export_cases(purpose: Purpose):
    store = get_store(purpose)
    data = excel.export_bytes(store)
    filename = f"{store.purpose.value}_error_cases.xlsx"
    label = quote(f"{store.label}_오류DB.xlsx")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{label}"},
    )
