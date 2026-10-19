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
