"""관리자용 '선택한 부품·도면의 작업 진행 현황' (조회 전용).

기존 기록만 읽는다. 측정값·검토값을 바꾸거나 새 업무 규칙(제작 완료 전 조립 차단 등)을 만들지 않는다.

기록 단위 (서로 연결돼 있지 않다)
- 부품제작: machining_stage_records — 도면 · OCR 버전 · 제품 번호(시리얼) · 항목 · 단계(황삭·중삭·정삭)
- 조립·검증: measurement_records — 도면 · OCR 버전 · 목적 · 항목 (제품 번호 없음, 항목마다 최신 1건)
  → 제작의 제품 번호와 조립·검증 기록은 같은 실물인지 알 수 없으므로 한 실물의 이력으로 합치지 않는다.

상태 구분 (건수는 서로 겹치지 않는다: 대상 = 완료 + 불합격 + 미완료)
- 완료: 판정 합격이고 작업자가 확정한 기록 (measurement_state == 'completed')
- 불합격: 최신 판정이 불합격 (재측정 필요)
- 미완료: 그 밖의 전부 — 미측정 · 확정 전(합격 미확정) · 판정 기준 확인 필요
- 진행률 = 완료 / 대상. 대상이 0 이면 '대상 없음', 계산 근거가 없으면 '산정 불가'로 두고 0% 로 쓰지 않는다.
- 관리자가 오인식으로 제외한 OCR 항목(excluded)은 대상·항목 목록에서 뺀다 (번호는 OCR 순서 그대로).
"""

import json

from fastapi import APIRouter, HTTPException

from drawing_library import database
from machining_api import STAGE_KEYS, STAGE_NAMES, build_plan, read_records, stage_status
from measurement_api import measurement_state
from ocr_results import read_ocr_result
from purpose_errors.purposes import STORES, Purpose
from purpose_errors.store import local_time

router = APIRouter(prefix="/api/admin/drawings", tags=["관리자 작업 진행 현황"])

PURPOSE_UNIT = {
    "manufacturing": "제품 번호별 · 단계별 측정항목",
    "assembly": "도면 항목별 최신 1건 (제품 번호 없음)",
    "verification": "도면 항목별 최신 1건 (제품 번호 없음)",
}


def _measurable(document: dict) -> list[dict]:
    """작업 대상 OCR 항목. 관리자가 오인식으로 제외한 항목은 재지 않는다."""
    return [item for item in document.get("items", []) if not item.get("excluded")]


def _ratio(done: int, total: int):
    return None if total <= 0 else round(done / total, 4)


def _drawing(drawing_id: str) -> dict:
    with database() as db:
        row = db.execute(
            """
            SELECT d.drawing_id, d.part_id, d.original_filename, d.name, d.ocr_status, p.name AS part_name
            FROM drawings d LEFT JOIN parts p ON p.part_id = d.part_id
            WHERE d.drawing_id = ?
            """,
            (drawing_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "도면을 찾을 수 없습니다.")
    return dict(row)


def _measurement_rows(drawing_id: str, purpose: str) -> list[dict]:
    with database() as db:
        rows = db.execute(
            """
            SELECT ocr_revision, item_id, measured_value, measurement_mode, gauge_result, instrument, note,
                   judgement, judgement_reason, confirmed, updated_at
            FROM measurement_records WHERE drawing_id=? AND work_purpose=?
            """,
            (drawing_id, purpose),
        ).fetchall()
    result = []
    for row in rows:
        record = dict(row)
        record["confirmed"] = bool(record["confirmed"])
        record["status"] = measurement_state(record["judgement"], record["confirmed"])
        record["updated_at"] = local_time(record["updated_at"])  # CURRENT_TIMESTAMP(UTC) → 현지 시각
        result.append(record)
    return result


def _link_counts(drawing_id: str, revision: str) -> dict[str, dict[str, int]]:
    """목적별 · 항목별 연결 중인 사례 수 (현재 OCR 버전)."""
    counts: dict[str, dict[str, int]] = {}
    with database() as db:
        for purpose, store in STORES.items():
            rows = db.execute(
                f"""
                SELECT item_id, COUNT(*) AS n FROM {store.link_table}
                WHERE drawing_id=? AND ocr_revision=? AND unlinked_at IS NULL GROUP BY item_id
                """,
                (drawing_id, revision),
            ).fetchall()
            counts[purpose.value] = {row["item_id"]: row["n"] for row in rows}
    return counts


def _unavailable(reason: str) -> dict:
    return {"state": "unavailable", "reason": reason}


def _manufacturing(drawing_id: str, revision: str, document: dict) -> tuple[dict, dict]:
    plan = build_plan(drawing_id, document)
    records = read_records(drawing_id, revision)
    serials = sorted({record["serial"] for record in records})
    by_serial = {serial: [r for r in records if r["serial"] == serial] for serial in serials}
    statuses = {serial: stage_status(plan, by_serial[serial]) for serial in serials}

    stages = {}
    for stage in STAGE_KEYS:
        required = sum(1 for item in plan["items"] if item["stages"][stage])
        total = required * len(serials)
        passed = sum(statuses[s][stage]["passed"] for s in serials)
        failed = sum(statuses[s][stage]["failed"] for s in serials)
        stages[stage] = {
            "name": STAGE_NAMES[stage],
            "required_items": required,
            "target": total,
            "completed": passed,
            "failed": failed,
            "incomplete": total - passed - failed,
            "progress": _ratio(passed, total),
            "units_complete": sum(1 for s in serials if statuses[s][stage]["complete"]),
        }

    target = sum(entry["target"] for entry in stages.values())
    completed = sum(entry["completed"] for entry in stages.values())
    failed = sum(entry["failed"] for entry in stages.values())
    if not serials:
        example = f"{plan.get('part_key') or 'S'}01"
        state, reason = "unavailable", (
            f"아직 부품제작 측정 기록이 없습니다. 제품 번호(예: {example})를 정해 첫 측정을 저장하면 진행률이 계산됩니다."
        )
    elif target == 0:
        state, reason = "no_target", "단계 측정 대상 항목이 없습니다."
    else:
        state, reason = "ok", ""
    card = {
        "state": state,
        "reason": reason,
        "unit": PURPOSE_UNIT["manufacturing"],
        "units": serials,
        "target": target,
        "completed": completed,
        "failed": failed,
        "incomplete": target - completed - failed,
        "progress": _ratio(completed, target) if state == "ok" else None,
        "last_recorded_at": max((r["updated_at"] for r in records), default=None),
        "stages": stages,
        "template_found": plan["template_found"],
        "part_label": plan["part_label"],
        "by_unit": {
            serial: {stage: {key: statuses[serial][stage][key] for key in ("required", "passed", "failed", "complete", "unlocked")}
                     for stage in STAGE_KEYS}
            for serial in serials
        },
    }
    # 항목별: 단계마다 몇 개 제품이 완료·불합격인지
    items = {}
    for item in plan["items"]:
        per_stage = {}
        for stage in STAGE_KEYS:
            if not item["stages"][stage]:
                continue
            rows = [r for r in records if r["item_id"] == item["item_id"] and r["stage"] == stage]
            per_stage[stage] = {
                "completed": sum(1 for r in rows if r["status"] == "completed"),
                "failed": sum(1 for r in rows if r["judgement"] == "fail"),
                "recorded": len(rows),
                "units": len(serials),
            }
        items[item["item_id"]] = {"plan": item["plan"], "plan_label": item["plan_label"], "stages": per_stage}
    return card, items


def _summarize_measurements(purpose: str, rows: list[dict], revision: str, document: dict) -> tuple[dict, dict]:
    item_ids = [item["id"] for item in _measurable(document)]
    current = {r["item_id"]: r for r in rows if r["ocr_revision"] == revision and r["item_id"] in set(item_ids)}
    completed = sum(1 for r in current.values() if r["status"] == "completed")
    failed = sum(1 for r in current.values() if r["status"] == "remeasure")
    target = len(item_ids)
    card = {
        "state": "ok" if target else "no_target",
        "reason": "" if target else "OCR 측정항목이 없습니다.",
        "unit": PURPOSE_UNIT[purpose],
        "target": target,
        "completed": completed,
        "failed": failed,
        "incomplete": target - completed - failed,
        "not_measured": target - len(current),
        "unconfirmed": sum(1 for r in current.values() if r["status"] == "pending"),
        "review_required": sum(1 for r in current.values() if r["status"] == "review_required"),
        "progress": _ratio(completed, target),
        "last_recorded_at": max((r["updated_at"] for r in current.values()), default=None),
        "previous_revision_records": sum(1 for r in rows if r["ocr_revision"] != revision),
    }
    items = {item_id: (current[item_id] if item_id in current else None) for item_id in item_ids}
    return card, items


@router.get("/{drawing_id}/progress")
def drawing_progress(drawing_id: str):
    drawing = _drawing(drawing_id)
    snapshot = read_ocr_result(drawing_id)
    document = snapshot["result"]
    base = {
        "drawing": drawing,
        "owner": None,  # 담당자는 저장하지 않는다 (화면에 '미기록')
        "ocr": {
            "has_result": document is not None,
            "revision": snapshot.get("revision"),
            "review_status": (document or {}).get("review_status") or ("none" if document is None else "pending"),
            "item_count": len(_measurable(document or {})),
        },
    }
    with database() as db:
        base["unclassified_records"] = db.execute(
            "SELECT COUNT(*) FROM measurement_records WHERE drawing_id=? AND work_purpose='unclassified'",
            (drawing_id,),
        ).fetchone()[0]

    if document is None:
        reason = "OCR 결과가 없어 작업 대상이 정해지지 않았습니다."
    elif document.get("review_status") != "reviewed":
        reason = "관리자 OCR 검토가 끝나지 않아 작업 대상이 확정되지 않았습니다."
    else:
        reason = ""
    if reason:
        return {**base, "stages": {p.value: _unavailable(reason) for p in Purpose}, "items": []}

    revision = snapshot["revision"]
    mfg_card, mfg_items = _manufacturing(drawing_id, revision, document)
    cards, records = {"manufacturing": mfg_card}, {}
    for purpose in ("assembly", "verification"):
        rows = _measurement_rows(drawing_id, purpose)
        cards[purpose], records[purpose] = _summarize_measurements(purpose, rows, revision, document)

    links = _link_counts(drawing_id, revision)
    items = []
    for index, item in enumerate(document.get("items", [])):
        if item.get("excluded"):
            continue
        item_id = item["id"]
        items.append({
            "item_id": item_id,
            "number": index + 1,
            "raw_text": item.get("raw_text", ""),
            "category": item.get("category", ""),
            "manufacturing": mfg_items.get(item_id),
            "assembly": records["assembly"].get(item_id),
            "verification": records["verification"].get(item_id),
            "links": {purpose: links[purpose].get(item_id, 0) for purpose in links},
        })
    return {**base, "stages": cards, "items": items}


@router.get("/{drawing_id}/progress/items/{item_id}")
def item_progress(drawing_id: str, item_id: str, revision: str):
    """항목 하나의 측정값·판정·시도 이력·연결 사례·사례 이력 (현재 OCR 버전만)."""
    _drawing(drawing_id)
    snapshot = read_ocr_result(drawing_id)
    if snapshot["result"] is None:
        raise HTTPException(409, "OCR 결과가 없는 도면입니다.")
    if snapshot["revision"] != revision:
        raise HTTPException(409, "OCR 결과가 변경됐습니다. 현황을 다시 불러와 주세요.")
    item = next((entry for entry in snapshot["result"]["items"] if entry["id"] == item_id), None)
    if item is None:
        raise HTTPException(404, "이 도면의 측정항목을 찾을 수 없습니다.")

    machining = [r for r in read_records(drawing_id, revision) if r["item_id"] == item_id]
    with database() as db:
        machining_attempts = [
            {**json.loads(row["record_json"]), "serial": row["serial"], "stage": row["stage"], "created_at": row["created_at"]}
            for row in db.execute(
                """SELECT serial, stage, record_json, created_at FROM machining_stage_attempts
                   WHERE drawing_id=? AND ocr_revision=? AND item_id=? ORDER BY attempt_id DESC LIMIT 200""",
                (drawing_id, revision, item_id),
            )
        ]
        attempts = {}
        for purpose in ("assembly", "verification"):
            attempts[purpose] = [
                {**json.loads(row["record_json"]), "created_at": local_time(row["created_at"])}
                for row in db.execute(
                    """SELECT record_json, created_at FROM measurement_attempts
                       WHERE drawing_id=? AND ocr_revision=? AND work_purpose=? AND item_id=?
                       ORDER BY attempt_id DESC LIMIT 200""",
                    (drawing_id, revision, purpose, item_id),
                )
            ]
        links, history = {}, {}
        for purpose, store in STORES.items():
            links[purpose.value] = [
                {**dict(row), "case_active": bool(row["case_active"]), "linked": row["unlinked_at"] is None,
                 "created_at": local_time(row["created_at"]), "unlinked_at": local_time(row["unlinked_at"])}
                for row in db.execute(
                    f"""SELECT l.link_id, l.case_id, l.source, l.created_at, l.unlinked_at,
                               c.case_title, c.error_description, c.active AS case_active
                        FROM {store.link_table} l JOIN {store.case_table} c ON c.case_id = l.case_id
                        WHERE l.drawing_id=? AND l.ocr_revision=? AND l.item_id=?
                        ORDER BY l.created_at DESC""",
                    (drawing_id, revision, item_id),
                )
            ]
            history[purpose.value] = [
                {**dict(row), "created_at": local_time(row["created_at"])}
                for row in db.execute(
                    f"""SELECT h.event_id, h.case_id, h.action, h.created_at, h.actor, c.case_title
                        FROM {store.history_table} h LEFT JOIN {store.case_table} c ON c.case_id = h.case_id
                        WHERE h.drawing_id=? AND h.ocr_revision=? AND h.item_id=?
                        ORDER BY h.event_id DESC LIMIT 200""",
                    (drawing_id, revision, item_id),
                )
            ]
    current = {purpose: next((r for r in _measurement_rows(drawing_id, purpose)
                              if r["ocr_revision"] == revision and r["item_id"] == item_id), None)
               for purpose in ("assembly", "verification")}
    return {
        "drawing_id": drawing_id,
        "revision": revision,
        "item": item,
        "manufacturing": {"records": machining, "attempts": machining_attempts},
        "assembly": {"record": current["assembly"], "attempts": attempts["assembly"]},
        "verification": {"record": current["verification"], "attempts": attempts["verification"]},
        "links": links,
        "history": history,
    }
