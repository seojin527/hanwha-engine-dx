"""Registered drawing review: keep CPU OCR metadata, image and revision together.

The TXT workflow in api.py remains available; registered drawings use SQLite so
measurement criteria and error retrieval see the same reviewed document.
"""
import json
import math
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from drawing_library import database
from ocr_results import read_ocr_result

router = APIRouter(prefix='/api/drawings', tags=['OCR 관리자 검토'])
EDITABLE = {'raw_text', 'nominal_value', 'lower_limit', 'upper_limit',
            'feature_type', 'tol_type', 'measurement_characteristic',
            'requires_review', 'coordinate_requires_review', 'review_reasons'}


def init_drawing_reviews():
    with database() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS drawing_reviews (
            review_id TEXT PRIMARY KEY, drawing_id TEXT NOT NULL,
            source_revision TEXT NOT NULL, revision TEXT NOT NULL,
            reviewer TEXT NOT NULL, completed INTEGER NOT NULL,
            changes_json TEXT NOT NULL, before_json TEXT NOT NULL,
            after_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)''')


class DrawingReview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: str = Field(min_length=1, max_length=100)
    reviewer: str = Field(min_length=1, max_length=200)
    edits: dict[str, dict] = Field(default_factory=dict)
    confirmed_ids: list[str] = Field(default_factory=list)
    complete: bool = False


@router.get('/{drawing_id}/ocr/reviews')
def review_history(drawing_id: str):
    snapshot = read_ocr_result(drawing_id)
    with database() as db:
        rows = db.execute('''SELECT review_id, source_revision, revision,
            reviewer, completed, changes_json, created_at FROM drawing_reviews
            WHERE drawing_id=? ORDER BY rowid DESC''', (drawing_id,)).fetchall()
    history = [{**dict(row), 'changes': json.loads(row['changes_json'])} for row in rows]
    for entry in history:
        del entry['changes_json']
    return {'drawing_id': drawing_id, 'revision': snapshot.get('revision'), 'history': history}


@router.post('/{drawing_id}/ocr/review')
def save_review(drawing_id: str, payload: DrawingReview):
    if not payload.reviewer.strip():
        raise HTTPException(422, '검토자 이름을 입력해주세요.')
    # Lock before reading to prevent concurrent reviews/OCR overwriting changes.
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM ocr_results WHERE drawing_id=?', (drawing_id,)).fetchone()
        if row is None or row['revision'] != payload.revision:
            raise HTTPException(409, 'OCR 결과가 변경됐습니다. 다시 불러와주세요.')
        before = json.loads(row['metadata_json'])
        document = json.loads(row['metadata_json'])
        items = {item['id']: item for item in document['items']}
        if (set(payload.edits) | set(payload.confirmed_ids)) - items.keys():
            raise HTTPException(422, '이 도면에 없는 항목입니다.')
        for item_id, edits in payload.edits.items():
            if set(edits) - EDITABLE:
                raise HTTPException(422, '지원하지 않는 수정 필드입니다.')
            item = items[item_id]
            item.update(edits)
            for field in ('nominal_value', 'lower_limit', 'upper_limit'):
                value = item.get(field)
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
                    raise HTTPException(422, '치수와 허용 범위는 유한한 숫자여야 합니다.')
            for field in ('raw_text', 'feature_type', 'tol_type', 'measurement_characteristic'):
                if field in item and (not isinstance(item[field], str) or not item[field].strip()):
                    raise HTTPException(422, '항목 설명과 유형을 확인해주세요.')
            low, high = item.get('lower_limit'), item.get('upper_limit')
            if low is not None and high is not None and low > high:
                raise HTTPException(422, '하한은 상한보다 클 수 없습니다.')
            for field in ('requires_review', 'coordinate_requires_review'):
                if field in item and not isinstance(item[field], bool):
                    raise HTTPException(422, '검토 상태는 참/거짓이어야 합니다.')
            reasons = item.get('review_reasons', [])
            if not isinstance(reasons, list) or any(not isinstance(r, str) for r in reasons):
                raise HTTPException(422, '검토 사유 형식을 확인해주세요.')
        if payload.complete and set(payload.confirmed_ids) != items.keys():
            raise HTTPException(422, '모든 항목을 확인해야 검토를 완료할 수 있습니다.')
        if payload.complete:
            for item in items.values():
                item['requires_review'] = False
                item['coordinate_requires_review'] = False
                item['review_reasons'] = []
        else:
            for item_id in payload.edits:
                items[item_id]['requires_review'] = True
        revision = uuid4().hex
        document['review'] = {'completed': payload.complete, 'reviewer': payload.reviewer.strip()}
        # The image is unchanged, but its URL must use the new metadata revision.
        document['image']['file'] = f'/api/drawings/{drawing_id}/ocr/image?revision={revision}'
        changes = [{'item_id': item['id'], 'before': old, 'after': item}
                   for old, item in zip(before['items'], document['items']) if old != item]
        db.execute('UPDATE ocr_results SET metadata_json=?, revision=?, updated_at=CURRENT_TIMESTAMP WHERE drawing_id=?',
                   (json.dumps(document, ensure_ascii=False, allow_nan=False), revision, drawing_id))
        db.execute('''INSERT INTO drawing_reviews (review_id,drawing_id,source_revision,
            revision,reviewer,completed,changes_json,before_json,after_json)
            VALUES (?,?,?,?,?,?,?,?,?)''', (uuid4().hex, drawing_id, payload.revision,
            revision, payload.reviewer.strip(), payload.complete,
            json.dumps(changes, ensure_ascii=False), row['metadata_json'],
            json.dumps(document, ensure_ascii=False)))
    return read_ocr_result(drawing_id)
