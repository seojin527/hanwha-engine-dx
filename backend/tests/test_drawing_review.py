"""Registered CPU OCR -> review -> measurement and error retrieval integration."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import drawing_library as library
import ocr_results as results
import ocr_jobs as jobs
from measurement_api import init_measurements, router as measurements
from ocr_api import router as ocr
from ocr_review.drawing_api import init_drawing_reviews, router as reviews
from ocr_metadata import convert


class DrawingReviewFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.original = (library.DB_PATH, library.UPLOAD_DIR, results.RESULT_DIR, jobs.JOB_DIR)
        library.DB_PATH = root / 'library.sqlite3'
        library.UPLOAD_DIR = root / 'uploads'
        results.RESULT_DIR = root / 'ocr'
        jobs.JOB_DIR = root / 'jobs'
        self.upload_patch = patch.object(jobs, 'UPLOAD_DIR', library.UPLOAD_DIR)
        self.upload_patch.start()
        library.init_library()
        results.init_ocr_results()
        init_measurements()
        init_drawing_reviews()
        jobs.init_jobs()
        app = FastAPI()
        for router in (library.router, ocr, measurements, reviews):
            app.include_router(router)
        self.client = TestClient(app)
        self.app = app
        image = io.BytesIO()
        Image.new('RGB', (100, 100), 'white').save(image, 'JPEG')
        self.jpg = image.getvalue()
        self.drawing = self.client.post('/api/parts/part-piston-rod/drawings',
            files={'file': ('drawing.jpg', self.jpg, 'image/jpeg')}).json()['drawing_id']
        self.base = f'/api/drawings/{self.drawing}'
        self.meta = {'drawing_id': self.drawing,
            'image': {'width_px': 100, 'height_px': 100, 'coordinate_origin': 'top-left'},
            'items': [{'id': 'DIMENSION_001', 'raw_text': '10±1', 'category': 'DIMENSION',
                'position': {'x': 20, 'y': 20}, 'feature_type': 'SHAFT',
                'tol_type': 'DIMENSION', 'requires_review': True,
                'lower_limit': 9, 'upper_limit': 11}]}
        self.snapshot = results.save_ocr_result(self.drawing, self.meta, self.jpg)

    def tearDown(self):
        self.client.close()
        self.upload_patch.stop()
        library.DB_PATH, library.UPLOAD_DIR, results.RESULT_DIR, jobs.JOB_DIR = self.original
        self.tmp.cleanup()

    def submit(self, **overrides):
        payload = {'revision': self.snapshot['revision'], 'reviewer': '관리자',
            'edits': {'DIMENSION_001': {'raw_text': '12±1', 'nominal_value': 12,
                'lower_limit': 11, 'upper_limit': 13}},
            'confirmed_ids': ['DIMENSION_001'], 'complete': True}
        return self.client.post(self.base + '/ocr/review', json={**payload, **overrides})

    def test_review_updates_shared_snapshot_and_preserves_image_and_history(self):
        response = self.submit()
        self.assertEqual(response.status_code, 200, response.text)
        snapshot = response.json()
        self.assertNotEqual(snapshot['revision'], self.snapshot['revision'])
        self.assertEqual(snapshot['result']['items'][0]['raw_text'], '12±1')
        self.assertFalse(snapshot['result']['items'][0]['requires_review'])
        self.assertEqual(self.client.get(snapshot['image_url']).content, self.jpg)
        self.assertEqual(self.client.get(self.snapshot['image_url']).status_code, 404)
        self.assertEqual(self.client.get(self.base + '/ocr').json(), snapshot)
        init_drawing_reviews()
        history = self.client.get(self.base + '/ocr/reviews').json()['history']
        self.assertEqual(history[0]['changes'][0]['before']['raw_text'], '10±1')
        self.assertEqual(history[0]['reviewer'], '관리자')
        measurement = self.client.post(self.base + '/items/DIMENSION_001/measurement',
            json={'revision': snapshot['revision'], 'measured_value': '12'})
        self.assertEqual(measurement.json()['judgement'], 'pass')
        self.assertEqual(self.submit().status_code, 409)

    def test_rejects_incomplete_invalid_and_cross_drawing_edits_atomically(self):
        for changes in ({'confirmed_ids': []}, {'edits': {'UNKNOWN': {'raw_text': '1'}}},
                {'edits': {'DIMENSION_001': {'lower_limit': 20}}},
                {'edits': {'DIMENSION_001': {'position': {'x': 1, 'y': 1}}}},
                {'reviewer': ' '}):
            self.assertEqual(self.submit(**changes).status_code, 422)
            self.assertEqual(results.read_ocr_result(self.drawing)['revision'], self.snapshot['revision'])
        self.assertEqual(self.client.get(self.base + '/ocr/reviews').json()['history'], [])

    def test_draft_requires_review_and_keeps_previous_measurement(self):
        previous = self.client.post(self.base + '/items/DIMENSION_001/measurement',
            json={'revision': self.snapshot['revision'], 'measured_value': '10'})
        self.assertEqual(previous.status_code, 200)
        snapshot = self.submit(complete=False).json()
        self.assertFalse(snapshot['result']['review']['completed'])
        self.assertTrue(snapshot['result']['items'][0]['requires_review'])
        saved = self.client.post(self.base + '/items/DIMENSION_001/measurement',
            json={'revision': snapshot['revision'], 'measured_value': '12'})
        self.assertEqual(saved.json()['judgement'], 'review')
        with library.database() as db:
            rows = db.execute('SELECT * FROM measurement_records').fetchall()
        self.assertEqual(len(rows), 2)

    def test_cpu_queue_survives_review_and_converter_is_available(self):
        self.assertEqual(jobs.enqueue(self.drawing)['status'], 'completed')
        self.submit()
        self.assertEqual(jobs.snapshot(self.drawing)['result']['items'][0]['raw_text'], '12±1')
        source = 'Image size: 100 x 100 px\nFrame offset: 0, 0\n[ DIMENSIONS ]\n1 10±1 [20, 20]\n'
        metadata = convert(source, self.drawing, 'result.jpg')
        self.assertGreater(len(metadata['items']), 0)
        self.assertEqual(metadata['drawing_id'], self.drawing)

    def test_error_search_uses_reviewed_text_and_new_revision(self):
        from types import SimpleNamespace
        queries = []
        def encode(texts, **kwargs):
            queries.extend(texts)
            return SimpleNamespace(tolist=lambda: [[0.0]])
        self.app.state.model = SimpleNamespace(encode=encode)
        self.app.state.collection = SimpleNamespace(
            get=lambda **kwargs: {'ids': ['CASE1']},
            query=lambda **kwargs: {'ids': [['CASE1']], 'metadatas': [[{}]], 'distances': [[0.1]]})
        snapshot = self.submit().json()
        response = self.client.get(self.base + '/items/DIMENSION_001/errors')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['revision'], snapshot['revision'])
        self.assertIn('12±1', queries[0])



    def test_admin_ui_added_items_state_and_delete_history(self):
        added={'id':'ADM1','category':'DIMENSION','raw_text':'12','position':{'x':40,'y':50},
               'nominal_value':12,'feature_type':'SHAFT','tol_type':'DIMENSION',
               'lower_limit':11.9,'upper_limit':12.1,'equipment':'micrometer'}
        state={'nextOrder':2,'added':[],'edits':{'ADM1':{'confirmed':True}}}
        response=self.submit(added_items=[added],ui_state=state,confirmed_ids=['DIMENSION_001','ADM1'])
        self.assertEqual(response.status_code,200,response.text)
        snapshot=response.json()
        self.assertTrue(snapshot['result']['items'][1]['admin_added'])
        self.assertEqual(snapshot['result']['admin_ui_state'],state)
        self.assertEqual(snapshot['result']['review_base_items'],self.meta['items'])
        self.assertEqual(snapshot['result']['items'][1]['equipment'],'micrometer')
        self.snapshot=snapshot
        removed=self.submit(removed_ids=['ADM1'],ui_state={'edits':{},'added':[],'nextOrder':2})
        self.assertEqual(removed.status_code,200,removed.text)
        self.assertEqual(len(removed.json()['result']['items']),1)
        history=self.client.get(self.base+'/ocr/reviews').json()['history']
        deletion=next(change for change in history[0]['changes'] if change['item_id']=='ADM1')
        self.assertIsNone(deletion['after'])
        self.assertEqual(deletion['before']['raw_text'],'12')

    def test_admin_ui_rejects_invalid_additions_and_source_delete(self):
        for changes in ({'removed_ids':['DIMENSION_001']},
                        {'added_items':[{'id':'DIMENSION_001','category':'DIMENSION'}]},
                        {'added_items':[{'id':'ADM1','category':'DIMENSION','raw_text':'1','position':{'x':100,'y':1}}]},
                        {'edits':{'DIMENSION_001':{'tolerance_value':'wrong'}}}):
            response=self.submit(**changes)
            self.assertEqual(response.status_code,422,response.text)
            self.assertEqual(results.read_ocr_result(self.drawing)['revision'],self.snapshot['revision'])

    def test_admin_ui_gdt_and_equipment_are_durable(self):
        self.meta['items'].append({'id':'GDT_001_1','category':'GDT','raw_text':'perp|0.1|A',
            'position':{'x':30,'y':30},'gdt_symbol':'perp','tolerance_value':0.1,'datum_references':['A']})
        self.snapshot=results.save_ocr_result(self.drawing,self.meta,self.jpg)
        response=self.submit(edits={'GDT_001_1':{'raw_text':'perp|0.02|A|B','tolerance_value':0.02,
            'datum_references':['A','B'],'equipment':'CMM'}},confirmed_ids=['DIMENSION_001','GDT_001_1'])
        self.assertEqual(response.status_code,200,response.text)
        item=results.read_ocr_result(self.drawing)['result']['items'][1]
        self.assertEqual(item['tolerance_value'],0.02)
        self.assertEqual(item['datum_references'],['A','B'])
        self.assertEqual(item['equipment'],'CMM')

    def test_admin_reference_import_reuses_saved_review(self):
        from ocr_review.admin_ui_api import router
        self.app.include_router(router)
        first=self.client.post('/api/ocr-review/demo/HDH_63_01')
        self.assertEqual(first.status_code,200,first.text)
        original=first.json()
        changed=self.client.post('/api/drawings/'+original['drawing_id']+'/ocr/review',json={
            'revision':original['revision'],'reviewer':'admin','edits':{},'complete':False,
            'ui_state':{'nextOrder':8,'edits':{},'added':[]}})
        self.assertEqual(changed.status_code,200,changed.text)
        reloaded=self.client.post('/api/ocr-review/demo/HDH_63_01').json()
        self.assertEqual(reloaded['revision'],changed.json()['revision'])
        self.assertEqual(reloaded['result']['admin_ui_state']['nextOrder'],8)
        self.assertEqual(self.client.post('/api/ocr-review/demo/unknown').status_code,404)


    def test_admin_history_filter_clear_archives_without_deleting(self):
        from ocr_review.admin_ui_api import router
        self.app.include_router(router)
        self.submit()
        history=self.client.get('/api/ocr-review/history/entries').json()['history']
        self.assertEqual(len(history),1)
        self.assertEqual(history[0]['drawing_id'],self.drawing)
        self.assertFalse(history[0]['previous_completed'])
        self.assertEqual(self.client.post('/api/ocr-review/history/clear').status_code,200)
        self.assertEqual(self.client.get('/api/ocr-review/history/entries').json()['history'],[])
        self.assertEqual(len(self.client.get(self.base+'/ocr/reviews').json()['history']),1)

if __name__ == '__main__':
    unittest.main()
