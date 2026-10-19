"""실측값 저장. 도면·OCR 버전·항목별로 분리하며 판정은 서버에서 계산한다."""
import json
import math
import re
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from drawing_library import database
from ocr_results import read_ocr_result

router = APIRouter(prefix='/api/drawings', tags=['실측값'])


def init_measurements():
    with database() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS measurement_records (
            drawing_id TEXT NOT NULL REFERENCES drawings(drawing_id),
            ocr_revision TEXT NOT NULL,
            item_id TEXT NOT NULL,
            measured_value TEXT NOT NULL,
            instrument TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            judgement TEXT NOT NULL CHECK(judgement IN ('pass','fail','review')),
            judgement_reason TEXT NOT NULL,
            item_snapshot_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (drawing_id, ocr_revision, item_id)
        )''')


class MeasurementInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: str = Field(min_length=1, max_length=100)
    measured_value: str = Field(min_length=1, max_length=100)
    instrument: str = Field(default='', max_length=200)
    note: str = Field(default='', max_length=5000)


def current_snapshot(drawing_id, revision):
    snapshot = read_ocr_result(drawing_id)
    if snapshot['result'] is None:
        raise HTTPException(409, 'OCR 결과가 없습니다.')
    if snapshot['revision'] != revision:
        raise HTTPException(409, 'OCR 결과가 변경됐습니다. 도면을 다시 선택해주세요.')
    return snapshot


def judge(item, value):
    # 기하공차·나사 등은 숫자 하나만으로 적합 판정을 하지 않는다.
    if item.get('category') != 'DIMENSION' or item.get('tol_type') != 'DIMENSION':
        return 'review', '이 검사 유형은 실측값 하나로 자동 판정하지 않습니다.'
    if item.get('requires_review') is not False or item.get('coordinate_requires_review'):
        return 'review', 'OCR·형상 해석 검토가 필요한 항목입니다.'
    if not item.get('feature_type') or item['feature_type'] == 'UNKNOWN':
        return 'review', '측정 형상이 확정되지 않았습니다.'
    low, high = item.get('lower_limit'), item.get('upper_limit')
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (low, high)):
        return 'review', '유효한 상한·하한 기준이 없습니다.'
    if low > high:
        return 'review', '상한·하한 기준을 확인해주세요.'
    inside = Decimal(str(low)) <= value <= Decimal(str(high))
    return ('pass', '저장된 허용 범위 이내입니다.') if inside else ('fail', '저장된 허용 범위를 벗어났습니다.')


@router.get('/{drawing_id}/measurements')
def list_measurements(drawing_id: str, revision: str):
    current_snapshot(drawing_id, revision)
    with database() as db:
        rows = db.execute('''SELECT item_id, measured_value, instrument, note,
            judgement, judgement_reason, updated_at FROM measurement_records
            WHERE drawing_id=? AND ocr_revision=?''', (drawing_id, revision)).fetchall()
    return {'drawing_id': drawing_id, 'revision': revision, 'records': [dict(r) for r in rows]}


@router.post('/{drawing_id}/items/{item_id}/measurement')
def save_measurement(drawing_id: str, item_id: str, payload: MeasurementInput):
    snapshot = current_snapshot(drawing_id, payload.revision)
    item = next((i for i in snapshot['result']['items'] if i['id'] == item_id), None)
    if item is None:
        raise HTTPException(404, '이 도면의 항목이 아닙니다.')
    try:
        if not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", payload.measured_value.strip()):
            raise InvalidOperation
        value = Decimal(payload.measured_value.strip())
        if not value.is_finite():
            raise InvalidOperation
    except InvalidOperation:
        raise HTTPException(422, '실측값에는 유효한 숫자를 입력해주세요.')
    status, reason = judge(item, value)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        current = db.execute('SELECT revision FROM ocr_results WHERE drawing_id=?', (drawing_id,)).fetchone()
        if current is None or current['revision'] != payload.revision:
            raise HTTPException(409, '저장 중 OCR 결과가 변경됐습니다.')
        db.execute('''INSERT INTO measurement_records (
            drawing_id, ocr_revision, item_id, measured_value, instrument, note,
            judgement, judgement_reason, item_snapshot_json) VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(drawing_id, ocr_revision, item_id) DO UPDATE SET
            measured_value=excluded.measured_value, instrument=excluded.instrument,
            note=excluded.note, judgement=excluded.judgement,
            judgement_reason=excluded.judgement_reason,
            item_snapshot_json=excluded.item_snapshot_json, updated_at=CURRENT_TIMESTAMP''',
            (drawing_id, payload.revision, item_id, payload.measured_value.strip(),
             payload.instrument.strip(), payload.note.strip(), status, reason,
             json.dumps(item, ensure_ascii=False)))
    return {'drawing_id': drawing_id, 'revision': payload.revision, 'item_id': item_id,
            'measured_value': payload.measured_value.strip(), 'instrument': payload.instrument.strip(),
            'note': payload.note.strip(), 'judgement': status, 'judgement_reason': reason}
