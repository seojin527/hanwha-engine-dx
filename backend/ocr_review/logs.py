"""검수 기록 남기기.

검수할 때마다 3가지가 남는다.
  1) 도면_review_log.txt   : 사람이 읽는 기록 (이번 검수)
  2) 도면_review_log.json  : 같은 내용, 프로그램용
  3) logs/review_history.csv : 모든 검수의 모든 항목이 계속 쌓이는 누적 기록 (엑셀로 열림, 덮어쓰지 않음)
     → 나중에 '자주 틀리는 값' 통계, 반복 오류 자동 수정 규칙, OCR 정확도 검증에 사용
"""
from __future__ import annotations

import csv
import json
import os
from datetime import datetime
from typing import Optional

from .review import SYMBOL_NAMES

HISTORY_FILE = "review_history.csv"
HISTORY_COLUMNS = [
    "reviewed_at", "drawing", "reviewer", "item_id", "type", "action",
    "symbol", "before", "after", "format_error", "x", "y", "origin_file", "origin_sha256",
]
ACTION_KO = {"confirmed": "그대로", "edited": "수정", "added": "추가"}


def _local_time(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).astimezone().strftime("%Y-%m-%d %H:%M:%S (%Z)")
    except ValueError:
        return iso


def _row_parts(row: Optional[str]):
    """'⏥|0.035|A' → ('⏥', '평면도', '0.035', 'A')"""
    if not row:
        return "", "", "", ""
    cells = row.split("|")
    symbol = cells[0]
    name = next((SYMBOL_NAMES[ch] for ch in symbol if ch in SYMBOL_NAMES), "기호?")
    value = cells[1] if len(cells) > 1 else ""
    return symbol, name, value, " ".join(cells[2:])


def format_log_text(log: dict, origin_file: str = "", reviewed_file: str = "") -> str:
    s = log["summary"]
    bar = "=" * 64
    out = [
        bar, " OCR 검수 기록", bar,
        f"도면        : {log.get('drawing')}",
        f"작업자      : {log.get('reviewer') or '-'}",
        f"검수 시각   : {_local_time(log.get('reviewed_at', ''))}",
        f"원본 파일   : {origin_file or '-'}  (sha256 {log.get('origin_sha256', '')[:12]})",
        f"결과 파일   : {reviewed_file or '-'}",
        "",
        "[ 요약 ]",
        f"기하공차 {s['gdt_rows']}줄 : 그대로 {s['gdt_confirmed']} · 수정 {s['gdt_edited']} · 미확정 {s['gdt_unreviewed']}",
        f"치수        : 인식 {s['dimensions_ocr']} (값 수정 {s.get('dimensions_edited', 0)}) + 추가 {s['dimensions_added']}",
        "",
        "[ 수정·추가 내역 ]",
    ]
    changed = [c for c in log["changes"] if c["action"] in ("edited", "added")]
    if not changed:
        out.append("(없음)")
    for c in changed:
        if c["action"] == "edited" and c["type"] == "DIMENSION":
            out.append(f"수정  {c['item_id']:<6} 치수     {c['before']} → {c['after']}")
        elif c["action"] == "edited":
            sym, name, before, _ = _row_parts(c["before"])
            _, _, after, datum = _row_parts(c["after"])
            note = "  (형식 오류였음)" if c.get("format_error") else ""
            out.append(f"수정  {c['item_id']:<6} {sym} {name:<6} {before or '(빈칸)'} → {after}"
                       f"{'  데이텀 ' + datum if datum else ''}{note}")
        else:
            img = c.get("position_image") or {}
            frm = c.get("position_frame") or {}
            inp = c.get("input") or {}
            kind = {"length": "길이", "diameter": "지름", "radius": "반경", "chamfer": "모따기",
                    "thread": "나사"}.get(inp.get("kind", ""), "")
            tol = (inp.get("tolerance") or {}).get("type", "")
            tol_ko = {"general": "일반공차", "symmetric": "± 공차", "deviation": "위/아래 공차"}.get(tol, "")
            where = f"이미지({img.get('x')}, {img.get('y')}) / 도면({frm.get('x')}, {frm.get('y')})" if img \
                else f"도면({frm.get('x')}, {frm.get('y')})"
            extra = " · ".join(v for v in (kind, tol_ko) if v)
            out.append(f"추가  {c['item_id']:<6} {c['after']:<12} 위치 {where}{' · ' + extra if extra else ''}")

    same = [c for c in log["changes"] if c["action"] == "confirmed"]
    out += ["", "[ OCR 값 그대로 확정 ]"]
    if not same:
        out.append("(없음)")
    for c in same:
        sym, name, value, _ = _row_parts(c["after"])
        out.append(f"      {c['item_id']:<6} {sym} {name:<6} {value}")

    if log.get("warnings"):
        out += ["", "[ 경고 ]"] + [f"- {w}" for w in log["warnings"]]
    return "\n".join(out) + "\n"


def append_history(log: dict, history_path: str, origin_file: str = "") -> int:
    """누적 기록에 이번 검수의 항목들을 한 줄씩 추가. 추가한 줄 수를 돌려준다."""
    folder = os.path.dirname(history_path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    new_file = not os.path.exists(history_path) or os.path.getsize(history_path) == 0
    rows = 0
    with open(history_path, "a", encoding="utf-8-sig" if new_file else "utf-8", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(HISTORY_COLUMNS)
        for c in log["changes"]:
            sym = _row_parts(c["after"])[0] if c["type"] == "GDT" else ""
            before = _row_parts(c["before"])[2] if c["type"] == "GDT" else (c["before"] or "")
            after = _row_parts(c["after"])[2] if c["type"] == "GDT" else c["after"]
            pos = c.get("position_image") or c.get("position_frame") or {}
            w.writerow([
                _local_time(log.get("reviewed_at", ""))[:19], log.get("drawing"), log.get("reviewer") or "",
                c["item_id"], c["type"], c["action"], sym, before, after,
                "Y" if c.get("format_error") else "", pos.get("x", ""), pos.get("y", ""),
                os.path.basename(origin_file), log.get("origin_sha256", ""),
            ])
            rows += 1
    return rows


def write_logs(log: dict, base: str, log_dir: Optional[str], origin_file: str = "",
               reviewed_file: str = "") -> list:
    """도면_review_log.txt / .json 저장 + 누적 기록 추가. 저장한 경로 목록을 돌려준다."""
    saved = []
    txt_path, json_path = base + "_review_log.txt", base + "_review_log.json"
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(format_log_text(log, os.path.basename(origin_file), os.path.basename(reviewed_file)))
    saved.append(txt_path)
    with open(json_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(log, ensure_ascii=False, indent=2) + "\n")
    saved.append(json_path)
    if log_dir:
        history = os.path.join(log_dir, HISTORY_FILE)
        append_history(log, history, origin_file)
        saved.append(history)
    return saved
