import os
import shutil
import sqlite3
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


from paths import BACKEND_DIR as BASE_DIR, LIBRARY_DB, THUMBNAIL_DIR, UPLOAD_DIR as _UPLOAD_DIR

DB_PATH = LIBRARY_DB

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

        # 3D 엔진 모델의 부품 종류(engine-viewer PARTS 의 key)와 등록 부품의 연결.
        # 관리자가 명시적으로 지정한 값만 쓴다. 기존 부품은 비어 있다 (이름으로 추정해 채우지 않음).
        part_columns = {row["name"] for row in db.execute("PRAGMA table_info(parts)").fetchall()}
        if "engine_part_key" not in part_columns:
            db.execute("ALTER TABLE parts ADD COLUMN engine_part_key TEXT")

        # 도면 소속 부품 변경 기록 (누가 했는지는 서버 인증이 없어 남기지 않는다)
        db.execute("""
            CREATE TABLE IF NOT EXISTS drawing_part_moves (
                move_id INTEGER PRIMARY KEY AUTOINCREMENT,
                drawing_id TEXT NOT NULL REFERENCES drawings(drawing_id),
                from_part_id TEXT NOT NULL,
                to_part_id TEXT NOT NULL,
                moved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 처음 시작할 때(부품이 하나도 없을 때)만 기본 부품을 등록한다.
        # 관리자가 지운 기본 부품을 재시작 때마다 되살리지 않는다.
        if db.execute("SELECT 1 FROM parts LIMIT 1").fetchone() is None:
            db.execute(
                "INSERT INTO parts (part_id, name) VALUES (?, ?)",
                ("part-piston-rod", "피스톤로드"),
            )


class PartCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    engine_part_key: str | None = None


# 3D 엔진 모델(frontend/public/engine-viewer/index.html 의 PARTS)에 있는 부품 종류
ENGINE_PART_KEYS = {"CS", "CR", "CH", "PR", "PH"}


def _check_engine_key(value):
    if value is not None and value not in ENGINE_PART_KEYS:
        raise HTTPException(422, f"3D 모델에 없는 부품 종류입니다: {value}")
    return value


class EnginePartLink(BaseModel):
    engine_part_key: str | None = None


@router.get("/parts")
def list_parts():
    with database() as db:
        rows = db.execute("""
            SELECT p.part_id, p.name, p.created_at, p.engine_part_key,
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
    engine_key = _check_engine_key(payload.engine_part_key)

    try:
        with database() as db:
            db.execute(
                "INSERT INTO parts (part_id, name, engine_part_key) VALUES (?, ?, ?)",
                (part_id, name, engine_key),
            )
            row = db.execute(
                "SELECT * FROM parts WHERE part_id = ?",
                (part_id,),
            ).fetchone()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "이미 등록된 부품명입니다.")

    return {**dict(row), "drawing_count": 0}


@router.put("/parts/{part_id}/engine-part")
def link_engine_part(part_id: str, payload: EnginePartLink):
    """등록 부품을 3D 모델의 부품 종류에 연결하거나(null 이면) 연결을 해제한다. 화면에서는 관리자만 쓴다."""
    engine_key = _check_engine_key(payload.engine_part_key)
    with database() as db:
        row = db.execute(
            "SELECT part_id FROM parts WHERE part_id = ? AND deleted_at IS NULL", (part_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "부품을 찾을 수 없습니다.")
        db.execute("UPDATE parts SET engine_part_key = ? WHERE part_id = ?", (engine_key, part_id))
        row = db.execute(
            """
            SELECT p.part_id, p.name, p.created_at, p.engine_part_key,
                   (SELECT COUNT(*) FROM drawings d WHERE d.part_id = p.part_id AND d.deleted_at IS NULL) AS drawing_count
            FROM parts p WHERE p.part_id = ?
            """,
            (part_id,),
        ).fetchone()
    return dict(row)


from fastapi import UploadFile, File
from fastapi.responses import FileResponse


UPLOAD_DIR = _UPLOAD_DIR
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

        # 도면 비교용: OCR 결과 버전과 관리자 검토 상태 (OCR 결과가 없으면 null)
        has_ocr = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ocr_results'"
        ).fetchone()
        review_columns = (
            ", o.revision AS ocr_revision, json_extract(o.metadata_json, '$.review_status') AS review_status"
            if has_ocr else ", NULL AS ocr_revision, NULL AS review_status"
        )
        review_join = "LEFT JOIN ocr_results o ON o.drawing_id = d.drawing_id" if has_ocr else ""
        rows = db.execute(
            f"""
            SELECT d.*{review_columns} FROM drawings d
            {review_join}
            WHERE d.part_id = ? AND d.deleted_at IS NULL
            ORDER BY d.created_at DESC, d.drawing_id
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


# --------------------------------------------------------------------------- 도면 소속 부품 변경
# 도면은 drawings.part_id 한 열로 부품에 속한다. 파일은 drawing_id 이름으로 한 폴더에 있어 옮길 필요가 없고,
# OCR 결과·관리자 검토·측정·가공 단계 기록·오류사례 연결은 모두 drawing_id 로 연결돼 그대로 남는다.
# 부품 '이름'을 쓰는 기능(가공 단계 템플릿, 오류사례 추천 범위, 새 오류사례의 부품명)은 이동 뒤 새 부품 기준이 된다.

def _table_exists(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _count(db, table, drawing_id, extra=""):
    if not _table_exists(db, table):
        return 0
    return db.execute(f"SELECT COUNT(*) FROM {table} WHERE drawing_id=? {extra}", (drawing_id,)).fetchone()[0]


def _move_target(db, drawing_id, part_id):
    drawing = db.execute(
        "SELECT * FROM drawings WHERE drawing_id = ? AND deleted_at IS NULL", (drawing_id,)
    ).fetchone()
    if drawing is None:
        raise HTTPException(404, "도면을 찾을 수 없습니다.")
    target = db.execute(
        "SELECT * FROM parts WHERE part_id = ? AND deleted_at IS NULL", (part_id,)
    ).fetchone()
    if target is None:
        raise HTTPException(404, "옮길 부품을 찾을 수 없습니다.")
    source = db.execute("SELECT * FROM parts WHERE part_id = ?", (drawing["part_id"],)).fetchone()
    return drawing, source, target


@router.get("/drawings/{drawing_id}/part-move-impact")
def part_move_impact(drawing_id: str, to_part_id: str):
    """소속 부품을 바꾸면 무엇이 그대로이고 무엇이 달라지는지. 아무것도 바꾸지 않는다."""
    from machining_templates import TEMPLATES, part_key_for

    with database() as db:
        drawing, source, target = _move_target(db, drawing_id, to_part_id)
        title_name = ""
        review_status = None
        if _table_exists(db, "ocr_results"):
            row = db.execute(
                "SELECT json_extract(metadata_json, '$.part_name') AS part_name, "
                "json_extract(metadata_json, '$.review_status') AS review_status FROM ocr_results WHERE drawing_id=?",
                (drawing_id,),
            ).fetchone()
            if row:
                title_name, review_status = row["part_name"] or "", row["review_status"]
        kept = {
            "measurements": _count(db, "measurement_records", drawing_id),
            "machining_records": _count(db, "machining_stage_records", drawing_id),
            "error_case_links": sum(
                _count(db, f"{purpose}_case_links", drawing_id, "AND unlinked_at IS NULL")
                for purpose in ("manufacturing", "assembly", "verification")
            ),
        }

    old_key = part_key_for(source["name"] if source else "", title_name)
    new_key = part_key_for(target["name"], title_name)
    template_label = lambda key: TEMPLATES[key]["label"] if key in TEMPLATES else "템플릿 없음 (모든 항목 정삭 측정)"  # noqa: E731
    changes = []
    if old_key != new_key:
        changes.append(
            f"가공 단계(황삭·중삭·정삭) 기준이 바뀝니다: {template_label(old_key)} → {template_label(new_key)}. "
            f"이미 저장된 단계 기록 {kept['machining_records']}건은 남지만 단계 구분이 새 기준으로 다시 계산됩니다."
        )
    if (source["name"] if source else "") != target["name"]:
        changes.append(
            f"오류사례 자동 추천의 부품 범위가 '{source['name'] if source else '-'}' 대신 '{target['name']}' 기준이 됩니다. "
            "이미 등록된 오류사례의 부품명은 바뀌지 않습니다."
        )
    return {
        "drawing_id": drawing_id,
        "from_part": {"part_id": drawing["part_id"], "name": source["name"] if source else None},
        "to_part": {"part_id": target["part_id"], "name": target["name"]},
        "same_part": drawing["part_id"] == target["part_id"],
        "review_status": review_status,
        "kept": kept,
        "changes": changes,
        "needs_confirmation": bool(changes),
    }


class DrawingMove(BaseModel):
    part_id: str = Field(min_length=1)
    # 화면이 보고 있던 현재 소속. 그 사이 다른 곳에서 바뀌었으면 거부한다.
    expected_part_id: str = Field(min_length=1)


@router.put("/drawings/{drawing_id}/part")
def move_drawing(drawing_id: str, payload: DrawingMove):
    """도면의 소속 부품을 바꾼다 (drawings.part_id). 측정·검토·OCR·오류사례 기록은 drawing_id 로 그대로 연결된다.
    작업 상태(OCR·검토·측정 진행)는 바꾸지 않는다. 화면에서는 관리자만 쓴다 (서버 인증은 없음)."""
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        drawing, source, target = _move_target(db, drawing_id, payload.part_id)
        if drawing["part_id"] != payload.expected_part_id:
            raise HTTPException(409, "다른 곳에서 이 도면의 소속이 이미 바뀌었습니다. 목록을 새로 고친 뒤 다시 시도해주세요.")
        if drawing["part_id"] == target["part_id"]:
            return {"changed": False, "drawing": {**dict(drawing), "file_url": f"/api/drawings/{drawing_id}/file"}}
        db.execute("UPDATE drawings SET part_id = ? WHERE drawing_id = ?", (target["part_id"], drawing_id))
        db.execute(
            "INSERT INTO drawing_part_moves (drawing_id, from_part_id, to_part_id) VALUES (?, ?, ?)",
            (drawing_id, drawing["part_id"], target["part_id"]),
        )
        row = db.execute("SELECT * FROM drawings WHERE drawing_id = ?", (drawing_id,)).fetchone()
    return {
        "changed": True,
        "from_part_id": drawing["part_id"],
        "drawing": {**dict(row), "file_url": f"/api/drawings/{drawing_id}/file"},
    }


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

# --------------------------------------------------------------------------- 미리보기 (썸네일)
# 저장된 원본의 첫 페이지를 작은 PNG 로 만들어 캐시한다. OCR 은 실행하지 않는다.
# PDF 는 poppler 의 pdftoppm, 이미지는 Pillow 로 줄인다. 원본은 바뀌지 않으므로(도면 ID 별 파일) 한 번 만들면 다시 쓴다.
THUMBNAIL_WIDTH = {"sm": 360, "lg": 1400}
_thumbnail_slots = threading.BoundedSemaphore(2)  # 2GB 서버: 동시에 렌더링하는 수를 제한


def _pdftoppm() -> str | None:
    poppler = os.environ.get("OCR_POPPLER")
    if poppler:
        for name in ("pdftoppm", "pdftoppm.exe"):
            candidate = Path(poppler) / name
            if candidate.is_file():
                return str(candidate)
    return shutil.which("pdftoppm")


def _render_thumbnail(source: Path, media_type: str, width: int, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.stem}.{uuid4().hex}.tmp.png")
    try:
        if media_type == "application/pdf":
            tool = _pdftoppm()
            if not tool:
                raise HTTPException(503, "PDF 미리보기 도구(poppler)가 없어 미리보기를 만들 수 없습니다.")
            subprocess.run(
                [tool, "-png", "-f", "1", "-l", "1", "-singlefile", "-scale-to-x", str(width), "-scale-to-y", "-1",
                 str(source), str(temporary.with_suffix(""))],
                check=True, capture_output=True, timeout=60,
            )
        else:
            from PIL import Image

            with Image.open(source) as image:
                image.thumbnail((width, width * 4))
                image.convert("RGB").save(temporary, "PNG")
        temporary.replace(target)
    except subprocess.CalledProcessError as error:
        raise HTTPException(422, "도면 첫 페이지를 미리보기로 만들지 못했습니다.") from error
    finally:
        temporary.unlink(missing_ok=True)


@router.get("/drawings/{drawing_id}/thumbnail")
def get_drawing_thumbnail(drawing_id: str, size: str = "sm"):
    if size not in THUMBNAIL_WIDTH:
        raise HTTPException(422, "size 는 sm 또는 lg 입니다.")
    with database() as db:
        row = db.execute(
            "SELECT * FROM drawings WHERE drawing_id = ? AND deleted_at IS NULL", (drawing_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "도면을 찾을 수 없습니다.")
    source = UPLOAD_DIR / row["stored_filename"]
    if not source.is_file():
        raise HTTPException(404, "도면 파일이 없습니다.")
    target = THUMBNAIL_DIR / f"{drawing_id}_{size}.png"
    if not target.is_file():
        with _thumbnail_slots:
            if not target.is_file():
                _render_thumbnail(source, row["media_type"], THUMBNAIL_WIDTH[size], target)
    return FileResponse(target, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/drawings/{drawing_id}/delete-impact")
def drawing_delete_impact(drawing_id: str):
    """삭제 확인창에 보여줄 영향. 삭제는 목록에서 숨기는 소프트 삭제이고 기록은 지우지 않는다."""
    with database() as db:
        row = db.execute(
            "SELECT * FROM drawings WHERE drawing_id = ? AND deleted_at IS NULL", (drawing_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "도면을 찾을 수 없습니다.")
        review = None
        if _table_exists(db, "ocr_results"):
            result = db.execute(
                "SELECT json_extract(metadata_json, '$.review_status') FROM ocr_results WHERE drawing_id = ?",
                (drawing_id,),
            ).fetchone()
            review = None if result is None else (result[0] or "unreviewed")
        links = sum(
            _count(db, table, drawing_id, "AND unlinked_at IS NULL")
            for table in ("manufacturing_case_links", "assembly_case_links", "verification_case_links")
        )
        measurements = _count(db, "measurement_records", drawing_id) + _count(db, "machining_stage_records", drawing_id)
        active = db.execute(
            "SELECT 1 FROM ocr_jobs WHERE drawing_id = ? AND status IN ('queued','running')", (drawing_id,)
        ).fetchone() if _table_exists(db, "ocr_jobs") else None
    return {
        "drawing_id": drawing_id,
        "filename": row["original_filename"] or row["name"],
        "has_ocr": review is not None,
        "review_status": review,
        "measurement_records": measurements,
        "case_links": links,
        "ocr_active": bool(active),
    }


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