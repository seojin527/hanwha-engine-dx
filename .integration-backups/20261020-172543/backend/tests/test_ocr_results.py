import io,json,tempfile,unittest
from PIL import Image
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
import drawing_library as lib
import ocr_results as store
import ocr_api

class Model:
 def encode(self, queries, **kwargs):
  self.last = queries
  return SimpleNamespace(tolist=lambda:[[0.0]*384])
class Collection:
 def get(self,**kwargs):
  self.where=kwargs.get('where');return {'ids':['SIM-017']}
 def query(self,**kwargs):
  return {'ids':[['SIM-017']], 'metadatas':[[{'case_title':'나사 표기 검토', 'precaution':'피치 확인', 'data_origin':'SYNTHETIC'}]],'distances':[[0.154]]}

class Flow(unittest.TestCase):
 def setUp(self):
  self.original=(lib.DB_PATH, lib.UPLOAD_DIR, store.RESULT_DIR)
  self.temp=tempfile.TemporaryDirectory();root=Path(self.temp.name)
  lib.DB_PATH=root/'library.sqlite3';lib.UPLOAD_DIR=root/'uploads';store.RESULT_DIR=root/'ocr'
  lib.init_library();store.init_ocr_results()
  app=FastAPI();app.include_router(lib.router);app.include_router(ocr_api.router)
  app.state.model=Model();app.state.collection=Collection();self.app=app;self.client=TestClient(app)
  self.png=(store.DATA_DIR/'1_image.png').read_bytes()
  self.meta=json.loads((store.DATA_DIR/'normalized/1_metadata.json').read_text(encoding='utf-8'))
  output=io.BytesIO()
  Image.open(io.BytesIO(self.png)).convert('RGB').save(output,format='JPEG')
  self.jpg=output.getvalue()
 def tearDown(self):
  lib.DB_PATH,lib.UPLOAD_DIR,store.RESULT_DIR=self.original
  self.temp.cleanup()
 def register(self,name='drawing.png'):
  r=self.client.post('/api/parts/part-piston-rod/drawings',files={'file':(name,self.png,'image/png')});self.assertEqual(r.status_code,201);return r.json()['drawing_id']
 def test_end_to_end_and_isolation(self):
  a=self.register();b=self.register('other.png')
  self.assertIsNone(self.client.get(f'/api/drawings/{a}/ocr').json()['result'])
  r=self.client.post(f'/api/drawings/{a}/ocr/sample');self.assertEqual(r.status_code,409)
  snap=store.save_ocr_result(a,self.meta,self.jpg);self.assertEqual(len(snap['result']['items']),19);self.assertEqual(snap['result']['drawing_id'],a)
  self.assertEqual(self.client.get(snap['image_url']).content,self.jpg)
  self.assertIsNone(self.client.get(f'/api/drawings/{b}/ocr').json()['result'])
  r=self.client.get(f'/api/drawings/{a}/items/DIMENSION_002/errors');self.assertEqual(r.status_code,200)
  self.assertEqual(r.json()['errors'][0]['case_id'],'SIM-017');self.assertEqual(self.app.state.collection.where,{'$and':[{'part_family':{'$in':['피스톤 로드']}},{'feature_type':'THREAD'}]})
  self.assertIn('M10', self.app.state.model.last[0]);self.assertTrue(self.app.state.model.last[0].startswith('query: '))
  self.assertEqual(self.client.get(f'/api/drawings/{a}/items/NOT_FOUND/errors').status_code,404)
  self.assertEqual(self.client.get(f'/api/drawings/{b}/items/DIMENSION_002/errors').status_code,409)
  # Database survives reinitialization, original bytes remain available.
  lib.init_library();store.init_ocr_results()
  self.assertEqual(self.client.get(f'/api/drawings/{a}/ocr').json()['revision'],snap['revision'])
  self.assertEqual(self.client.get(f'/api/drawings/{a}/file').content,self.png)
 def test_reject_invalid_result_without_losing_previous(self):
  a=self.register();first=store.save_ocr_result(a,self.meta,self.jpg)
  self.meta['items'][0]['position']['x']=999999
  with self.assertRaises(ValueError):store.save_ocr_result(a,self.meta,self.jpg)
  self.assertEqual(store.read_ocr_result(a)['revision'],first['revision'])
 def test_dimensions_ids_and_empty_items(self):
  a=self.register()
  for mode in ('size','duplicate','empty'):
   m=json.loads(json.dumps(self.meta))
   if mode=='size':m['image']['width_px']=1
   if mode=='duplicate':m['items'][1]['id']=m['items'][0]['id']
   if mode=='empty':m['items']=[]
   with self.assertRaises(ValueError):store.save_ocr_result(a,m,self.jpg)
 def test_revision_and_unknown_filter(self):
  a=self.register();first=store.save_ocr_result(a,self.meta,self.jpg);second=store.save_ocr_result(a,self.meta,self.jpg)
  self.assertNotEqual(first['revision'],second['revision'])
  self.assertEqual(self.client.get(first['image_url']).status_code,404)
  self.assertEqual(self.client.get(f'/api/drawings/{a}/items/DIMENSION_001/errors').status_code,200)
  self.assertEqual(self.app.state.collection.where,{'part_family':{'$in':['피스톤 로드']}})
if __name__=='__main__': unittest.main(verbosity=2)
