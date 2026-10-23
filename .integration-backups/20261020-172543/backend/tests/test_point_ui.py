"""SQLite 통합 검증. 모델·벡터DB는 테스트 대역을 사용한다."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import drawing_library as library
from error_case_store import init_error_cases
from ocr_results import init_ocr_results
from measurement_api import init_measurements, router as measurement_router
from point_error_api import init_point_errors, router as point_router


class Vectors:
    def tolist(self): return [[1.0, 0.0]]

class Model:
    def encode(self, *args, **kwargs): return Vectors()

class Collection:
    def __init__(self): self.rows = {}; self.fail = False
    def upsert(self, **kwargs):
        if self.fail: raise RuntimeError('test failure')
        self.rows[kwargs['ids'][0]] = kwargs


class PointUITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = library.DB_PATH
        library.DB_PATH = Path(self.temp.name) / 'library.sqlite3'
        library.init_library(); init_ocr_results(); init_error_cases()
        init_measurements(); init_point_errors()
        self.items = [dict(id='D1', category='DIMENSION', raw_text='26±0.05',
            feature_type='SHAFT', tol_type='DIMENSION', requires_review=False,
            lower_limit=25.95, upper_limit=26.05),
            dict(id='D2', category='DIMENSION', raw_text='M10', feature_type='THREAD',
                 tol_type='THREAD_SPEC', requires_review=True)]
        with library.database() as db:
            for drawing in ('drawing-a', 'drawing-b'):
                db.execute('''INSERT INTO drawings (drawing_id,part_id,name,original_filename,
                    stored_filename,media_type,size_bytes) VALUES (?, 'part-piston-rod', ?, ?, ?, 'application/pdf', 1)''',
                    (drawing, drawing, drawing+'.pdf', drawing+'.pdf'))
                doc = {'drawing_id': drawing, 'items': self.items, 'review': {'completed':True, 'reviewer':'test', 'approved_revision':'rev-1', 'confirmed_ids':['D1','D2']}}
                db.execute('INSERT INTO ocr_results (drawing_id,metadata_json,image_filename,revision) VALUES (?,?,?,?)',
                    (drawing, json.dumps(doc), 'test.jpg', 'rev-1'))
        app = FastAPI(); app.include_router(measurement_router); app.include_router(point_router)
        app.state.model = Model(); app.state.collection = Collection()
        self.collection = app.state.collection
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close(); library.DB_PATH = self.old_db; self.temp.cleanup()

    def save(self, value='26', item='D1', revision='rev-1'):
        return self.client.post(f'/api/drawings/drawing-a/items/{item}/measurement', json={
            'revision': revision, 'measured_value': value, 'instrument':'마이크로미터', 'note':'테스트'})

    def test_measurement_persistence_isolation_and_judgement(self):
        self.assertEqual(self.save().json()['judgement'], 'pass')
        self.assertEqual(self.save('40.004').json()['judgement'], 'fail')
        self.assertEqual(self.save('25.95').json()['judgement'], 'pass')
        rows=self.client.get('/api/drawings/drawing-a/measurements?revision=rev-1').json()['records']
        self.assertEqual(len(rows), 1); self.assertEqual(rows[0]['measured_value'], '25.95')
        self.assertEqual(self.client.get('/api/drawings/drawing-b/measurements?revision=rev-1').json()['records'], [])
        init_measurements()
        self.assertEqual(self.client.get('/api/drawings/drawing-a/measurements?revision=rev-1').json()['records'][0]['note'], '테스트')

    def test_invalid_and_unknown_criteria(self):
        for value in ('NaN', 'Infinity', 'abc', ' '): self.assertEqual(self.save(value).status_code, 422)
        self.assertEqual(self.save('10', item='D2').json()['judgement'], 'review')
        self.assertEqual(self.save(item='missing').status_code, 404)
        self.assertEqual(self.save(revision='old').status_code, 409)
        self.items[0]['requires_review']=True
        with library.database() as db:
            db.execute('UPDATE ocr_results SET metadata_json=? WHERE drawing_id=?',
                (json.dumps({'items':self.items, 'review': {'completed':True, 'reviewer':'test', 'approved_revision':'rev-1', 'confirmed_ids':['D1','D2']}}), 'drawing-a'))
        self.assertEqual(self.save().json()['judgement'], 'review')

    def test_revision_isolation(self):
        self.save()
        with library.database() as db: db.execute("UPDATE ocr_results SET revision='rev-2' WHERE drawing_id='drawing-a'")
        self.assertEqual(self.client.get('/api/drawings/drawing-a/measurements?revision=rev-2').status_code, 409)
        self.assertEqual(self.save().status_code, 409)

    def test_report_context_duplicate_and_retry(self):
        path='/api/drawings/drawing-a/items/D2/error-cases'
        payload={'revision':'rev-1','request_id':str(uuid4()),'case_title':'나사 오류',
            'error_description':'입구 버 확인', 'precaution':'승인된 처리 후 검사'}
        first=self.client.post(path,json=payload)
        self.assertEqual(first.status_code,201); data=first.json()
        self.assertEqual(data['vector_status'],'ready')
        second=self.client.post(path,json=payload).json()
        self.assertEqual(data['case_id'],second['case_id'])
        rows=self.client.get(path+'?revision=rev-1').json()['reports']; self.assertEqual(len(rows),1)
        with library.database() as db:
            case=dict(db.execute('SELECT * FROM error_cases').fetchone())
            report=dict(db.execute('SELECT * FROM point_error_reports').fetchone())
        self.assertEqual(case['drawing_text_example'],'M10'); self.assertEqual(case['part_family'],'피스톤 로드')
        self.assertEqual(json.loads(report['item_snapshot_json'])['id'],'D2')
        self.assertEqual(self.client.post(path,json={**payload,'revision':'old'}).status_code,409)
        self.assertEqual(self.client.post(path,json={**payload,'part_family':'fake'}).status_code,422)
        self.collection.fail=True
        failed=self.client.post(path,json={**payload,'request_id':str(uuid4())}).json()
        self.assertEqual(failed['vector_status'],'failed')
        self.assertEqual(len(self.client.get(path+'?revision=rev-1').json()['reports']),2)



    def test_uuid_formats_reuse_existing_report_and_retry_index(self):
        path='/api/drawings/drawing-a/items/D2/error-cases'
        token=uuid4()
        payload={'revision':'rev-1','request_id':str(token),'case_title':'retry',
                 'error_description':'reported issue','precaution':'check first'}
        self.collection.fail=True
        first=self.client.post(path,json=payload)
        self.assertEqual(first.status_code,201)
        original=first.json()
        self.assertEqual(original['vector_status'],'failed')
        # integration-dev stored hyphenated report IDs; main stored UUID.hex.
        legacy_id='RPT-'+str(token)
        with library.database() as db:
            db.execute('UPDATE point_error_reports SET report_id=? WHERE case_id=?',
                       (legacy_id,original['case_id']))
        self.collection.fail=False
        repeated=self.client.post(path,json={**payload,'request_id':token.hex})
        self.assertEqual(repeated.status_code,201)
        self.assertEqual(repeated.json()['case_id'],original['case_id'])
        self.assertEqual(repeated.json()['report_id'],legacy_id)
        self.assertEqual(repeated.json()['vector_status'],'ready')
        self.assertEqual(len(self.client.get(path+'?revision=rev-1').json()['reports']),1)
        other=self.client.post('/api/drawings/drawing-b/items/D2/error-cases',json=payload)
        self.assertEqual(other.status_code,409)
        self.assertEqual(self.client.post(path,json={**payload,'revision':'old'}).status_code,409)
        for invalid in (None,'invalid'):
            self.assertEqual(self.client.post(path,json={**payload,'request_id':invalid}).status_code,422)

if __name__ == '__main__': unittest.main()
