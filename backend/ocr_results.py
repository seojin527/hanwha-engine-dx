"""도면별 OCR 결과 저장·조회. 새 결과 이미지는 JPG로 저장한다."""

import io
import json
import math
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image

from drawing_library import BASE_DIR, database


from paths import DATA_DIR, OCR_RESULT_DIR as RESULT_DIR


def init_ocr_results():
    RESULT_DIR.mkdir(parents=True, exist_ok=True)

    with database() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS ocr_results (
                drawing_id TEXT PRIMARY KEY REFERENCES drawings(drawing_id),
                metadata_json TEXT NOT NULL,
                image_filename TEXT NOT NULL,
                revision TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


def drawing_exists(drawing_id):
    with database() as db:
        row = db.execute(
            "SELECT * FROM drawings WHERE drawing_id = ?",
            (drawing_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(404, "등록된 도면을 찾을 수 없습니다.")

    return dict(row)


def validate_metadata(payload, image_bytes):
    """JPG의 실제 크기와 JSON의 항목·좌표를 검증한다."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            if image.format != "JPEG":
                raise ValueError("OCR 결과 이미지는 JPG 형식이어야 합니다.")

            width, height = image.size
            image.load()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("유효한 JPG 이미지를 읽을 수 없습니다.") from exc

    if not isinstance(payload, dict):
        raise ValueError("메타데이터는 JSON 객체여야 합니다.")

    image_info = payload.get("image")
    if not isinstance(image_info, dict):
        raise ValueError("메타데이터의 image 정보가 없습니다.")

    if (
        image_info.get("width_px") != width
        or image_info.get("height_px") != height
    ):
        raise ValueError("JSON의 이미지 크기와 결과 JPG 크기가 다릅니다.")

    if image_info.get("coordinate_origin") != "top-left":
        raise ValueError("좌표 원점은 top-left여야 합니다.")

    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items에 추출 항목이 없습니다.")

    ids = set()

    for item in items:
        if not isinstance(item, dict):
            raise ValueError("잘못된 항목 형식입니다.")

        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id or item_id in ids:
            raise ValueError("항목 id가 없거나 중복됩니다.")

        ids.add(item_id)

        if not isinstance(item.get("raw_text"), str):
            raise ValueError(f"{item_id}: raw_text가 없습니다.")

        position = item.get("position")
        if not isinstance(position, dict):
            raise ValueError(f"{item_id}: position 정보가 없습니다.")

        x = position.get("x")
        y = position.get("y")

        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            for value in (x, y)
        ):
            raise ValueError(f"{item_id}: 유효한 좌표가 필요합니다.")

        if not (0 <= x < width and 0 <= y < height):
            raise ValueError(f"{item_id}: 이미지 범위 밖 좌표입니다.")

    return payload


def save_ocr_result(drawing_id, payload, image_bytes):
    """원본 도면은 보존하고 JSON과 JPG 결과를 연결해 저장한다."""
    drawing_exists(drawing_id)
    validate_metadata(payload, image_bytes)

    revision = uuid4().hex
    filename = f"{revision}.jpg"

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULT_DIR / filename

    document = json.loads(
        json.dumps(payload, ensure_ascii=False, allow_nan=False)
    )
    document["source_drawing_id"] = payload.get(
        "source_drawing_id", payload.get("drawing_id")
    )
    document["drawing_id"] = drawing_id
    document["item_count"] = len(document["items"])
    document["image"]["file"] = (
        f"/api/drawings/{drawing_id}/ocr/image?revision={revision}"
    )

    try:
        path.write_bytes(image_bytes)

        with database() as db:
            db.execute(
                """
                INSERT INTO ocr_results (
                    drawing_id, metadata_json, image_filename, revision
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(drawing_id) DO UPDATE SET
                    metadata_json = excluded.metadata_json,
                    image_filename = excluded.image_filename,
                    revision = excluded.revision,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    drawing_id,
                    json.dumps(document, ensure_ascii=False),
                    filename,
                    revision,
                ),
            )
            db.execute(
                "UPDATE drawings SET ocr_status = 'completed' "
                "WHERE drawing_id = ?",
                (drawing_id,),
            )

    except Exception:
        path.unlink(missing_ok=True)
        raise

    return read_ocr_result(drawing_id)


def read_ocr_result(drawing_id):
    drawing_exists(drawing_id)

    with database() as db:
        row = db.execute(
            "SELECT * FROM ocr_results WHERE drawing_id = ?",
            (drawing_id,),
        ).fetchone()

    if row is None:
        return {
            "drawing_id": drawing_id,
            "status": "not_started",
            "result": None,
        }

    return {
        "drawing_id": drawing_id,
        "status": "completed",
        "revision": row["revision"],
        "image_url": (
            f"/api/drawings/{drawing_id}/ocr/image"
            f"?revision={row['revision']}"
        ),
        "result": json.loads(row["metadata_json"]),
    }


def get_result_image(drawing_id, revision=None):
    drawing_exists(drawing_id)

    with database() as db:
        row = db.execute(
            "SELECT image_filename, revision FROM ocr_results "
            "WHERE drawing_id = ?",
            (drawing_id,),
        ).fetchone()

    if row is None or (
        revision is not None and revision != row["revision"]
    ):
        raise HTTPException(
            404,
            "현재 도면에 해당하는 OCR 이미지가 없습니다. "
            "도면을 다시 선택해주세요.",
        )

    path = RESULT_DIR / row["image_filename"]

    if not path.is_file():
        raise HTTPException(404, "OCR 결과 이미지가 없습니다.")

    return path


def save_reviewed_items(
    drawing_id, items, expected_revision, reviewer="", review_record=None
):
    """검수한 항목을 저장한다. 검수·수치 변환이 끝난 항목만 전달한다."""
    snapshot = read_ocr_result(drawing_id)

    if snapshot["result"] is None:
        raise HTTPException(409, "검수할 OCR 결과가 없습니다.")

    if snapshot["revision"] != expected_revision:
        raise HTTPException(
            409, "OCR 결과가 변경됐습니다. 새로 불러온 뒤 검수해주세요."
        )

    # 기존 도면 정보는 보존하고 항목 목록만 교체한다.
    document = json.loads(json.dumps(snapshot["result"], ensure_ascii=False))
    document["items"] = items
    document["item_count"] = len(items)

    image_path = get_result_image(drawing_id, expected_revision)

    try:
        # 기존 JPG와 항목 ID·좌표·이미지 크기가 맞는지 확인한다.
        validate_metadata(document, image_path.read_bytes())
        document = json.loads(
            json.dumps(document, ensure_ascii=False, allow_nan=False)
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc

    revision = uuid4().hex
    document["review_status"] = "reviewed"
    document["reviewer"] = reviewer

    if review_record is not None:
        document["reviewed_txt"] = review_record["reviewed_txt"]
        history = list(document.get("review_history") or [])
        history.append({
            "previous_revision": expected_revision,
            "revision": revision,
            "log": review_record["log"],
        })
        document["review_history"] = history
        
    document["image"]["file"] = (
        f"/api/drawings/{drawing_id}/ocr/image?revision={revision}"
    )

    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        cursor = db.execute(
            """
            UPDATE ocr_results
            SET metadata_json = ?,
                revision = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE drawing_id = ? AND revision = ?
            """,
            (
                json.dumps(document, ensure_ascii=False, allow_nan=False),
                revision,
                drawing_id,
                expected_revision,
            ),
        )
        if cursor.rowcount != 1:
            raise HTTPException(
                409, "저장 중 OCR 결과가 변경됐습니다. 다시 불러와주세요."
            )

    return read_ocr_result(drawing_id)