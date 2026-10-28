"""실측값 저장. 도면·OCR 버전·작업 목적·항목별로 분리하며 판정은 서버에서 계산한다."""
import json
import math
import re
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from drawing_library import database
from ocr_results import read_ocr_result
from typing import Literal


router = APIRouter(prefix='/api/drawings', tags=['실측값'])


# 작업 목적. 측정 기록·이력은 목적마다 따로 저장·조회한다.
WORK_PURPOSES = ('manufacturing', 'assembly', 'verification')
WorkPurpose = Literal['manufacturing', 'assembly', 'verification']
# 목적 구분 전에 저장된 기존 기록. 화면 조회에는 나오지 않으며 tools/assign_measurement_purpose.py 로 옮긴다.
UNCLASSIFIED = 'unclassified'
_PURPOSE_CHECK = "work_purpose IN ('manufacturing','assembly','verification','unclassified')"

RECORD_TABLE_SQL = f'''CREATE TABLE IF NOT EXISTS {{name}} (
            drawing_id TEXT NOT NULL REFERENCES drawings(drawing_id),
            ocr_revision TEXT NOT NULL,
            work_purpose TEXT NOT NULL CHECK({_PURPOSE_CHECK}),
            item_id TEXT NOT NULL,
            measured_value TEXT NOT NULL,
            instrument TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            judgement TEXT NOT NULL CHECK(judgement IN ('pass','fail','review')),
            judgement_reason TEXT NOT NULL,
            item_snapshot_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            measurement_mode TEXT NOT NULL DEFAULT 'numeric',
            gauge_result TEXT,
            confirmed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (drawing_id, ocr_revision, work_purpose, item_id)
        )'''


def _columns(db, table):
    return {row['name'] for row in db.execute(f'PRAGMA table_info({table})').fetchall()}


def init_measurements():
    with database() as db:
        exists = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='measurement_records'"
        ).fetchone()

        if not exists:
            db.execute(RECORD_TABLE_SQL.format(name='measurement_records'))
        elif 'work_purpose' not in _columns(db, 'measurement_records'):
            _migrate_records_to_purpose(db)

        db.execute('''CREATE TABLE IF NOT EXISTS measurement_attempts (
            attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
            drawing_id TEXT NOT NULL,
            ocr_revision TEXT NOT NULL,
            item_id TEXT NOT NULL,
            record_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            work_purpose TEXT NOT NULL DEFAULT 'unclassified' CHECK(''' + _PURPOSE_CHECK + ''')
        )''')
        if 'work_purpose' not in _columns(db, 'measurement_attempts'):
            # 기존 이력은 목적을 알 수 없으므로 미분류로 남긴다.
            db.execute(
                "ALTER TABLE measurement_attempts ADD COLUMN work_purpose TEXT NOT NULL "
                f"DEFAULT '{UNCLASSIFIED}' CHECK({_PURPOSE_CHECK})"
            )
        db.execute('''CREATE INDEX IF NOT EXISTS measurement_attempts_lookup
            ON measurement_attempts (drawing_id, ocr_revision, work_purpose, item_id)''')


def _migrate_records_to_purpose(db):
    """목적 열이 없는 이전 measurement_records 를 새 구조로 옮긴다.

    기본키에 목적을 넣어야 해서 표를 새로 만들어 복사한다. 기존 행은 삭제·복제하지 않고
    work_purpose='unclassified' 로 한 번만 옮긴다. 하나의 트랜잭션에서 건수를 확인한 뒤 바꾼다.
    """
    old_columns = _columns(db, 'measurement_records')
    for name, definition in {
        'measurement_mode': "TEXT NOT NULL DEFAULT 'numeric'",
        'gauge_result': 'TEXT',
        'confirmed': 'INTEGER NOT NULL DEFAULT 0',
    }.items():
        if name not in old_columns:
            db.execute(f'ALTER TABLE measurement_records ADD COLUMN {name} {definition}')

    copied = ('drawing_id', 'ocr_revision', 'item_id', 'measured_value', 'instrument', 'note',
              'judgement', 'judgement_reason', 'item_snapshot_json', 'updated_at',
              'measurement_mode', 'gauge_result', 'confirmed')
    columns = ', '.join(copied)

    db.execute('BEGIN IMMEDIATE')
    before = db.execute('SELECT COUNT(*) FROM measurement_records').fetchone()[0]
    db.execute('DROP TABLE IF EXISTS measurement_records_purpose_new')
    db.execute(RECORD_TABLE_SQL.format(name='measurement_records_purpose_new'))
    db.execute(
        f'INSERT INTO measurement_records_purpose_new ({columns}, work_purpose) '
        f"SELECT {columns}, '{UNCLASSIFIED}' FROM measurement_records"
    )
    after = db.execute('SELECT COUNT(*) FROM measurement_records_purpose_new').fetchone()[0]
    if after != before:
        db.execute('ROLLBACK')
        raise RuntimeError(f'측정 기록 이전 중 건수가 달라 중단했습니다 ({before} → {after}).')
    db.execute('DROP TABLE measurement_records')
    db.execute('ALTER TABLE measurement_records_purpose_new RENAME TO measurement_records')
    db.execute('COMMIT')


class MeasurementInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    revision: str = Field(min_length=1, max_length=100)
    # 필수. 다른 목적의 기록을 덮어쓰지 않도록 목적별로 저장한다.
    work_purpose: WorkPurpose
    measurement_mode: Literal['numeric', 'gauge'] = 'numeric'
    measured_value: str = Field(default='', max_length=100)
    gauge_result: Literal['pass', 'fail'] | None = None
    confirmed: bool = False
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

def measurement_state(judgement, confirmed):
    if judgement == 'fail':
        return 'remeasure'
    if judgement == 'review':
        return 'review_required'
    if confirmed:
        return 'completed'
    return 'pending'


def measurement_response(row):
    record = dict(row)
    record['confirmed'] = bool(record.get('confirmed', False))
    record['status'] = measurement_state(
        record['judgement'],
        record['confirmed'],
    )
    return record

@router.get('/{drawing_id}/measurements')
def list_measurements(drawing_id: str, revision: str, purpose: WorkPurpose = Query(...)):
    current_snapshot(drawing_id, revision)

    with database() as db:
        rows = db.execute('''
            SELECT item_id, work_purpose, measured_value, instrument, note,
                   judgement, judgement_reason, updated_at,
                   measurement_mode, gauge_result, confirmed
            FROM measurement_records
            WHERE drawing_id=? AND ocr_revision=? AND work_purpose=?
        ''', (drawing_id, revision, purpose)).fetchall()

    return {
        'drawing_id': drawing_id,
        'revision': revision,
        'work_purpose': purpose,
        'records': [measurement_response(row) for row in rows],
    }


@router.get('/{drawing_id}/items/{item_id}/measurement-attempts')
def list_measurement_attempts(drawing_id: str, item_id: str, revision: str, purpose: WorkPurpose = Query(...)):
    """이 목적에서 저장한 측정 이력 (최근 순)."""
    current_snapshot(drawing_id, revision)
    with database() as db:
        rows = db.execute('''
            SELECT attempt_id, record_json, created_at
            FROM measurement_attempts
            WHERE drawing_id=? AND ocr_revision=? AND work_purpose=? AND item_id=?
            ORDER BY attempt_id DESC
        ''', (drawing_id, revision, purpose, item_id)).fetchall()
    return {
        'drawing_id': drawing_id,
        'revision': revision,
        'work_purpose': purpose,
        'item_id': item_id,
        'attempts': [
            {'attempt_id': row['attempt_id'], 'created_at': row['created_at'], **json.loads(row['record_json'])}
            for row in rows
        ],
    }

@router.post('/{drawing_id}/items/{item_id}/measurement')
def save_measurement(
    drawing_id: str,
    item_id: str,
    payload: MeasurementInput,
):
    snapshot = current_snapshot(drawing_id, payload.revision)
    document = snapshot['result']

    if document.get('review_status') != 'reviewed':
        raise HTTPException(
            409,
            '관리자 검토 완료 후 측정 결과를 저장할 수 있습니다.',
        )

    item = next(
        (entry for entry in document['items'] if entry['id'] == item_id),
        None,
    )
    if item is None:
        raise HTTPException(404, '이 도면의 항목이 아닙니다.')
    if item.get('excluded'):
        raise HTTPException(409, '관리자가 오인식으로 제외한 항목입니다.')

    # 측정 방식은 저장된 관리자 설정을 사용한다.
    # 기존 숫자 측정 항목과의 호환성을 위해 미설정은 numeric으로 처리한다.
    expected_mode = item.get('measurement_mode') or 'numeric'

    if expected_mode not in ('numeric', 'gauge'):
        raise HTTPException(422, '관리자가 측정 방식을 확인해야 합니다.')

    if payload.measurement_mode != expected_mode:
        raise HTTPException(
            422,
            '관리자가 지정한 측정 방식과 입력 방식이 다릅니다.',
        )

    measured_value = payload.measured_value.strip()

    if expected_mode == 'gauge':
        if measured_value:
            raise HTTPException(
                422,
                '게이지 검사에서는 숫자 실측값 대신 검사 결과를 선택해주세요.',
            )

        if payload.gauge_result is None:
            raise HTTPException(422, '게이지 검사 결과를 선택해주세요.')

        criteria = item.get('gauge_criteria')
        if not isinstance(criteria, str) or not criteria.strip():
            raise HTTPException(
                422,
                '관리자가 게이지 검사 기준을 먼저 지정해야 합니다.',
            )

        if (
            item.get('requires_review') is not False
            or item.get('coordinate_requires_review')
        ):
            judgement = 'review'
            reason = '항목 또는 측정 위치의 관리자 확인이 필요합니다.'
        else:
            judgement = payload.gauge_result
            reason = (
                '작업자가 저장된 게이지 검사 기준에 따라 적합으로 기록했습니다.'
                if judgement == 'pass'
                else '작업자가 게이지 검사 부적합으로 기록했습니다. 재확인이 필요합니다.'
            )

    else:
        if payload.gauge_result is not None:
            raise HTTPException(
                422,
                '실측값 방식에서는 게이지 결과를 함께 보낼 수 없습니다.',
            )

        try:
            if not re.fullmatch(
                r'[+-]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?',
                measured_value,
            ):
                raise InvalidOperation

            value = Decimal(measured_value)
            if not value.is_finite():
                raise InvalidOperation

        except InvalidOperation:
            raise HTTPException(
                422,
                '실측값에는 유효한 숫자를 입력해주세요.',
            )

        judgement, reason = judge(item, value)

    if payload.confirmed and judgement != 'pass':
        raise HTTPException(
            422,
            '적합 판정인 항목만 측정 완료로 확인할 수 있습니다. '
            '부적합 결과는 확인 체크를 해제하고 기록해주세요.',
        )

    record = {
        'drawing_id': drawing_id,
        'revision': payload.revision,
        'item_id': item_id,
        'work_purpose': payload.work_purpose,
        'measurement_mode': expected_mode,
        'measured_value': measured_value,
        'gauge_result': payload.gauge_result,
        'instrument': payload.instrument.strip(),
        'note': payload.note.strip(),
        'judgement': judgement,
        'judgement_reason': reason,
        'confirmed': payload.confirmed,
        'status': measurement_state(judgement, payload.confirmed),
    }

    with database() as db:
        db.execute('BEGIN IMMEDIATE')

        current = db.execute(
            'SELECT revision FROM ocr_results WHERE drawing_id=?',
            (drawing_id,),
        ).fetchone()

        if current is None or current['revision'] != payload.revision:
            raise HTTPException(
                409,
                '저장 중 OCR 결과가 변경됐습니다. 다시 조회해주세요.',
            )

        db.execute('''
            INSERT INTO measurement_records (
                drawing_id, ocr_revision, work_purpose, item_id,
                measured_value, instrument, note,
                judgement, judgement_reason, item_snapshot_json,
                measurement_mode, gauge_result, confirmed
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(drawing_id, ocr_revision, work_purpose, item_id)
            DO UPDATE SET
                measured_value=excluded.measured_value,
                instrument=excluded.instrument,
                note=excluded.note,
                judgement=excluded.judgement,
                judgement_reason=excluded.judgement_reason,
                item_snapshot_json=excluded.item_snapshot_json,
                measurement_mode=excluded.measurement_mode,
                gauge_result=excluded.gauge_result,
                confirmed=excluded.confirmed,
                updated_at=CURRENT_TIMESTAMP
        ''', (
            drawing_id,
            payload.revision,
            payload.work_purpose,
            item_id,
            measured_value,
            record['instrument'],
            record['note'],
            judgement,
            reason,
            json.dumps(item, ensure_ascii=False),
            expected_mode,
            payload.gauge_result,
            int(payload.confirmed),
        ))

        # 재측정하더라도 이전에 저장한 결과는 이력에 남긴다.
        db.execute('''
            INSERT INTO measurement_attempts (
                drawing_id, ocr_revision, work_purpose, item_id, record_json
            ) VALUES (?,?,?,?,?)
        ''', (
            drawing_id,
            payload.revision,
            payload.work_purpose,
            item_id,
            json.dumps(record, ensure_ascii=False),
        ))

    return record