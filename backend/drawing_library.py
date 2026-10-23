import sqlite3
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "storage" / "library.sqlite3"

router = APIRouter(prefix="/api", tags=["부품·도면 관리"])


@contextmanager
def database():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_library():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with database() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS parts (
                part_id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS drawings (
                drawing_id TEXT PRIMARY KEY,
                part_id TEXT NOT NULL,
                name TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL UNIQUE,
                media_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                ocr_status TEXT NOT NULL DEFAULT 'not_started',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (part_id) REFERENCES parts(part_id)
            )
        """)

        for table in ("parts", "drawings"):
            columns = {
                row["name"]
                for row in db.execute(
                    f"PRAGMA table_info({table})"
                ).fetchall()
            }

            if "deleted_at" not in columns:
                db.execute(
                    f"ALTER TABLE {table} ADD COLUMN deleted_at TEXT"
                )

        # 처음 시작할 때 기본 부품만 등록
        db.execute(
            "INSERT OR IGNORE INTO parts (part_id, name) VALUES (?, ?)",
            ("part-piston-rod", "피스톤로드"),
        )


class PartCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.get("/parts")
def list_parts():
    with database() as db:
        rows = db.execute("""
            SELECT p.part_id, p.name, p.created_at,
                   COUNT(d.drawing_id) AS drawing_count
            FROM parts p
            LEFT JOIN drawings d
                ON d.part_id = p.part_id
               AND d.deleted_at IS NULL
            WHERE p.deleted_at IS NULL
            GROUP BY p.part_id
            ORDER BY p.created_at, p.part_id
        """).fetchall()
    return {"parts": [dict(row) for row in rows]}


@router.post("/parts", status_code=201)
def create_part(payload: PartCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "부품명을 입력해주세요.")

    part_id = str(uuid4())

    try:
        with database() as db:
            db.execute(
                "INSERT INTO parts (part_id, name) VALUES (?, ?)",
                (part_id, name),
            )
            row = db.execute(
                "SELECT * FROM parts WHERE part_id = ?",
                (part_id,),
            ).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "이미 등록된 부품명입니다.")

    return {**dict(row), "drawing_count": 0}


from fastapi import UploadFile, File
from fastapi.responses import FileResponse


UPLOAD_DIR = BASE_DIR / "storage" / "uploads"
MAX_FILE_SIZE = 20 * 1024 * 1024  # 파일당 20MB

ALLOWED_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".pdf": "application/pdf",
}


@router.get("/parts/{part_id}/drawings")
def list_drawings(part_id: str):
    with database() as db:
        part = db.execute(
            "SELECT part_id FROM parts WHERE part_id = ? AND deleted_at IS NULL",
            (part_id,),
        ).fetchone()

        if part is None:
            raise HTTPException(404, "부품을 찾을 수 없습니다.")

        rows = db.execute(
            """
            SELECT * FROM drawings
            WHERE part_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC, drawing_id
            """,
            (part_id,),
        ).fetchall()

    return {
        "part_id": part_id,
        "drawings": [
            {
                **dict(row),
                "file_url": f"/api/drawings/{row['drawing_id']}/file",
            }
            for row in rows
        ],
    }


@router.post("/parts/{part_id}/drawings", status_code=201)
def upload_drawing(
    part_id: str,
    file: UploadFile = File(...),
):
    saved_path = None

    try:
        with database() as db:
            part = db.execute(
                "SELECT part_id FROM parts WHERE part_id = ? AND deleted_at IS NULL",
                (part_id,),
            ).fetchone()

        if part is None:
            raise HTTPException(404, "부품을 찾을 수 없습니다.")

        # 원본 파일명은 표시용으로만 사용
        filename = (file.filename or "").replace("\\", "/").split("/")[-1]
        extension = Path(filename).suffix.lower()

        if extension not in ALLOWED_TYPES:
            raise HTTPException(
                415, "PNG, JPG, JPEG, PDF 파일만 등록할 수 있습니다."
            )

        drawing_id = str(uuid4())
        stored_filename = drawing_id + extension

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        saved_path = UPLOAD_DIR / stored_filename

        # 한 번에 전체 파일을 메모리에 올리지 않고 저장
        size = 0
        header = b""

        with saved_path.open("xb") as output:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)

                if size > MAX_FILE_SIZE:
                    raise HTTPException(413, "파일은 20MB 이하여야 합니다.")

                if not header:
                    header = chunk[:1024]

                output.write(chunk)

        if size == 0:
            raise HTTPException(422, "빈 파일은 등록할 수 없습니다.")

        # 확장자와 기본 파일 식별 정보 확인
        valid = (
            extension == ".png"
            and header.startswith(b"\x89PNG\r\n\x1a\n")
        ) or (
            extension in {".jpg", ".jpeg"}
            and header.startswith(b"\xff\xd8\xff")
        ) or (
            extension == ".pdf"
            and b"%PDF-" in header
        )

        if not valid:
            raise HTTPException(
                415, "파일 내용이 선택한 이미지·PDF 형식과 맞지 않습니다."
            )

        with database() as db:
            db.execute(
                """
                INSERT INTO drawings (
                    drawing_id, part_id, name,
                    original_filename, stored_filename,
                    media_type, size_bytes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    drawing_id,
                    part_id,
                    Path(filename).stem,
                    filename,
                    stored_filename,
                    ALLOWED_TYPES[extension],
                    size,
                ),
            )

            row = db.execute(
                "SELECT * FROM drawings WHERE drawing_id = ?",
                (drawing_id,),
            ).fetchone()

        return {
            **dict(row),
            "file_url": f"/api/drawings/{drawing_id}/file",
        }

    except Exception:
        # 등록 실패 시 불완전한 파일 정리
        if saved_path is not None:
            saved_path.unlink(missing_ok=True)
        raise

    finally:
        file.file.close()


@router.get("/drawings/{drawing_id}/file")
def get_drawing_file(drawing_id: str):
    with database() as db:
        row = db.execute(
            "SELECT * FROM drawings WHERE drawing_id = ? AND deleted_at IS NULL",
            (drawing_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(404, "도면을 찾을 수 없습니다.")

    path = UPLOAD_DIR / row["stored_filename"]

    if not path.is_file():
        raise HTTPException(404, "도면 파일이 없습니다.")

    return FileResponse(
        path,
        media_type=row["media_type"],
        filename=row["original_filename"],
        content_disposition_type="inline",
    )

def ensure_no_active_ocr(db, drawing_ids):
    if not drawing_ids:
        return

    has_jobs = db.execute("""
        SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='ocr_jobs'
    """).fetchone()

    if not has_jobs:
        return

    for drawing_id in drawing_ids:
        active = db.execute("""
            SELECT 1 FROM ocr_jobs
            WHERE drawing_id=?
              AND status IN ('queued', 'running')
            LIMIT 1
        """, (drawing_id,)).fetchone()

        if active:
            raise HTTPException(
                409,
                "OCR 대기·실행 중인 도면이 있습니다. 완료 후 삭제해주세요.",
            )


@router.delete("/drawings/{drawing_id}")
def delete_drawing(drawing_id: str):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")

        drawing = db.execute("""
            SELECT drawing_id, part_id
            FROM drawings
            WHERE drawing_id=? AND deleted_at IS NULL
        """, (drawing_id,)).fetchone()

        if drawing is None:
            raise HTTPException(404, "등록된 도면을 찾을 수 없습니다.")

        ensure_no_active_ocr(db, [drawing_id])

        db.execute("""
            UPDATE drawings
            SET deleted_at=CURRENT_TIMESTAMP
            WHERE drawing_id=?
        """, (drawing_id,))

    return {
        "deleted": True,
        "drawing_id": drawing_id,
        "part_id": drawing["part_id"],
        "message": "도면을 목록에서 삭제했습니다. 연결 기록은 보관됩니다.",
    }


@router.delete("/parts/{part_id}")
def delete_part(part_id: str):
    with database() as db:
        db.execute("BEGIN IMMEDIATE")

        part = db.execute("""
            SELECT part_id, name
            FROM parts
            WHERE part_id=? AND deleted_at IS NULL
        """, (part_id,)).fetchone()

        if part is None:
            raise HTTPException(404, "등록된 부품을 찾을 수 없습니다.")

        drawings = db.execute("""
            SELECT drawing_id
            FROM drawings
            WHERE part_id=? AND deleted_at IS NULL
        """, (part_id,)).fetchall()

        drawing_ids = [row["drawing_id"] for row in drawings]
        ensure_no_active_ocr(db, drawing_ids)

        db.execute("""
            UPDATE drawings
            SET deleted_at=CURRENT_TIMESTAMP
            WHERE part_id=? AND deleted_at IS NULL
        """, (part_id,))

        db.execute("""
            UPDATE parts
            SET deleted_at=CURRENT_TIMESTAMP
            WHERE part_id=?
        """, (part_id,))

    return {
        "deleted": True,
        "part_id": part_id,
        "drawing_count": len(drawing_ids),
        "message": "부품과 연결 도면을 목록에서 삭제했습니다. 기록은 보관됩니다.",
    }