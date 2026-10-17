"""검수 API (FastAPI).

실행:  pip install fastapi uvicorn
       uvicorn ocr_review.api:app --reload --port 8000      (backend 폴더에서)

POST /api/ocr-review/review   {"name": "HDH_63_3", "origin_txt": "..."}             → 검수 화면용 JSON
POST /api/ocr-review/apply    {"name": "...", "origin_txt": "...", "edits": {...}}
      → {"reviewed_txt", "reviewed_json"(want_json일 때), "log", "log_text"}
GET  /api/ocr-review/history  → 누적 기록 (CSV 파일 그대로)

검수할 때마다 누적 기록이 OCR_REVIEW_LOG_DIR 폴더(기본 ./logs)의 review_history.csv 에 쌓인다.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .logs import HISTORY_FILE, append_history, format_log_text
from .review import ReviewError, apply_review, build_review, build_reviewed_json
from .txt_format import TxtFormatError

LOG_DIR = os.environ.get("OCR_REVIEW_LOG_DIR", "logs")
app = FastAPI(title="OCR Review API", version="0.2.0")


class ReviewRequest(BaseModel):
    name: str = "drawing"
    origin_txt: str


class ApplyRequest(BaseModel):
    name: str = "drawing"
    origin_txt: str
    edits: Dict[str, Any]
    dpi: Optional[int] = 200
    allow_incomplete: bool = False
    want_json: bool = False


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/ocr-review/review")
def review(req: ReviewRequest):
    try:
        return build_review(req.origin_txt, name=req.name)
    except TxtFormatError as e:
        raise HTTPException(status_code=422, detail=[str(e)])


@app.post("/api/ocr-review/apply")
def apply(req: ApplyRequest):
    try:
        reviewed, log = apply_review(req.origin_txt, req.edits, name=req.name, dpi=req.dpi,
                                     require_all=not req.allow_incomplete)
    except ReviewError as e:
        raise HTTPException(status_code=422, detail=e.errors)
    except TxtFormatError as e:
        raise HTTPException(status_code=422, detail=[str(e)])
    if LOG_DIR:
        append_history(log, os.path.join(LOG_DIR, HISTORY_FILE), origin_file=f"{req.name}_origin.txt")
    result = {
        "reviewed_txt": reviewed,
        "log": log,
        "log_text": format_log_text(log, f"{req.name}_origin.txt", f"{req.name}_reviewed.txt"),
    }
    if req.want_json:
        result["reviewed_json"] = build_reviewed_json(reviewed, log, req.name)
    return result


@app.get("/api/ocr-review/history")
def history():
    path = os.path.join(LOG_DIR, HISTORY_FILE)
    if not LOG_DIR or not os.path.exists(path):
        raise HTTPException(status_code=404, detail=["아직 검수 기록이 없음"])
    return FileResponse(path, media_type="text/csv", filename=HISTORY_FILE)
