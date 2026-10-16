"""OCR 결과 검수 (Human-in-the-loop).

1) build_review(): 원본 TXT → 검수 화면용 JSON
   - 기하공차: 모든 값 '확인 필요(check)', 숫자 모양이 아니면 '형식 오류(format_error)'
   - 치수: 가정상 인식된 값은 그대로 사용 ('auto'), 못 읽은 치수는 작업자가 추가
2) apply_review(): 원본 TXT + 작업자 수정 내용 → 수정된 TXT + 수정 기록
   - TXT 형식은 원본과 같게 유지 (바뀐 줄만 고침)

시스템은 정답을 모르므로 값이 '틀렸다'고 판단하지 않는다.
형식 오류(숫자로 읽을 수 없는 값)만 표시한다.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from .txt_format import GdtEntry, OcrTxt, TxtFormatError

SCHEMA_REVIEW = "ocr-review/1"
SCHEMA_LOG = "ocr-review-log/1"

# eDOCr2 기하공차 알파벳 기준 (recognizer_gdts.txt)
SYMBOL_NAMES = {
    "⏤": "진직도", "⏥": "평면도", "○": "진원도", "⌭": "원통도", "⌒": "선의 윤곽도",
    "⌓": "면의 윤곽도", "⏊": "직각도", "⊥": "직각도", "∠": "경사도", "⫽": "평행도",
    "⌯": "대칭도", "⌖": "위치도", "◎": "동심도", "↗": "원주 흔들림", "⌰": "온 흔들림",
}
GDT_VALUE_RE = re.compile(r"^\d+\.\d+$")          # OCR 값 형식 검사 (0.012)
INPUT_VALUE_RE = re.compile(r"^\d+(\.\d+)?$")      # 작업자 입력 허용 (0.01, 1)
DATUM_RE = re.compile(r"^[A-Z](-[A-Z])?$")
KIND_PREFIX = {"length": "", "diameter": "⌀", "radius": "R", "chamfer": "C", "thread": "M"}


class ReviewError(ValueError):
    """작업자 수정 내용이 잘못됐을 때. errors에 이유 목록."""

    def __init__(self, errors: List[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


# ---------------------------------------------------------------- 기하공차 한 줄
def split_row(row: str) -> Tuple[str, str, List[str]]:
    cells = row.split("|")
    return cells[0], (cells[1] if len(cells) > 1 else ""), cells[2:]


def check_row(row: str) -> Tuple[str, Optional[str]]:
    """('check'|'format_error', 이유)"""
    cells = row.split("|")
    if len(cells) < 2 or not cells[1]:
        return "format_error", "공차 값 칸을 찾지 못함"
    if not GDT_VALUE_RE.match(cells[1]):
        return "format_error", "숫자 형식이 아님 (글자 깨짐)"
    return "check", None


def gdt_item_id(entry_no: int, row_no: int) -> str:
    return f"G{entry_no:02d}-{row_no}"


def _symbol_name(symbol: str) -> Optional[str]:
    for ch in symbol:
        if ch in SYMBOL_NAMES:
            return SYMBOL_NAMES[ch]
    return None


# ---------------------------------------------------------------- 1) 검수 화면용 JSON
def build_review(origin_txt: str, name: str = "drawing") -> dict:
    doc = OcrTxt.parse(origin_txt)
    off = doc.frame_offset

    gdt_items = []
    for entry in doc.gdt:
        for r, row in enumerate(entry.rows, 1):
            symbol, value, datums = split_row(row)
            status, reason = check_row(row)
            gdt_items.append({
                "item_id": gdt_item_id(entry.no, r),
                "entry_no": entry.no,
                "row": r,
                "raw": row,
                "symbol": symbol,
                "symbol_name": _symbol_name(symbol),
                "value": value,
                "datums": datums,
                "status": status,
                "message": reason,
                "position": {"x": entry.x, "y": entry.y, "anchor": "frame_top_left", "coord": "image"},
                "position_norm": _norm(doc, entry.x, entry.y),
            })

    dims = []
    for d in doc.dims:
        img_xy = (d.x + off[0], d.y + off[1]) if off else None
        dims.append({
            "item_id": f"D{d.no:02d}",
            "no": d.no,
            "text": d.text,
            "status": "auto",
            "position": {"x": d.x, "y": d.y, "anchor": "text_center", "coord": "frame"},
            "position_image": {"x": img_xy[0], "y": img_xy[1]} if img_xy else None,
            "position_norm": _norm(doc, *img_xy) if img_xy else None,
        })

    warnings = list(doc.warnings)
    if off is None:
        warnings.append("Frame offset 줄이 없음: 치수 좌표(도면 테두리 기준)를 전체 이미지 기준으로 바꿀 수 없음")
    if doc.width is None:
        warnings.append("Image size 줄이 없음")

    errors = sum(1 for g in gdt_items if g["status"] == "format_error")
    return {
        "schema": SCHEMA_REVIEW,
        "drawing": name,
        "image": {"width": doc.width, "height": doc.height, "dpi": doc.dpi,
                  "frame_offset": list(off) if off else None},
        "summary": {"gdt_rows": len(gdt_items), "gdt_format_error": errors,
                    "dimensions": len(dims)},
        "gdt": gdt_items,
        "dimensions": dims,
        "other_text": [{"text": o.text, "x": o.x, "y": o.y} for o in doc.other],
        "warnings": warnings,
    }


def _norm(doc: OcrTxt, x: Optional[int], y: Optional[int]):
    if not doc.width or not doc.height or x is None or y is None:
        return None
    return {"x": round(x / doc.width, 6), "y": round(y / doc.height, 6)}


def build_reviewed_json(reviewed_txt: str, log: dict, name: str = "drawing") -> dict:
    """검수 끝난 TXT → 정리된 JSON (선택 출력). 항목마다 출처(ocr / edited / added)를 붙인다."""
    doc = OcrTxt.parse(reviewed_txt)
    off = log.get("frame_offset") or doc.frame_offset
    action = {c["item_id"]: c["action"] for c in log.get("changes", [])}
    gdt = []
    for entry in doc.gdt:
        for r, row in enumerate(entry.rows, 1):
            iid = gdt_item_id(entry.no, r)
            symbol, value, datums = split_row(row)
            gdt.append({
                "item_id": iid, "symbol": symbol, "symbol_name": _symbol_name(symbol),
                "value": value, "datums": datums,
                "source": "edited" if action.get(iid) == "edited" else "ocr",
                "position": {"x": entry.x, "y": entry.y, "anchor": "frame_top_left", "coord": "image"},
            })
    dims = []
    for d in doc.dims:
        iid = f"D{d.no:02d}"
        dims.append({
            "item_id": iid, "text": d.text,
            "source": "added" if action.get(iid) == "added" else "ocr",
            "position": {"x": d.x, "y": d.y, "anchor": "text_center", "coord": "frame"},
            "position_image": {"x": d.x + off[0], "y": d.y + off[1]} if off else None,
        })
    return {
        "schema": "ocr-reviewed/1",
        "drawing": name,
        "reviewer": log.get("reviewer"),
        "reviewed_at": log.get("reviewed_at"),
        "image": {"width": doc.width, "height": doc.height, "dpi": doc.dpi,
                  "frame_offset": list(off) if off else None},
        "gdt": gdt,
        "dimensions": dims,
        "title_table": [w.get("text") for t in doc.tables for w in t.words()],
    }


# ---------------------------------------------------------------- 2) 수정 반영
def compose_dimension_text(item: dict) -> str:
    """작업자 입력(값·종류·공차) → eDOCr2와 같은 모양의 치수 텍스트."""
    if item.get("text"):
        return str(item["text"]).strip()
    value = str(item.get("value", "")).strip()
    if not INPUT_VALUE_RE.match(value):
        raise ReviewError([f"추가 치수 값이 숫자가 아님: {value!r}"])
    kind = item.get("kind", "length")
    if kind not in KIND_PREFIX:
        raise ReviewError([f"추가 치수 종류를 모름: {kind!r} (가능: {', '.join(KIND_PREFIX)})"])
    text = KIND_PREFIX[kind] + value
    tol = item.get("tolerance") or {"type": "general"}
    ttype = tol.get("type", "general")
    if ttype == "general":
        return text
    if ttype == "symmetric":
        t = str(tol.get("value", "")).strip()
        if not INPUT_VALUE_RE.match(t):
            raise ReviewError([f"공차 값이 숫자가 아님: {t!r}"])
        return f"{text}±{t}"
    if ttype == "deviation":
        up, lo = str(tol.get("upper", "")).strip(), str(tol.get("lower", "")).strip()
        for v in (up, lo):
            if not re.match(r"^[+-]?\d+(\.\d+)?$", v):
                raise ReviewError([f"공차 값이 숫자가 아님: {v!r}"])
        up = up if up.startswith(("+", "-")) else "+" + up
        lo = lo if lo.startswith(("+", "-")) else "-" + lo
        return f"{text} {up}/{lo}"
    raise ReviewError([f"공차 종류를 모름: {ttype!r} (general / symmetric / deviation)"])


def apply_review(origin_txt: str, edits: dict, name: str = "drawing",
                 dpi: Optional[int] = 200, require_all: bool = True) -> Tuple[str, dict]:
    """원본 TXT + 작업자 수정 → (수정된 TXT, 수정 기록)

    edits 예:
    {
      "reviewer": "이종민",
      "gdt": [{"item_id": "G01-1", "value": "0.0035"}, ...],      # 기하공차 줄마다 확정 값
      "added_dimensions": [{"value": "7", "kind": "length",
                            "tolerance": {"type": "general"},
                            "x": 1266, "y": 1103, "coord": "image"}],
      "frame_offset": [56, 56]                                       # 선택
    }
    """
    doc = OcrTxt.parse(origin_txt)
    errors: List[str] = []
    warnings: List[str] = []
    changes: List[dict] = []

    rows: Dict[str, Tuple[GdtEntry, int]] = {}
    for entry in doc.gdt:
        for r in range(1, len(entry.rows) + 1):
            rows[gdt_item_id(entry.no, r)] = (entry, r)

    decided: Dict[str, dict] = {}
    for item in edits.get("gdt", []) or []:
        iid = item.get("item_id")
        if iid not in rows:
            errors.append(f"없는 기하공차 항목: {iid!r}")
            continue
        if iid in decided:
            errors.append(f"같은 항목이 두 번 들어옴: {iid}")
            continue
        value = str(item.get("value", "")).strip()
        if not INPUT_VALUE_RE.match(value):
            errors.append(f"{iid}: 확정 값이 숫자가 아님 ({value!r})")
            continue
        for d in item.get("datums") or []:
            if not DATUM_RE.match(str(d)):
                errors.append(f"{iid}: 데이텀 형식이 이상함 ({d!r})")
        decided[iid] = item

    missing = [iid for iid in rows if iid not in decided]
    if missing and require_all:
        errors.append("확정하지 않은 기하공차: " + ", ".join(missing))

    off = edits.get("frame_offset") or doc.frame_offset
    added_specs = []
    for k, item in enumerate(edits.get("added_dimensions", []) or [], 1):
        try:
            text = compose_dimension_text(item)
        except ReviewError as e:
            errors.extend(f"추가 치수 {k}: {m}" for m in e.errors)
            continue
        try:
            x, y = int(round(float(item["x"]))), int(round(float(item["y"])))
        except (KeyError, TypeError, ValueError):
            errors.append(f"추가 치수 {k}: 좌표(x, y)가 없음")
            continue
        if doc.width and doc.height and not (0 <= x < doc.width and 0 <= y < doc.height):
            errors.append(f"추가 치수 {k}: 이미지 밖 좌표 ({x}, {y})")
            continue
        added_specs.append((item, text, x, y))

    if errors:
        raise ReviewError(errors)

    # --- 기하공차 반영 (바뀐 틀만 줄을 고침)
    for entry in doc.gdt:
        new_rows = []
        for r, row in enumerate(entry.rows, 1):
            iid = gdt_item_id(entry.no, r)
            symbol, value, datums = split_row(row)
            item = decided.get(iid)
            if item is None:
                new_rows.append(row)
                continue
            new_symbol = item.get("symbol") or symbol
            new_datums = list(item["datums"]) if item.get("datums") is not None else datums
            new_value = str(item["value"]).strip()
            new_row = "|".join([new_symbol, new_value] + new_datums)
            new_rows.append(new_row)
            changes.append({
                "item_id": iid, "type": "GDT",
                "action": "confirmed" if new_row == row else "edited",
                "before": row, "after": new_row,
                "format_error": check_row(row)[0] == "format_error",
            })
        new_text = "\n".join(new_rows)
        if new_text != entry.text:
            doc.set_gdt_text(entry, new_text)

    # --- 누락 치수 추가
    for item, text, x, y in added_specs:
        coord = item.get("coord", "image")
        if coord == "image":
            if off:
                fx, fy = x - int(off[0]), y - int(off[1])
            else:
                fx, fy = x, y
                warnings.append(f"추가 치수 {text}: frame offset을 몰라 이미지 좌표 그대로 기록함")
        else:
            fx, fy = x, y
        dim = doc.add_dimension(text, fx, fy)
        changes.append({
            "item_id": f"D{dim.no:02d}", "type": "DIMENSION", "action": "added",
            "before": None, "after": text,
            "position_frame": {"x": fx, "y": fy},
            "position_image": {"x": x, "y": y} if coord == "image" else None,
            "input": {k: item.get(k) for k in ("value", "kind", "tolerance") if k in item},
        })

    if dpi and doc.ensure_dpi(dpi):
        warnings.append(f"Image size 줄에 dpi가 없어 'PDF {dpi} dpi'를 붙임 (pdf2image 기본값)")
    if missing:
        warnings.append("확정하지 않은 기하공차 (OCR 값 그대로 둠): " + ", ".join(missing))

    reviewed = doc.text()
    summary = {
        "gdt_rows": len(rows),
        "gdt_confirmed": sum(1 for c in changes if c["action"] == "confirmed"),
        "gdt_edited": sum(1 for c in changes if c["action"] == "edited"),
        "gdt_unreviewed": len(missing),
        "dimensions_ocr": len(doc.dims) - len(added_specs),
        "dimensions_added": len(added_specs),
    }
    log = {
        "schema": SCHEMA_LOG,
        "drawing": name,
        "reviewer": edits.get("reviewer"),
        "reviewed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "origin_sha256": hashlib.sha256(origin_txt.encode("utf-8")).hexdigest(),
        "reviewed_sha256": hashlib.sha256(reviewed.encode("utf-8")).hexdigest(),
        "frame_offset": list(off) if off else None,
        "summary": summary,
        "changes": changes,
        "warnings": warnings,
    }
    return reviewed, log
