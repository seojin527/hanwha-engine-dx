"""Load the original jm_ocr reference drawings into the real drawing library."""
import io
import json
import re
import threading
from pathlib import Path
from fastapi import APIRouter, HTTPException
from PIL import Image
import drawing_library as library
from ocr_results import read_ocr_result, save_ocr_result

router = APIRouter(prefix='/api/ocr-review', tags=['Admin reference drawings'])
REFERENCE_DIR = Path(__file__).resolve().parents[2] / 'frontend/public/drawings'
_import_lock = threading.Lock()

@router.post('/demo/{name}')
def import_reference(name: str):
    if not re.fullmatch(r'(?:1|HDH_63_(?:0[1-9]|10))', name):
        raise HTTPException(404, 'Unknown reference drawing.')
    drawing_id = 'jm-demo-' + name
    with _import_lock:
        with library.database() as db:
            exists = db.execute('SELECT 1 FROM ocr_results WHERE drawing_id=?',(drawing_id,)).fetchone()
        if exists:
            return read_ocr_result(drawing_id)
        metadata_path = REFERENCE_DIR / (name+'.json')
        image_path = REFERENCE_DIR / (name+('.png' if name == '1' else '.jpg'))
        if not metadata_path.is_file() or not image_path.is_file():
            raise HTTPException(404, 'Reference files unavailable.')
        payload = json.loads(metadata_path.read_text(encoding='utf-8'))
        image = image_path.read_bytes()
        if name == '1':
            buffer=io.BytesIO()
            Image.open(io.BytesIO(image)).convert('RGB').save(buffer,format='JPEG')
            image=buffer.getvalue()
        filename = drawing_id+'.jpg'
        library.UPLOAD_DIR.mkdir(parents=True,exist_ok=True)
        target = library.UPLOAD_DIR / filename
        if not target.exists():
            target.write_bytes(image)
        with library.database() as db:
            db.execute("INSERT OR IGNORE INTO parts(part_id,name) VALUES ('jm-reference','관리자 검토 참조 도면')")
            db.execute("""INSERT OR IGNORE INTO drawings(drawing_id,part_id,name,
                original_filename,stored_filename,media_type,size_bytes)
                VALUES (?,'jm-reference',?,?,?,'image/jpeg',?)""",
                (drawing_id,name,name+'.jpg',filename,len(image)))
        return save_ocr_result(drawing_id,payload,image)




def _history_view(db):
    db.execute('CREATE TABLE IF NOT EXISTS review_history_view (key TEXT PRIMARY KEY, cutoff INTEGER NOT NULL)')

@router.get('/history/entries')
def all_review_entries():
    with library.database() as db:
        _history_view(db)
        cutoff=db.execute("SELECT cutoff FROM review_history_view WHERE key='all'").fetchone()
        rows=db.execute('''SELECT rowid, review_id, drawing_id, reviewer, completed,
            created_at, changes_json, before_json FROM drawing_reviews
            WHERE rowid>? ORDER BY rowid DESC LIMIT 300''',(cutoff['cutoff'] if cutoff else 0,)).fetchall()
    entries=[]
    for row in rows:
        event=dict(row)
        event['changes']=json.loads(event.pop('changes_json'))
        event['previous_completed']=json.loads(event.pop('before_json')).get('review',{}).get('completed',False)
        entries.append(event)
    return {'history':entries}

@router.post('/history/clear')
def clear_review_history_view():
    # Archive the display; retain all audit records and before/after metadata.
    with library.database() as db:
        _history_view(db)
        maximum=db.execute('SELECT COALESCE(MAX(rowid),0) FROM drawing_reviews').fetchone()[0]
        db.execute("INSERT INTO review_history_view(key,cutoff) VALUES('all',?) ON CONFLICT(key) DO UPDATE SET cutoff=excluded.cutoff",(maximum,))
    return {'archived':True}
