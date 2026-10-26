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
save=false 이면 저장 없이 결과만 돌려주고, 누적 기록만 OCR_REVIEW_LOG_DIR(기본 backend/logs)에 쌓는다.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional
import math

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
from general_tolerance import GENERAL_LABEL
from ocr_metadata import convert, parse_dimension
from ocr_results import (
    read_ocr_result,
    save_reviewed_items,
    get_result_image,
)


from paths import ORIGIN_DIR as _ORIGIN_DIR, REVIEW_DRY_RUN_LOG_DIR

# 저장 없이(save=false) 검수할 때만 쓰는 누적 기록 위치. 실행 폴더와 관계없이 backend/logs 를 쓴다.
LOG_DIR = os.environ.get("OCR_REVIEW_LOG_DIR", str(REVIEW_DRY_RUN_LOG_DIR))
ORIGIN_DIR = str(_ORIGIN_DIR)

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
    """eDOCr2 색칠 결과 이미지 (data/origin/<이름>_result.jpg)."""
    for path in (os.path.join(ORIGIN_DIR, f"{name}_result.jpg"),):
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
    inspection_settings: Optional[Dict[str, Dict[str, Any]]] = None

TOLERANCE_SOURCES = {"drawing": "DRAWING", "general": "GENERAL", "special": "SPECIAL"}

FEATURE_KO = {
    "HOLE": "구멍·내경", "SHAFT": "축·외경", "PLANE": "평면·길이", "SLOT": "홈",
    "THREAD": "나사", "EDGE": "모서리", "RADIUS": "반지름", "CHAMFER": "모따기",
}
SOURCE_KO = {"DRAWING": "도면 공차", "GENERAL": GENERAL_LABEL, "SPECIAL": "특별 공차"}


def _num(value) -> str:
    return format(float(value), "g") if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)


def inspection_summary(item: dict) -> Optional[str]:
    """확정된 검사 기준을 한 줄로. 예: 실측값 · 평면·길이 · 80 일반공차 ISO 2768-m ±0.3 → 79.7~80.3 mm · 버니어 캘리퍼스"""
    if not item.get("inspection_approved"):
        return None
    parts = []
    feature = FEATURE_KO.get(item.get("feature_type") or "", item.get("feature_type") or "-")
    if item.get("measurement_mode") == "numeric":
        upper, lower = item.get("upper_deviation"), item.get("lower_deviation")
        if isinstance(upper, (int, float)) and isinstance(lower, (int, float)) and upper == -lower:
            deviation = f"±{_num(upper)}"
        else:
            sign = lambda v: (f"+{_num(v)}" if isinstance(v, (int, float)) and v >= 0 else _num(v))  # noqa: E731
            deviation = f"{sign(upper)}/{sign(lower)}"
        source = SOURCE_KO.get(item.get("tolerance_source") or "", "")
        parts += [
            "실측값", feature,
            f"{_num(item.get('nominal_value'))} {source} {deviation} → "
            f"{_num(item.get('lower_limit'))}~{_num(item.get('upper_limit'))} {item.get('unit') or ''}".strip(),
        ]
    else:
        parts += ["합격/불합격", feature, item.get("gauge_criteria") or "-"]
    parts.append(item.get("instrument") or "-")
    return " · ".join(parts)



def apply_inspection_settings(item: dict, setting: dict) -> dict:
    """관리자가 확정한 작업자 검사 기준을 항목에 반영한다.

    실측값 방식의 허용 범위는 tolerance_source 로 정한다.
      drawing : 도면에 적힌 공차 (서버가 원문에서 다시 계산)
      general : 일반공차 ISO 2768-m (서버가 표에서 계산)
      special : 관리자가 입력한 특별 공차 (upper/lower_deviation)
    tolerance_source 가 없으면 이전 방식대로 보낸 기준치수·편차를 그대로 쓴다.
    """
    allowed = {
        "measurement_mode",
        "feature_type",
        "nominal_value",
        "upper_deviation",
        "lower_deviation",
        "tolerance_source",
        "unit",
        "instrument",
        "gauge_criteria",
        "position_confirmed",
    }

    unknown = set(setting) - allowed
    if unknown:
        raise HTTPException(
            422,
            f"{item['id']}: 지원하지 않는 검사 기준 {sorted(unknown)}",
        )

    mode = setting.get("measurement_mode")

    if mode not in ("numeric", "gauge"):
        raise HTTPException(
            422,
            f"{item['id']}: 실측값 또는 합격·불합격 기록 방식을 선택해주세요.",
        )

    feature = setting.get("feature_type")
    if feature not in {
        "HOLE", "SHAFT", "PLANE", "SLOT",
        "THREAD", "EDGE", "RADIUS", "CHAMFER",
    }:
        raise HTTPException(
            422,
            f"{item['id']}: 측정 형상을 선택해주세요.",
        )

    if setting.get("position_confirmed") is not True:
        raise HTTPException(
            422,
            f"{item['id']}: 도면의 측정 위치를 확인해주세요.",
        )

    instrument = setting.get("instrument", "")
    if not isinstance(instrument, str) or not instrument.strip():
        raise HTTPException(
            422,
            f"{item['id']}: 사용할 측정기를 선택해주세요.",
        )

    result = dict(item)
    result["measurement_mode"] = mode
    result["feature_type"] = feature
    result["instrument"] = instrument.strip()

    if mode == "numeric":
        if item.get("category") != "DIMENSION":
            raise HTTPException(
                422,
                f"{item['id']}: 기하공차는 합격·불합격 기록 방식으로 지정해주세요.",
            )

        def number(name: str, source: dict) -> float:
            value = source.get(name)

            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                raise HTTPException(
                    422,
                    f"{item['id']}: 기준치수와 상한·하한 편차를 숫자로 입력해주세요.",
                )

            return float(value)

        source_key = setting.get("tolerance_source")
        if source_key is None:
            tolerance_source = "SPECIAL"
            nominal = number("nominal_value", setting)
            upper = number("upper_deviation", setting)
            lower = number("lower_deviation", setting)
        else:
            if source_key not in TOLERANCE_SOURCES:
                raise HTTPException(
                    422,
                    f"{item['id']}: 공차 종류는 도면 공차·일반공차·특별 공차 중 하나여야 합니다.",
                )
            tolerance_source = TOLERANCE_SOURCES[source_key]

            # 기준치수는 확정된 도면 표기에서 서버가 다시 읽는다.
            parsed = parse_dimension(item.get("raw_text", ""), item.get("unit"))
            if parsed["nominal_value"] is None:
                raise HTTPException(
                    422,
                    f"{item['id']}: 치수 표기에서 기준치수를 읽을 수 없습니다. 표기를 먼저 고쳐주세요.",
                )
            nominal = float(parsed["nominal_value"])

            if tolerance_source == "SPECIAL":
                upper = number("upper_deviation", setting)
                lower = number("lower_deviation", setting)
            elif parsed.get("tolerance_source") != tolerance_source:
                label = "도면 공차" if tolerance_source == "DRAWING" else GENERAL_LABEL
                raise HTTPException(
                    422,
                    f"{item['id']}: 이 치수에는 {label}를 적용할 수 없습니다. 특별 공차를 입력해주세요.",
                )
            else:
                upper = float(parsed["upper_deviation"])
                lower = float(parsed["lower_deviation"])

        if nominal < 0:
            raise HTTPException(
                422,
                f"{item['id']}: 기준치수는 0 이상이어야 합니다.",
            )

        if lower > upper:
            raise HTTPException(
                422,
                f"{item['id']}: 하한 편차가 상한 편차보다 큽니다.",
            )

        unit = setting.get("unit")
        if not isinstance(unit, str) or not unit.strip():
            raise HTTPException(
                422,
                f"{item['id']}: 측정 단위를 입력해주세요.",
            )

        # 부호를 포함한 편차를 그대로 더한다.
        low = nominal + lower
        high = nominal + upper

        if not math.isfinite(low) or not math.isfinite(high):
            raise HTTPException(
                422,
                f"{item['id']}: 허용범위가 유효하지 않습니다.",
            )

        result.update({
            "nominal_value": nominal,
            "upper_deviation": upper,
            "lower_deviation": lower,
            "lower_limit": round(low, 12),
            "upper_limit": round(high, 12),
            "unit": unit.strip(),
            "tol_type": "DIMENSION",
            "tolerance_source": tolerance_source,
            "gauge_criteria": "",
        })

    else:
        criteria = setting.get("gauge_criteria")
        if not isinstance(criteria, str) or not criteria.strip():
            raise HTTPException(
                422,
                f"{item['id']}: 합격·불합격 판정 기준을 입력해주세요.",
            )

        result["gauge_criteria"] = criteria.strip()

    # 검사 기준과 위치가 명시적으로 확인된 항목만 확정한다.
    # 기존 OCR 경고는 원본 기록으로 남긴다.
    result.setdefault(
        "ocr_review_reasons",
        list(item.get("review_reasons") or []),
    )
    result["requires_review"] = False
    result["coordinate_requires_review"] = False
    result["review_reasons"] = []
    result["inspection_approved"] = True

    return result

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

    if req.inspection_settings is not None:
        settings = req.inspection_settings
        current_ids = {item["id"] for item in items}

        unknown_ids = set(settings) - current_ids
        if unknown_ids:
            raise HTTPException(
                422,
                f"현재 도면에 없는 검사 항목입니다: {sorted(unknown_ids)}",
            )

        updated_items = []

        for item in items:
            setting = settings.get(item["id"])

            if setting is None:
                updated_items.append(item)
                continue

            updated = apply_inspection_settings(item, setting)
            updated_items.append(updated)

            log.setdefault("changes", []).append({
                "item_id": item["id"],
                "type": "INSPECTION",
                "action": "edited",
                "raw_text": item.get("raw_text"),
                "before": inspection_summary(old_items.get(item["id"]) or {}),
                "after": inspection_summary(updated),
                "setting": setting,
            })

        items = updated_items

    # 도면 이름(원본 파일명)과 작업자 입력을 기록에 같이 남긴다.
    with database() as db:
        row = db.execute(
            "SELECT original_filename FROM drawings WHERE drawing_id=?", (drawing_id,)
        ).fetchone()
    log["drawing_name"] = Path(row["original_filename"]).stem if row else drawing_id
    log["input"] = {
        "reviewer": req.reviewer,
        "revision": req.revision,
        "confirmed_item_ids": req.confirmed_item_ids,
        "edits": req.edits,
        "inspection_settings": req.inspection_settings,
    }

    saved = save_reviewed_items(
        drawing_id,
        items,
        req.revision,
        req.reviewer,
        review_record={"reviewed_txt": reviewed_txt, "log": log},
    )

    # 검토 완료 → 결과 파일 6종 자동 생성. 실패해도 검토 저장은 그대로 둔다.
    files_error = None
    try:
        _write_review_files(drawing_id, saved["revision"], reviewed_txt, log, append_csv=True)
        REVIEW_FILE_ERRORS.pop(drawing_id, None)
    except Exception as exc:  # noqa: BLE001
        files_error = f"결과 파일 생성 실패: {getattr(exc, 'detail', exc)}"
        REVIEW_FILE_ERRORS[drawing_id] = files_error
    return {"snapshot": saved, "log": log, "files_error": files_error}

REVIEW_FILE_ERRORS: Dict[str, str] = {}
HISTORY_LINK = {"kind": "history_csv", "label": "누적 기록 CSV", "url": f"{router.prefix}/history"}


def _write_review_files(drawing_id: str, revision: str, reviewed_txt: str, log: dict,
                        append_csv: bool) -> dict:
    """검수 결과 파일: 정답본 TXT · 검수 기록 · 검수 끝난 도면 · 수정 표시 이미지 · 작업자 입력 JSON.
    append_csv=True 이면 누적 기록 CSV에도 이번 검수를 한 번 쌓는다 (재생성 때는 다시 쌓지 않음)."""
    name = _check_name(f"{drawing_id}_{revision}")
    image_path = get_result_image(drawing_id, revision)
    save_outputs(
        origin_path=_origin_path(drawing_id),
        base=os.path.join(ORIGIN_DIR, drawing_id),
        name=name,
        reviewed=reviewed_txt,
        log=log,
        result_jpg=str(image_path),
        log_dir="logs" if append_csv else None,
    )
    if log.get("input"):
        write_text(
            _result_path(name, "edits_json"),
            json.dumps(log["input"], ensure_ascii=False, indent=2) + "\n",
        )
    return result_list(name)


def _review_entry(document: dict, revision: str):
    history_entries = document.get("review_history") or []
    return next(
        (item for item in reversed(history_entries) if item.get("revision") == revision),
        None,
    )


def _file_list(drawing_id: str, revision: str) -> dict:
    files = result_list(_check_name(f"{drawing_id}_{revision}"))["files"]
    history_path = os.path.join(REPO_DATA_DIR, "logs", HISTORY_FILE)
    if files and os.path.isfile(history_path):
        files.append(dict(HISTORY_LINK))
    return {
        "drawing_id": drawing_id,
        "revision": revision,
        "files": files,
        "error": REVIEW_FILE_ERRORS.get(drawing_id),
    }


@router.get("/drawing/{drawing_id}/files")
def drawing_review_files(drawing_id: str, revision: str):
    """검토 완료 때 만들어진 결과 파일 목록. 이 패치 전에 검토한 도면은 없으면 여기서 한 번 만든다."""
    snapshot = read_ocr_result(drawing_id)
    document = snapshot["result"]
    if document is None or snapshot["revision"] != revision:
        raise HTTPException(409, "도면 결과가 변경됐습니다. 다시 조회해주세요.")
    listing = _file_list(drawing_id, revision)
    entry = _review_entry(document, revision)
    if not listing["files"] and document.get("reviewed_txt") and entry is not None:
        try:
            _write_review_files(drawing_id, revision, document["reviewed_txt"], entry["log"],
                                append_csv=False)
            REVIEW_FILE_ERRORS.pop(drawing_id, None)
        except Exception as exc:  # noqa: BLE001
            REVIEW_FILE_ERRORS[drawing_id] = f"결과 파일 생성 실패: {getattr(exc, 'detail', exc)}"
        listing = _file_list(drawing_id, revision)
    return listing


class DrawingExportInput(BaseModel):
    revision: str


@router.post("/drawing/{drawing_id}/export")
def export_drawing_review(drawing_id: str, req: DrawingExportInput):
    """(이전 화면 호환) 결과 파일 목록. 없으면 만든다."""
    snapshot = read_ocr_result(drawing_id)
    document = snapshot["result"]
    if document is None:
        raise HTTPException(409, "OCR 결과가 없습니다.")
    if snapshot["revision"] != req.revision:
        raise HTTPException(409, "도면 결과가 변경됐습니다. 다시 조회해주세요.")
    if not document.get("reviewed_txt") or _review_entry(document, req.revision) is None:
        raise HTTPException(409, "관리자 검토를 서버에 저장한 뒤 파일을 확인해주세요.")
    listing = drawing_review_files(drawing_id, req.revision)
    if not listing["files"]:
        raise HTTPException(500, listing["error"] or "결과 파일이 생성되지 않았습니다.")
    return listing


# 위에서 독립 실행용 app에 router를 등록한 뒤 추가된 경로도 반영한다.
# 팀 서버(app_auto)는 이 파일의 router를 가져오므로 별도 등록이 필요 없다.