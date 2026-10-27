"""목적 구분 전에 저장된 측정 기록(미분류)을 지정한 작업 목적으로 옮기는 명령.

측정 기록·이력에 목적(work_purpose)을 넣으면서 기존 기록은 'unclassified' 로 보존했다.
미분류 기록은 화면에 나오지 않는다. 어느 목적의 기록인지 사람이 확인한 뒤 이 명령으로 옮긴다.
기본 실행은 미리보기이며 아무것도 바꾸지 않는다. 복제하지 않고 한 목적으로만 옮긴다.

실행 (backend 폴더에서):
    python tools/assign_measurement_purpose.py --list
    python tools/assign_measurement_purpose.py --purpose verification --drawing <도면ID> --item D1 --item D2
    python tools/assign_measurement_purpose.py --purpose verification --drawing <도면ID> --all-items --apply
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from drawing_library import database  # noqa: E402
from measurement_api import UNCLASSIFIED, WORK_PURPOSES, init_measurements  # noqa: E402


def list_unclassified() -> tuple[list[dict], int]:
    with database() as db:
        rows = db.execute(
            """
            SELECT r.drawing_id, r.ocr_revision, r.item_id, r.judgement, r.updated_at,
                   (SELECT COUNT(*) FROM measurement_attempts a
                     WHERE a.drawing_id=r.drawing_id AND a.ocr_revision=r.ocr_revision
                       AND a.item_id=r.item_id AND a.work_purpose=?) AS attempts
            FROM measurement_records r
            WHERE r.work_purpose=?
            ORDER BY r.drawing_id, r.ocr_revision, r.item_id
            """,
            (UNCLASSIFIED, UNCLASSIFIED),
        ).fetchall()
        orphan_attempts = db.execute(
            """
            SELECT COUNT(*) FROM measurement_attempts a
            WHERE a.work_purpose=? AND NOT EXISTS (
                SELECT 1 FROM measurement_records r
                WHERE r.drawing_id=a.drawing_id AND r.ocr_revision=a.ocr_revision
                  AND r.item_id=a.item_id AND r.work_purpose=?)
            """,
            (UNCLASSIFIED, UNCLASSIFIED),
        ).fetchone()[0]
    return [dict(row) for row in rows], orphan_attempts


def plan(purpose: str, drawing_id: str, items: list[str] | None, revision: str | None = None) -> list[dict]:
    """옮길 기록과 충돌 여부. 아무것도 쓰지 않는다. items=None 이면 그 도면의 미분류 기록 전부."""
    if purpose not in WORK_PURPOSES:
        raise ValueError(f"작업 목적이 올바르지 않습니다: {purpose!r}")
    if not drawing_id:
        raise ValueError("도면 ID 를 지정해주세요.")
    if items is not None and not items:
        raise ValueError("--item 으로 항목을 지정하거나 --all-items 를 붙여주세요.")
    conditions = ["drawing_id=?", "work_purpose=?"]
    params: list = [drawing_id, UNCLASSIFIED]
    if revision:
        conditions.append("ocr_revision=?")
        params.append(revision)
    if items is not None:
        conditions.append(f"item_id IN ({', '.join('?' for _ in items)})")
        params.extend(items)
    with database() as db:
        rows = [dict(row) for row in db.execute(
            f"SELECT drawing_id, ocr_revision, item_id FROM measurement_records WHERE {' AND '.join(conditions)} "
            "ORDER BY ocr_revision, item_id",
            params,
        )]
        for row in rows:
            row["attempts"] = db.execute(
                "SELECT COUNT(*) FROM measurement_attempts WHERE drawing_id=? AND ocr_revision=? AND item_id=? AND work_purpose=?",
                (row["drawing_id"], row["ocr_revision"], row["item_id"], UNCLASSIFIED),
            ).fetchone()[0]
            row["conflict"] = db.execute(
                "SELECT 1 FROM measurement_records WHERE drawing_id=? AND ocr_revision=? AND item_id=? AND work_purpose=?",
                (row["drawing_id"], row["ocr_revision"], row["item_id"], purpose),
            ).fetchone() is not None
    if items is not None:
        found = {row["item_id"] for row in rows}
        missing = [item for item in items if item not in found]
        if missing:
            raise ValueError(f"미분류 측정 기록이 없는 항목: {missing}")
    return rows


def apply(purpose: str, drawing_id: str, items: list[str] | None, revision: str | None = None) -> dict:
    rows = plan(purpose, drawing_id, items, revision)
    if not rows:
        raise ValueError("옮길 미분류 측정 기록이 없습니다.")
    conflicts = [row for row in rows if row["conflict"]]
    if conflicts:
        raise ValueError(
            "이미 이 목적의 측정 기록이 있어 덮어쓰지 않고 중단했습니다: "
            + ", ".join(f"{row['item_id']}@{row['ocr_revision'][:8]}" for row in conflicts)
        )
    moved_records = moved_attempts = 0
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        for row in rows:
            key = (row["drawing_id"], row["ocr_revision"], row["item_id"])
            moved_records += db.execute(
                "UPDATE measurement_records SET work_purpose=? WHERE drawing_id=? AND ocr_revision=? AND item_id=? AND work_purpose=?",
                (purpose, *key, UNCLASSIFIED),
            ).rowcount
            moved_attempts += db.execute(
                "UPDATE measurement_attempts SET work_purpose=? WHERE drawing_id=? AND ocr_revision=? AND item_id=? AND work_purpose=?",
                (purpose, *key, UNCLASSIFIED),
            ).rowcount
    return {"purpose": purpose, "records": moved_records, "attempts": moved_attempts}


def main(argv=None):
    parser = argparse.ArgumentParser(description="미분류 측정 기록을 작업 목적으로 옮긴다 (기본: 미리보기)")
    parser.add_argument("--list", action="store_true", help="미분류 측정 기록 보기")
    parser.add_argument("--purpose", choices=WORK_PURPOSES, help="옮길 작업 목적")
    parser.add_argument("--drawing", help="도면 ID")
    parser.add_argument("--revision", help="OCR revision (생략하면 그 도면의 모든 revision)")
    parser.add_argument("--item", action="append", default=[], help="항목 ID (여러 번 지정)")
    parser.add_argument("--all-items", action="store_true", help="그 도면의 미분류 기록 전부")
    parser.add_argument("--apply", action="store_true", help="실제로 옮긴다 (없으면 미리보기만)")
    args = parser.parse_args(argv)

    init_measurements()
    if args.list:
        rows, orphan = list_unclassified()
        for row in rows:
            print(f"{row['drawing_id']}\t{row['ocr_revision']}\t{row['item_id']}\t{row['judgement']}\t이력 {row['attempts']}건\t{row['updated_at']}")
        print(f"미분류 측정 기록 {len(rows)}건 · 기록 없이 남은 미분류 이력 {orphan}건")
        return 0
    if not args.purpose or not args.drawing:
        parser.error("--purpose 와 --drawing 을 지정해주세요.")
    if bool(args.item) == args.all_items:
        parser.error("--item 을 하나 이상 지정하거나 --all-items 중 하나만 쓰세요.")
    items = None if args.all_items else args.item

    if not args.apply:
        for row in plan(args.purpose, args.drawing, items, args.revision):
            mark = "충돌(이미 기록 있음)" if row["conflict"] else "이동 예정"
            print(f"  [{mark}] {row['item_id']} @ {row['ocr_revision']} · 이력 {row['attempts']}건")
        print("\n미리보기입니다. 실제로 옮기려면 --apply 를 붙여 다시 실행하세요.")
        return 0
    result = apply(args.purpose, args.drawing, items, args.revision)
    print(f"{result['purpose']} 로 이동: 측정 기록 {result['records']}건 · 이력 {result['attempts']}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
