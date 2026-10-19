"""OCR 결과 저장·검증. 추출 모델과 UI에 독립적인 도면별 결과 저장소."""
import json
import math
import struct
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from drawing_library import BASE_DIR, database

DATA_DIR = BASE_DIR.parent / 'data'
RESULT_DIR = BASE_DIR / 'storage' / 'ocr_results'


def init_ocr_results():
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    with database() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS ocr_results (
            drawing_id TEXT PRIMARY KEY REFERENCES drawings(drawing_id),
            metadata_json TEXT NOT NULL,
            image_filename TEXT NOT NULL,
            revision TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )''')


def drawing_exists(drawing_id):
    with database() as db:
        row = db.execute('SELECT * FROM drawings WHERE drawing_id = ?', (drawing_id,)).fetchone()
    if row is None:
        raise HTTPException(404, '등록된 도면을 찾을 수 없습니다.')
    return dict(row)


def validate_metadata(payload, png):
    """팀원 형식을 보존하며 항목 식별·좌표·이미지 크기를 검증한다."""
    if len(png) < 24 or png[:8] != b'\x89PNG\r\n\x1a\n' or png[12:16] != b'IHDR':
        raise ValueError('OCR 결과 이미지가 PNG 형식이 아닙니다.')
    width, height = struct.unpack('>II', png[16:24])
    if not isinstance(payload, dict) or not isinstance(payload.get('image'), dict):
        raise ValueError('메타데이터의 image 정보가 없습니다.')
    image = payload['image']
    if image.get('width_px') != width or image.get('height_px') != height:
        raise ValueError('JSON의 이미지 크기와 결과 PNG 크기가 다릅니다.')
    if image.get('coordinate_origin') != 'top-left':
        raise ValueError('좌표 원점은 top-left여야 합니다.')
    items = payload.get('items')
    if not isinstance(items, list) or not items:
        raise ValueError('items에 추출 항목이 없습니다.')
    ids = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('잘못된 항목 형식입니다.')
        iid = item.get('id')
        if not isinstance(iid, str) or not iid or iid in ids:
            raise ValueError('항목 id가 없거나 중복됩니다.')
        ids.add(iid)
        if not isinstance(item.get('raw_text'), str):
            raise ValueError(f'{iid}: raw_text가 없습니다.')
        position = item.get('position') or {}
        x, y = position.get('x'), position.get('y')
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in (x, y)):
            raise ValueError(f'{iid}: 유효한 좌표가 필요합니다.')
        if not (0 <= x < width and 0 <= y < height):
            raise ValueError(f'{iid}: 이미지 범위 밖 좌표입니다.')
    return payload


def save_ocr_result(drawing_id, payload, png):
    """향후 실제 OCR 실행기에서도 이 함수를 호출한다. 완료 후에만 결과를 교체한다."""
    drawing_exists(drawing_id)
    validate_metadata(payload, png)
    revision = uuid4().hex
    filename = revision + '.png'
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULT_DIR / filename
    # 원본 파일명/도면은 보존하고 OCR 결과는 별도 저장한다.
    document = json.loads(json.dumps(payload, ensure_ascii=False, allow_nan=False))
    document['source_drawing_id'] = payload.get('drawing_id')
    document['drawing_id'] = drawing_id
    document['item_count'] = len(document['items'])
    document['image']['file'] = f'/api/drawings/{drawing_id}/ocr/image?revision={revision}'
    try:
        path.write_bytes(png)
        with database() as db:
            db.execute('''INSERT INTO ocr_results (drawing_id, metadata_json, image_filename, revision)
                VALUES (?, ?, ?, ?) ON CONFLICT(drawing_id) DO UPDATE SET
                metadata_json=excluded.metadata_json, image_filename=excluded.image_filename,
                revision=excluded.revision, updated_at=CURRENT_TIMESTAMP''',
                (drawing_id, json.dumps(document, ensure_ascii=False), filename, revision))
            db.execute("UPDATE drawings SET ocr_status='completed' WHERE drawing_id=?", (drawing_id,))
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return read_ocr_result(drawing_id)


def read_ocr_result(drawing_id):
    drawing_exists(drawing_id)
    with database() as db:
        row = db.execute('SELECT * FROM ocr_results WHERE drawing_id=?', (drawing_id,)).fetchone()
    if row is None:
        return {'drawing_id': drawing_id, 'status': 'not_started', 'result': None}
    return {'drawing_id': drawing_id, 'status': 'completed', 'revision': row['revision'],
            'image_url': f"/api/drawings/{drawing_id}/ocr/image?revision={row['revision']}",
            'result': json.loads(row['metadata_json'])}


def get_result_image(drawing_id, revision=None):
    drawing_exists(drawing_id)
    with database() as db:
        row = db.execute('SELECT image_filename, revision FROM ocr_results WHERE drawing_id=?', (drawing_id,)).fetchone()
    if row is None or (revision is not None and revision != row['revision']):
        raise HTTPException(404, '현재 도면에 해당하는 OCR 이미지가 없습니다. 도면을 다시 선택해주세요.')
    path = RESULT_DIR / row['image_filename']
    if not path.is_file():
        raise HTTPException(404, 'OCR 결과 PNG가 없습니다.')
    return path
