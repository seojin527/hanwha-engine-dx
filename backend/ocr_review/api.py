"""검수 API (FastAPI).

팀 서버(app.py)에 붙이기:   from ocr_review.api import router as review_router
                           app.include_router(review_router)
혼자 실행해 보기:          uvicorn ocr_review.api:app --reload --port 8000      (backend 폴더에서)

GET  /api/ocr-review/origin/{name}  → data/origin/{name}_origin.txt 내용 (eDOCr2 결과)
POST /api/ocr-review/review   {"name": "HDH_63_01", "origin_txt": "..."(없으면 data/origin에서 읽음)}
      → 검수 화면용 JSON (기하공차 줄마다 check / format_error)
POST /api/ocr-review/submit   {"name": "HDH_63_01", "items": [화면 항목들], "reviewer": "..."}   ← 화면이 쓰는 것
      → 원본 TXT와 비교해 edits 를 만든 뒤 apply(save=true)와 똑같이 저장
POST /api/ocr-review/apply    {"name": "...", "origin_txt": "..."(선택), "edits": {...}, "save": true}
      → {"reviewed_txt", "log", "log_text", "saved"(save일 때 저장한 파일), "reviewed_json"(want_json일 때)}
GET  /api/ocr-review/result/{name}         → 이 도면의 검수 결과 파일 목록 (정답본·기록·이미지)
GET  /api/ocr-review/result/{name}/{kind}  → 파일 내용 (reviewed_txt / review_log / reviewed_jpg / edits_log_jpg / edits_json)
GET  /api/ocr-review/history  → 누적 기록 CSV

save=true 이면 명령줄과 똑같이 data/reviewed/ (결과) 와 data/logs/ (기록) 에 저장한다.
save=false 이면 저장 없이 결과만 돌려주고, 누적 기록만 OCR_REVIEW_LOG_DIR(기본 ./logs)에 쌓는다.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .files import REPO_DATA_DIR, read_text, save_outputs, write_text
from .logs import HISTORY_FILE, append_history, format_log_text
from .review import ReviewError, apply_review, build_review, build_reviewed_json, edits_from_items
from .txt_format import TxtFormatError

from pathlib import Path

from drawing_library import database, UPLOAD_DIR
from ocr_metadata import convert
from ocr_results import (
    read_ocr_result,
    save_reviewed_items,
    get_result_image,
)


LOG_DIR = os.environ.get("OCR_REVIEW_LOG_DIR", "logs")
ORIGIN_DIR = os.path.join(REPO_DATA_DIR, "origin")
FRONT_DRAWINGS_DIR = os.path.join(os.path.dirname(REPO_DATA_DIR), "frontend", "public", "drawings")

# 검수 결과 파일 (save 때 만들어짐). kind → (폴더, 파일 이름 뒤쪽, 화면 표시 이름, 형식)
RESULT_FILES = {
    "reviewed_txt": ("reviewed", "_reviewed.txt", "정답본 TXT", "text/plain; charset=utf-8"),
    "review_log": ("logs", "_review_log.txt", "검수 기록", "text/plain; charset=utf-8"),
    "reviewed_jpg": ("reviewed", "_reviewed.jpg", "검수 끝난 도면 (추가 치수 형광펜)", "image/jpeg"),
    "edits_log_jpg": ("logs", "_edits_log.jpg", "수정 표시 이미지 (OK/FIX/ADD)", "image/jpeg"),
    "edits_json": ("logs", "_edits.json", "작업자 입력 (JSON)", "application/json"),
}
NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")

router = APIRouter(prefix="/api/ocr-review", tags=["OCR 검수"])


class ReviewRequest(BaseModel):
    name: str = "drawing"
    origin_txt: Optional[str] = None


class SubmitRequest(BaseModel):
    """화면(관리자 체크리스트)의 최종 항목 목록을 그대로 받는 요청."""
    name: str
    items: List[Dict[str, Any]]
    reviewer: str = ""
    origin_txt: Optional[str] = None
    frame_offset: Optional[List[int]] = None
    save: bool = True
    want_json: bool = False


class ApplyRequest(BaseModel):
    name: str = "drawing"
    origin_txt: Optional[str] = None
    edits: Dict[str, Any]
    dpi: Optional[int] = 200
    allow_incomplete: bool = False
    want_json: bool = False
    save: bool = False


def _check_name(name: str) -> str:
    if not NAME_RE.match(name or ""):
        raise HTTPException(status_code=422, detail=[f"도면 이름 형식이 이상함: {name!r} (영문·숫자·_·- 만)"])
    return name


def _origin_path(name: str) -> str:
    return os.path.join(ORIGIN_DIR, f"{_check_name(name)}_origin.txt")


def _result_jpg(name: str) -> Optional[str]:
    """eDOCr2 색칠 결과 이미지. data/origin 에 없으면 화면이 쓰는 도면 이미지(frontend/public/drawings)를 쓴다."""
    for path in (os.path.join(ORIGIN_DIR, f"{name}_result.jpg"), os.path.join(FRONT_DRAWINGS_DIR, f"{name}.jpg")):
        if os.path.isfile(path):
            return path
    return None


def _result_path(name: str, kind: str) -> str:
    folder, suffix, _, _ = RESULT_FILES[kind]
    return os.path.join(REPO_DATA_DIR, folder, f"{_check_name(name)}{suffix}")


def _origin_text(name: str, given: Optional[str]) -> str:
    if given:
        return given
    path = _origin_path(name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=[f"eDOCr2 결과가 없음: data/origin/{name}_origin.txt"])
    return read_text(path)


@router.get("/origin/{name}")
def origin(name: str):
    return {"name": name, "origin_txt": _origin_text(name, None)}


@router.post("/review")
def review(req: ReviewRequest):
    try:
        return build_review(_origin_text(req.name, req.origin_txt), name=req.name)
    except TxtFormatError as e:
        raise HTTPException(status_code=422, detail=[str(e)])


@router.post("/apply")
def apply(req: ApplyRequest):
    origin_txt = _origin_text(req.name, req.origin_txt)
    try:
        reviewed, log = apply_review(origin_txt, req.edits, name=req.name, dpi=req.dpi,
                                     require_all=not req.allow_incomplete)
    except ReviewError as e:
        raise HTTPException(status_code=422, detail=e.errors)
    except TxtFormatError as e:
        raise HTTPException(status_code=422, detail=[str(e)])

    result: Dict[str, Any] = {
        "reviewed_txt": reviewed,
        "log": log,
        "log_text": format_log_text(log, f"{req.name}_origin.txt", f"{req.name}_reviewed.txt"),
    }
    if req.save:
        origin_path = _origin_path(req.name)
        if not os.path.isfile(origin_path):          # 화면이 원본을 직접 보낸 경우: 같은 내용을 남겨 둔다
            write_text(origin_path, origin_txt)
        saved = save_outputs(origin_path, os.path.join(ORIGIN_DIR, req.name), req.name, reviewed, log,
                             want_json=req.want_json, result_jpg=_result_jpg(req.name))
        edits_path = os.path.join(REPO_DATA_DIR, "logs", f"{req.name}_edits.json")
        write_text(edits_path, json.dumps(req.edits, ensure_ascii=False, indent=2) + "\n")
        root = os.path.dirname(REPO_DATA_DIR)
        result["saved"] = [os.path.relpath(p, root).replace(os.sep, "/") for p in saved + [edits_path]]
    elif LOG_DIR:
        append_history(log, os.path.join(LOG_DIR, HISTORY_FILE), origin_file=f"{req.name}_origin.txt")
    if req.want_json:
        result["reviewed_json"] = build_reviewed_json(reviewed, log, req.name)
    return result


@router.post("/submit")
def submit(req: SubmitRequest):
    """화면 항목 목록 → (원본 TXT와 비교해) edits 를 만들고 apply 와 똑같이 처리한다."""
    origin_txt = _origin_text(req.name, req.origin_txt)
    try:
        edits, warnings = edits_from_items(origin_txt, req.items, reviewer=req.reviewer,
                                           frame_offset=req.frame_offset)
    except TxtFormatError as e:
        raise HTTPException(status_code=422, detail=[str(e)])
    result = apply(ApplyRequest(name=req.name, origin_txt=origin_txt, edits=edits,
                                save=req.save, want_json=req.want_json))
    result["edits"] = edits
    result["warnings"] = warnings + result["log"].get("warnings", [])
    return result


@router.get("/result/{name}")
def result_list(name: str):
    """이 도면의 검수 결과 파일 목록 (있는 것만). 화면이 링크로 보여준다."""
    files = []
    for kind, (_, _, label, _) in RESULT_FILES.items():
        path = _result_path(name, kind)
        if os.path.isfile(path):
            files.append({"kind": kind, "label": label, "url": f"{router.prefix}/result/{name}/{kind}",
                          "updated_at": os.path.getmtime(path)})
    return {"name": name, "files": files}


@router.get("/result/{name}/{kind}")
def result_file(name: str, kind: str):
    if kind not in RESULT_FILES:
        raise HTTPException(status_code=404, detail=[f"모르는 결과 종류: {kind}"])
    path = _result_path(name, kind)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=[f"아직 검수 결과가 없음: {os.path.basename(path)}"])
    return FileResponse(path, media_type=RESULT_FILES[kind][3])


@router.get("/history")
def history():
    for path in (os.path.join(REPO_DATA_DIR, "logs", HISTORY_FILE), os.path.join(LOG_DIR, HISTORY_FILE)):
        if os.path.exists(path):
            return FileResponse(path, media_type="text/csv", filename=HISTORY_FILE)
    raise HTTPException(status_code=404, detail=["아직 검수 기록이 없음"])


# 혼자 실행할 때 쓰는 앱 (팀 서버에서는 router만 가져다 붙인다)
app = FastAPI(title="OCR Review API", version="0.3.0")
app.include_router(router)
app.add_middleware(  # 로컬 프론트(vite 3000/5173)에서 호출 허용. 팀 서버는 app.py의 설정을 쓴다
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


class DrawingReviewInput(BaseModel):
    revision: str
    reviewer: str = ""
    confirmed_item_ids: List[str]
    edits: Dict[str, Any]


def _drawing_origin_text(drawing_id: str, document: dict) -> str:
    # 재검수: 직전 검수에서 수정·추가한 내용을 이어서 사용한다.
    if document.get("reviewed_txt"):
        return document["reviewed_txt"]

    path = Path(ORIGIN_DIR) / f"{drawing_id}_origin.txt"
    if path.is_file():
        return read_text(str(path))

    # 7번 수정 전에 OCR이 완료된 도면도 기존 작업 폴더에서 찾는다.
    with database() as db:
        has_jobs = db.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type='table' AND name='ocr_jobs'"
        ).fetchone()
        if not has_jobs:
            raise HTTPException(409, "이 도면의 OCR 원본 TXT가 없습니다.")

        row = db.execute(
            """
            SELECT j.job_id, d.stored_filename
            FROM ocr_jobs j
            JOIN drawings d ON d.drawing_id = j.drawing_id
            WHERE j.drawing_id = ? AND j.status = 'completed'
            ORDER BY j.rowid DESC LIMIT 1
            """,
            (drawing_id,),
        ).fetchone()

    if row:
        stem = Path(row["stored_filename"]).stem
        path = (
            UPLOAD_DIR.parent / "ocr_jobs" / row["job_id"]
            / f"{stem}_origin.txt"
        )
        if path.is_file():
            return read_text(str(path))

    raise HTTPException(
        409, "이 도면의 OCR 원본 TXT를 찾을 수 없습니다."
    )


@router.get("/drawing/{drawing_id}")
def drawing_review_source(drawing_id: str):
    snapshot = read_ocr_result(drawing_id)
    if snapshot["result"] is None:
        raise HTTPException(409, "OCR 실행을 먼저 완료해주세요.")

    origin_txt = _drawing_origin_text(drawing_id, snapshot["result"])
    try:
        review_data = build_review(origin_txt, name=drawing_id)
    except TxtFormatError as exc:
        raise HTTPException(422, detail=[str(exc)]) from exc

    return {
        "drawing_id": drawing_id,
        "revision": snapshot["revision"],
        "result": snapshot["result"],
        "review": review_data,
    }


@router.post("/drawing/{drawing_id}")
def submit_drawing_review(drawing_id: str, req: DrawingReviewInput):
    snapshot = read_ocr_result(drawing_id)
    document = snapshot["result"]
    if document is None:
        raise HTTPException(409, "OCR 실행을 먼저 완료해주세요.")
    if snapshot["revision"] != req.revision:
        raise HTTPException(409, "OCR 결과가 변경됐습니다. 다시 불러와주세요.")

    required = {item["id"] for item in document["items"]}
    confirmed = set(req.confirmed_item_ids)
    if required != confirmed:
        raise HTTPException(
            422, "현재 도면의 모든 항목을 확인해야 검토를 완료할 수 있습니다."
        )

    # 지원하지 않는 요청 필드는 조용히 무시하지 않는다.
    allowed = {"gdt", "dimensions", "added_dimensions", "reviewer"}
    unknown = set(req.edits) - allowed
    if unknown:
        raise HTTPException(
            422, f"지원하지 않는 검수 필드: {sorted(unknown)}"
        )

    edits = dict(req.edits)
    edits["reviewer"] = req.reviewer
    origin_txt = _drawing_origin_text(drawing_id, document)

    try:
        reviewed_txt, log = apply_review(
            origin_txt, edits, name=drawing_id, require_all=True
        )
        converted = convert(reviewed_txt, drawing_id)
    except ReviewError as exc:
        raise HTTPException(422, detail=exc.errors) from exc
    except (TxtFormatError, ValueError, TypeError) as exc:
        raise HTTPException(422, detail=[str(exc)]) from exc

    new_ids = {item["id"] for item in converted["items"]}
    if not required.issubset(new_ids):
        raise HTTPException(
            422, "변환 중 기존 항목이 누락됐습니다. 저장하지 않았습니다."
        )

    # 원문이 그대로인 항목의 기존 해석·추가 속성은 보존한다.
    old_items = {item["id"]: item for item in document["items"]}
    items = []
    for item in converted["items"]:
        old = old_items.get(item["id"])
        if old and old["raw_text"] == item["raw_text"]:
            items.append({**old, **{
                "position": item["position"],
                "original_position": item["original_position"],
            }})
        else:
            # 값이 바뀐 항목은 main 변환기로 기준·허용범위를 다시 계산한다.
            items.append(item)

    saved = save_reviewed_items(
        drawing_id,
        items,
        req.revision,
        req.reviewer,
        review_record={"reviewed_txt": reviewed_txt, "log": log},
    )
    return {"snapshot": saved, "log": log}

class DrawingExportInput(BaseModel):
    revision: str


@router.post("/drawing/{drawing_id}/export")
def export_drawing_review(drawing_id: str, req: DrawingExportInput):
    snapshot = read_ocr_result(drawing_id)
    document = snapshot["result"]

    if document is None:
        raise HTTPException(409, "OCR 결과가 없습니다.")

    if snapshot["revision"] != req.revision:
        raise HTTPException(409, "도면 결과가 변경됐습니다. 다시 조회해주세요.")

    reviewed_txt = document.get("reviewed_txt")
    history_entries = document.get("review_history") or []
    entry = next(
        (
            item for item in reversed(history_entries)
            if item.get("revision") == req.revision
        ),
        None,
    )

    if not reviewed_txt or entry is None:
        raise HTTPException(
            409, "관리자 검토를 서버에 저장한 뒤 파일을 생성해주세요."
        )

    # 도면 ID와 버전으로 구분해서 이전 결과 파일을 보존한다.
    name = _check_name(f"{drawing_id}_{req.revision}")
    image_path = get_result_image(drawing_id, req.revision)

    expected = [
        _result_path(name, kind)
        for kind in ("reviewed_txt", "review_log", "reviewed_jpg", "edits_log_jpg")
    ]

    if not all(os.path.isfile(path) for path in expected):
        try:
            save_outputs(
                origin_path=_origin_path(drawing_id),
                base=os.path.join(ORIGIN_DIR, drawing_id),
                name=name,
                reviewed=reviewed_txt,
                log=entry["log"],
                result_jpg=str(image_path),
                log_dir=None,
            )
        except Exception as exc:
            raise HTTPException(
                500,
                "검수 결과는 DB에 보존돼 있습니다. "
                f"결과 파일 생성에 실패했습니다: {exc}",
            ) from exc

    if not all(os.path.isfile(path) for path in expected):
        raise HTTPException(
            500,
            "결과 이미지가 생성되지 않았습니다. "
            "백엔드 실행 환경의 Pillow 설치와 서버 로그를 확인해주세요.",
        )

    return {
        "drawing_id": drawing_id,
        "revision": req.revision,
        **result_list(name),
    }

    
# 위에서 독립 실행용 app에 router를 등록한 뒤 추가된 경로도 반영한다.
# 팀 서버(app_auto)는 이 파일의 router를 가져오므로 별도 등록이 필요 없다.