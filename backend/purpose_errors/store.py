"""목적별 오류사례 원문·포인트 연결 기록의 SQLite 처리 (공통 코드).

DB 접속은 기존 drawing_library.database() 를 그대로 쓴다.
테이블 이름은 purposes.STORES 에서만 가져오며, 요청값으로 만들지 않는다.
"""

import json

from drawing_library import database

from .purposes import STORES, PurposeStore


def init_purpose_tables():
    """세 목적의 원문 테이블과 포인트 연결 기록 테이블을 준비한다 (기존 error_cases 는 건드리지 않는다)."""
    with database() as db:
        for store in STORES.values():
            db.execute(store.schema.create_table_sql(store.case_table))
            db.execute(f"""
                CREATE TABLE IF NOT EXISTS {store.report_table} (
                    report_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL UNIQUE
                        REFERENCES {store.case_table}(case_id),
                    drawing_id TEXT NOT NULL
                        REFERENCES drawings(drawing_id),
                    item_id TEXT NOT NULL,
                    ocr_revision TEXT NOT NULL,
                    item_snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)


def insert_case(db, store: PurposeStore, data: dict, *, upsert: bool = False):
    fields = list(data)
    columns = ", ".join(fields)
    placeholders = ", ".join("?" for _ in fields)
    sql = f"INSERT INTO {store.case_table} ({columns}) VALUES ({placeholders})"
    if upsert:
        updates = ", ".join(f"{field}=excluded.{field}" for field in fields if field != "case_id")
        sql += f"""
            ON CONFLICT(case_id) DO UPDATE SET
                {updates},
                vector_status='pending',
                updated_at=CURRENT_TIMESTAMP
        """
    db.execute(sql, [data[field] for field in fields])


def get_case(store: PurposeStore, case_id: str) -> dict | None:
    with database() as db:
        row = db.execute(
            f"SELECT * FROM {store.case_table} WHERE case_id=?",
            (case_id,),
        ).fetchone()
    return dict(row) if row else None


def get_cases(store: PurposeStore, case_ids: list[str]) -> list[dict]:
    if not case_ids:
        return []
    placeholders = ", ".join("?" for _ in case_ids)
    with database() as db:
        rows = db.execute(
            f"SELECT * FROM {store.case_table} WHERE case_id IN ({placeholders})",
            case_ids,
        ).fetchall()
    order = {case_id: index for index, case_id in enumerate(case_ids)}
    return sorted((dict(row) for row in rows), key=lambda row: order[row["case_id"]])


def set_vector_status(store: PurposeStore, case_ids: list[str], status: str):
    with database() as db:
        db.executemany(
            f"""
            UPDATE {store.case_table}
            SET vector_status=?, updated_at=CURRENT_TIMESTAMP
            WHERE case_id=?
            """,
            [(status, case_id) for case_id in case_ids],
        )


def find_report(db, store: PurposeStore, report_id: str):
    return db.execute(
        f"SELECT * FROM {store.report_table} WHERE report_id=?",
        (report_id,),
    ).fetchone()


def insert_report(db, store: PurposeStore, *, report_id, case_id, drawing_id, item_id, revision, item):
    db.execute(
        f"""
        INSERT INTO {store.report_table} (
            report_id, case_id, drawing_id, item_id, ocr_revision, item_snapshot_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (report_id, case_id, drawing_id, item_id, revision, json.dumps(item, ensure_ascii=False)),
    )


def list_point_reports(store: PurposeStore, drawing_id: str, item_id: str, revision: str) -> list[dict]:
    with database() as db:
        rows = db.execute(
            f"""
            SELECT c.case_id, c.case_title, c.error_description,
                   c.vector_status, r.created_at
            FROM {store.report_table} r
            JOIN {store.case_table} c ON c.case_id = r.case_id
            WHERE r.drawing_id=? AND r.item_id=? AND r.ocr_revision=?
            ORDER BY r.created_at DESC, r.report_id
            """,
            (drawing_id, item_id, revision),
        ).fetchall()
    return [dict(row) for row in rows]


def count_cases(store: PurposeStore) -> int:
    with database() as db:
        return db.execute(f"SELECT COUNT(*) FROM {store.case_table}").fetchone()[0]
