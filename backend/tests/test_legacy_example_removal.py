import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from maintenance.remove_legacy_reviewed_example import remove_example, PART, NAME, DRAWINGS


class LegacyExampleRemovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'library.sqlite3'
        with sqlite3.connect(self.path) as db:
            db.executescript('CREATE TABLE parts(part_id TEXT PRIMARY KEY,name TEXT,deleted_at TEXT); CREATE TABLE drawings(drawing_id TEXT PRIMARY KEY,part_id TEXT,deleted_at TEXT); CREATE TABLE ocr_jobs(drawing_id TEXT,status TEXT);')
            db.execute('INSERT INTO parts VALUES (?,?,NULL)', (PART, NAME))
            db.execute('INSERT INTO parts VALUES (?,?,NULL)', ('current', '피스톤 로드'))
            db.executemany('INSERT INTO drawings VALUES (?,?,NULL)', [(d,PART) for d in DRAWINGS] + [('normal-1','current'),('normal-2','current')])

    def tearDown(self): self.temp.cleanup()

    def test_removes_only_identified_example_preserves_history_and_runs_once(self):
        self.assertEqual(remove_example(self.path), {'status':'removed','parts':1,'drawings':8})
        self.assertEqual(remove_example(self.path), {'status':'already-applied'})
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM drawings').fetchone()[0], 10)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM drawings WHERE deleted_at IS NULL').fetchone()[0], 2)
            self.assertIsNone(db.execute("SELECT deleted_at FROM parts WHERE part_id='current'").fetchone()[0])
            snapshot=json.loads(db.execute('SELECT snapshot_json FROM maintenance_runs').fetchone()[0])
            self.assertEqual(snapshot['part']['name'],NAME)
            self.assertEqual(len(snapshot['drawings']),8)

    def test_changed_name_or_additional_drawing_stops_without_deletion(self):
        with sqlite3.connect(self.path) as db: db.execute('INSERT INTO drawings VALUES (?,?,NULL)', ('new-user-drawing',PART))
        with self.assertRaises(RuntimeError): remove_example(self.path)
        with sqlite3.connect(self.path) as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM drawings WHERE deleted_at IS NOT NULL').fetchone()[0],0)

    def test_active_ocr_stops_without_deletion(self):
        with sqlite3.connect(self.path) as db: db.execute('INSERT INTO ocr_jobs VALUES (?,?)', (next(iter(DRAWINGS)),'running'))
        with self.assertRaises(RuntimeError): remove_example(self.path)
        with sqlite3.connect(self.path) as db: self.assertIsNone(db.execute('SELECT deleted_at FROM parts WHERE part_id=?',(PART,)).fetchone()[0])
