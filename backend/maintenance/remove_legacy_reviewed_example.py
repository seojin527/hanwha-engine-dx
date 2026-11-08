"""One-time, backed-up removal explicitly requested on 2026-11-08.

Only the identified legacy example and its eight identified drawings are soft-deleted.
The current five-part demonstration, source files and inspection history remain intact.
"""
import argparse
import json
import sqlite3
from pathlib import Path

PART = 'fff168c6-6a4a-4ea2-b207-6ee49e306ed1'
NAME = '피스톤 로드 · 검토 완료 예시'
DRAWINGS = {
    '156bbb50-224f-46f0-9f22-c9c8a7baa1fb', 'fabfb766-22f6-4746-b1b3-0704fd209c1b',
    '8bed6719-6055-47f1-8ed1-e6a30f27d7ef', 'c33e1c21-bba2-465d-aa6f-abcaa6ff7e5b',
    '9010f02c-2486-46f4-bfb5-780e85466d35', '9f9efd00-a8c3-4c82-841a-596067d5f612',
    'e6c2300a-9376-412a-8278-e292de43a30b', 'b4ae359d-0c22-4b75-9c10-527f43efc971',
}
KEY = '2026-11-08-remove-reviewed-piston-example'


def remove_example(path):
    if not Path(path).is_file():
        return {'status': 'not-present'}
    with sqlite3.connect(path, timeout=30) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN IMMEDIATE')
        db.execute('CREATE TABLE IF NOT EXISTS maintenance_runs (migration_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
        if db.execute('SELECT 1 FROM maintenance_runs WHERE migration_id=?', (KEY,)).fetchone():
            return {'status': 'already-applied'}
        part = db.execute('SELECT * FROM parts WHERE part_id=?', (PART,)).fetchone()
        if not part or part['deleted_at']:
            return {'status': 'not-present'}
        if part['name'] != NAME:
            raise RuntimeError('Legacy example identity changed; deletion stopped')
        rows = db.execute('SELECT * FROM drawings WHERE part_id=? AND deleted_at IS NULL', (PART,)).fetchall()
        if {r['drawing_id'] for r in rows} != DRAWINGS:
            raise RuntimeError('Legacy example drawing set changed; deletion stopped')
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ocr_jobs'").fetchone():
            active = db.execute("SELECT 1 FROM ocr_jobs WHERE drawing_id IN (SELECT drawing_id FROM drawings WHERE part_id=?) AND status IN ('queued','running') LIMIT 1", (PART,)).fetchone()
            if active:
                raise RuntimeError('Legacy example OCR is active; deletion stopped')
        snapshot = json.dumps({'part': dict(part), 'drawings': [dict(r) for r in rows]}, ensure_ascii=False)
        db.execute('INSERT INTO maintenance_runs(migration_id,snapshot_json) VALUES (?,?)', (KEY, snapshot))
        db.execute('UPDATE drawings SET deleted_at=CURRENT_TIMESTAMP WHERE part_id=? AND deleted_at IS NULL', (PART,))
        db.execute('UPDATE parts SET deleted_at=CURRENT_TIMESTAMP WHERE part_id=?', (PART,))
        return {'status': 'removed', 'parts': 1, 'drawings': len(rows)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    args = parser.parse_args()
    print(json.dumps(remove_example(args.db), ensure_ascii=False))
