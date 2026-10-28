"""목적별 오류사례 원문·포인트 연결 기록의 SQLite 처리 (공통 코드).

DB 접속은 기존 drawing_library.database() 를 그대로 쓴다.
테이블 이름은 purposes.STORES 에서만 가져오며, 요청값으로 만들지 않는다.

관리자 기능 테이블 (init_purpose_tables 가 반복 실행해도 기존 데이터를 바꾸지 않게 만든다)
- <목적>_error_cases.active: 1=활성, 0=비활성. 삭제 대신 비활성으로 두며, 비활성 사례는 검색·새 연결에서 뺀다.
- <목적>_case_links: 도면 ID + OCR 버전 + 항목 ID 에 명시적으로 연결한 사례. 해제는 unlinked_at 만 채운다.
- <목적>_case_history: 등록·수정·비활성화·재활성화·연결·해제 이력 (기능 도입 이후부터 기록).
- error_case_uploads / error_case_upload_files: 엑셀 적재 이력 (기능 도입 이후부터 기록, 목적 열로 구분).
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

from drawing_library import database

from .purposes import STORES, Purpose, PurposeStore

HISTORY_ACTIONS = ("create", "update", "deactivate", "reactivate", "link", "unlink")
_PURPOSE_CHECK = "purpose IN (" + ", ".join(f"'{p.value}'" for p in Purpose) + ")"


def _columns(db, table: str) -> set[str]:
    return {row["name"] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}


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
            _migrate_admin_tables(db, store)
        db.execute(f"""
            CREATE TABLE IF NOT EXISTS error_case_uploads (
                upload_id TEXT PRIMARY KEY,
                purpose TEXT NOT NULL CHECK ({_PURPOSE_CHECK}),
                source TEXT NOT NULL CHECK (source IN ('admin_ui', 'cli')),
                status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
                file_count INTEGER NOT NULL,
                row_count INTEGER NOT NULL DEFAULT 0,
                created_count INTEGER NOT NULL DEFAULT 0,
                updated_count INTEGER NOT NULL DEFAULT 0,
                unchanged_count INTEGER NOT NULL DEFAULT 0,
                vector_status TEXT NOT NULL DEFAULT 'none'
                    CHECK (vector_status IN ('none', 'pending', 'ready', 'failed')),
                vector_ready INTEGER NOT NULL DEFAULT 0,
                vector_failed INTEGER NOT NULL DEFAULT 0,
                errors_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS error_case_upload_files (
                upload_id TEXT NOT NULL REFERENCES error_case_uploads(upload_id),
                file_index INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                sheet TEXT NOT NULL,
                row_count INTEGER NOT NULL DEFAULT 0,
                created_count INTEGER NOT NULL DEFAULT 0,
                updated_count INTEGER NOT NULL DEFAULT 0,
                unchanged_count INTEGER NOT NULL DEFAULT 0,
                vector_status TEXT NOT NULL DEFAULT 'none'
                    CHECK (vector_status IN ('none', 'pending', 'ready', 'failed')),
                PRIMARY KEY (upload_id, file_index)
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS error_case_uploads_purpose ON error_case_uploads (purpose, created_at)")


def _migrate_admin_tables(db, store: PurposeStore):
    # 기존 사례는 모두 활성으로 둔다 (열 기본값). 이미 있으면 건너뛴다.
    if "active" not in _columns(db, store.case_table):
        db.execute(f"ALTER TABLE {store.case_table} ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))")

    db.execute(f"""
        CREATE TABLE IF NOT EXISTS {store.link_table} (
            link_id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES {store.case_table}(case_id),
            drawing_id TEXT NOT NULL REFERENCES drawings(drawing_id),
            ocr_revision TEXT NOT NULL,
            item_id TEXT NOT NULL,
            item_snapshot_json TEXT NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('point_report', 'admin')),
            report_id TEXT UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            unlinked_at TEXT
        )
    """)
    # 같은 항목에 같은 사례가 연결 중인 것은 하나만 (해제된 기록은 여러 개 남을 수 있다).
    db.execute(f"""
        CREATE UNIQUE INDEX IF NOT EXISTS {store.link_table}_active
        ON {store.link_table} (case_id, drawing_id, ocr_revision, item_id)
        WHERE unlinked_at IS NULL
    """)
    db.execute(f"CREATE INDEX IF NOT EXISTS {store.link_table}_item ON {store.link_table} (drawing_id, ocr_revision, item_id)")
    # 이 기능 전의 포인트 등록 기록은 그 자체가 '등록한 항목에 연결'이므로 연결로 한 번만 옮긴다.
    # 이력(history)은 만들지 않는다 (기능 도입 전 이력을 지어내지 않는다).
    db.execute(f"""
        INSERT OR IGNORE INTO {store.link_table}
            (link_id, case_id, drawing_id, ocr_revision, item_id, item_snapshot_json, source, report_id, created_at)
        SELECT 'LNK-' || r.report_id, r.case_id, r.drawing_id, r.ocr_revision, r.item_id,
               r.item_snapshot_json, 'point_report', r.report_id, r.created_at
        FROM {store.report_table} r
    """)

    actions = ", ".join(f"'{action}'" for action in HISTORY_ACTIONS)
    db.execute(f"""
        CREATE TABLE IF NOT EXISTS {store.history_table} (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT NOT NULL,
            action TEXT NOT NULL CHECK (action IN ({actions})),
            drawing_id TEXT,
            ocr_revision TEXT,
            item_id TEXT,
            link_id TEXT,
            upload_id TEXT,
            detail_json TEXT NOT NULL DEFAULT '{{}}',
            actor TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    db.execute(f"CREATE INDEX IF NOT EXISTS {store.history_table}_case ON {store.history_table} (case_id, event_id)")


# ------------------------------------------------------------------ 시각

def local_time(value: str | None) -> str | None:
    """SQLite CURRENT_TIMESTAMP(UTC) 문자열을 이 PC 의 현지 시각 문자열로 바꾼다."""
    if not value:
        return value
    try:
        moment = datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return value
    return moment.astimezone().strftime("%Y-%m-%d %H:%M:%S")


# ------------------------------------------------------------------ 사례 원문

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


def update_case_fields(db, store: PurposeStore, case_id: str, data: dict):
    """원문 필드만 바꾸고 벡터는 다시 반영해야 하는 상태로 둔다. 활성 상태는 바꾸지 않는다."""
    fields = [field for field in data if field not in ("case_id", "active", "vector_status")]
    assignments = ", ".join(f"{field}=?" for field in fields)
    db.execute(
        f"UPDATE {store.case_table} SET {assignments}, vector_status='pending', updated_at=CURRENT_TIMESTAMP WHERE case_id=?",
        [data[field] for field in fields] + [case_id],
    )


def set_active(db, store: PurposeStore, case_id: str, active: bool):
    db.execute(
        f"UPDATE {store.case_table} SET active=?, updated_at=CURRENT_TIMESTAMP WHERE case_id=?",
        (1 if active else 0, case_id),
    )


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


def active_case_ids(store: PurposeStore, case_ids: list[str]) -> set[str]:
    """원문 테이블에서 활성인 사례만. 검색 결과는 벡터가 아니라 이 값으로 거른다."""
    if not case_ids:
        return set()
    placeholders = ", ".join("?" for _ in case_ids)
    with database() as db:
        rows = db.execute(
            f"SELECT case_id FROM {store.case_table} WHERE active=1 AND case_id IN ({placeholders})",
            case_ids,
        ).fetchall()
    return {row["case_id"] for row in rows}


def count_inactive(store: PurposeStore) -> int:
    with database() as db:
        return db.execute(f"SELECT COUNT(*) FROM {store.case_table} WHERE active=0").fetchone()[0]


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


# ------------------------------------------------------------------ 이력

def add_history(db, store: PurposeStore, case_id: str, action: str, *, drawing_id=None, revision=None,
                item_id=None, link_id=None, upload_id=None, detail: dict | None = None):
    # 서버 인증이 없으므로 작성자(actor)는 비워 둔다. 화면에서 고른 역할 이름은 사용자로 기록하지 않는다.
    db.execute(
        f"""
        INSERT INTO {store.history_table}
            (case_id, action, drawing_id, ocr_revision, item_id, link_id, upload_id, detail_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (case_id, action, drawing_id, revision, item_id, link_id, upload_id,
         json.dumps(detail or {}, ensure_ascii=False)),
    )


# ------------------------------------------------------------------ 포인트 등록·연결

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


def find_active_link(db, store: PurposeStore, *, case_id, drawing_id, revision, item_id):
    return db.execute(
        f"""
        SELECT * FROM {store.link_table}
        WHERE case_id=? AND drawing_id=? AND ocr_revision=? AND item_id=? AND unlinked_at IS NULL
        """,
        (case_id, drawing_id, revision, item_id),
    ).fetchone()


def insert_link(db, store: PurposeStore, *, case_id, drawing_id, revision, item_id, item, source, report_id=None) -> str:
    link_id = f"LNK-{report_id}" if report_id else f"LNK-{uuid4().hex}"
    db.execute(
        f"""
        INSERT INTO {store.link_table}
            (link_id, case_id, drawing_id, ocr_revision, item_id, item_snapshot_json, source, report_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (link_id, case_id, drawing_id, revision, item_id, json.dumps(item, ensure_ascii=False), source, report_id),
    )
    return link_id


def list_point_reports(store: PurposeStore, drawing_id: str, item_id: str, revision: str) -> list[dict]:
    """이 항목에 연결 중인 사례 (작업 화면의 '등록된 오류사례'). 해제된 연결은 빼고, 비활성 사례는 표시만 한다."""
    with database() as db:
        rows = db.execute(
            f"""
            SELECT c.case_id, c.case_title, c.error_description,
                   c.vector_status, c.active, l.created_at
            FROM {store.link_table} l
            JOIN {store.case_table} c ON c.case_id = l.case_id
            WHERE l.drawing_id=? AND l.item_id=? AND l.ocr_revision=? AND l.unlinked_at IS NULL
            ORDER BY l.created_at DESC, l.link_id
            """,
            (drawing_id, item_id, revision),
        ).fetchall()
    return [{**dict(row), "active": bool(row["active"]), "created_at": local_time(row["created_at"])} for row in rows]


def count_cases(store: PurposeStore) -> int:
    with database() as db:
        return db.execute(f"SELECT COUNT(*) FROM {store.case_table}").fetchone()[0]
