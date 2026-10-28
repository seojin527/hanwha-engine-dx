"""도면 미리보기(썸네일) · 삭제 영향 · 소프트 삭제 · OCR 꺼진 서버의 도면 등록.

임시 SQLite·폴더만 사용한다. 실행 (backend 폴더에서): python -m unittest tests.test_drawing_preview -v
"""
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import drawing_library as library  # noqa: E402
from ocr_results import init_ocr_results  # noqa: E402


def png_bytes(width=800, height=600):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, "PNG")
    return buffer.getvalue()


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.temp.name)
        self.patches = [
            mock.patch.object(library, "DB_PATH", root / "library.sqlite3"),
            mock.patch.object(library, "UPLOAD_DIR", root / "uploads"),
            mock.patch.object(library, "THUMBNAIL_DIR", root / "thumbnails"),
        ]
        for patch in self.patches:
            patch.start()
        library.init_library()
        init_ocr_results()
        app = FastAPI()
        app.include_router(library.router)
        self.client = TestClient(app)
        self.part = self.client.post("/api/parts", json={"name": "시험 부품"}).json()["part_id"]

    def tearDown(self):
        self.client.close()
        for patch in self.patches:
            patch.stop()
        self.temp.cleanup()

    def upload(self, name="시험 도면.png", data=None):
        response = self.client.post(f"/api/parts/{self.part}/drawings", files={"file": (name, data or png_bytes(), "image/png")})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_thumbnail_is_small_png_and_cached(self):
        drawing = self.upload()
        self.assertEqual(drawing["ocr_status"], "not_started")  # OCR 없이 저장
        response = self.client.get(f"/api/drawings/{drawing['drawing_id']}/thumbnail")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")
        with Image.open(io.BytesIO(response.content)) as image:
            self.assertEqual(image.width, library.THUMBNAIL_WIDTH["sm"])
        cached = library.THUMBNAIL_DIR / f"{drawing['drawing_id']}_sm.png"
        self.assertTrue(cached.is_file())
        self.assertEqual(self.client.get(f"/api/drawings/{drawing['drawing_id']}/thumbnail?size=xl").status_code, 422)

    @unittest.skipUnless(library._pdftoppm(), "poppler(pdftoppm) 없음")
    def test_pdf_first_page_thumbnail(self):
        buffer = io.BytesIO()
        Image.new("RGB", (1000, 700), "white").save(buffer, "PDF")
        drawing = self.upload("시험 도면.pdf", buffer.getvalue())
        response = self.client.get(f"/api/drawings/{drawing['drawing_id']}/thumbnail?size=lg")
        self.assertEqual(response.status_code, 200)
        with Image.open(io.BytesIO(response.content)) as image:
            self.assertEqual(image.width, library.THUMBNAIL_WIDTH["lg"])

    def test_delete_is_soft_and_impact_is_reported(self):
        drawing = self.upload()
        drawing_id = drawing["drawing_id"]
        impact = self.client.get(f"/api/drawings/{drawing_id}/delete-impact").json()
        self.assertEqual((impact["filename"], impact["has_ocr"], impact["measurement_records"]), ("시험 도면.png", False, 0))
        self.assertEqual(self.client.delete(f"/api/drawings/{drawing_id}").status_code, 200)
        # 목록·파일·미리보기에서는 사라지지만 행과 원본 파일은 남는다 (소프트 삭제)
        self.assertEqual(self.client.get(f"/api/parts/{self.part}/drawings").json()["drawings"], [])
        self.assertEqual(self.client.get(f"/api/drawings/{drawing_id}/thumbnail").status_code, 404)
        self.assertEqual(self.client.get("/api/parts").json()["parts"][0]["drawing_count"], 0)
        with library.database() as db:
            row = db.execute("SELECT deleted_at, stored_filename FROM drawings WHERE drawing_id=?", (drawing_id,)).fetchone()
        self.assertIsNotNone(row["deleted_at"])
        self.assertTrue((library.UPLOAD_DIR / row["stored_filename"]).is_file())


class OcrDisabledUploadTests(unittest.TestCase):
    def test_app_auto_saves_without_ocr_when_disabled(self):
        import app_auto

        with mock.patch.dict(os.environ, {"OCR_ENABLED": "0"}), \
             mock.patch.object(app_auto, "upload_drawing", return_value={"drawing_id": "d1", "ocr_status": "not_started"}) as upload, \
             mock.patch.object(app_auto, "enqueue") as enqueue:
            result = app_auto.upload_and_start("p1", file=None)
        upload.assert_called_once()
        enqueue.assert_not_called()
        self.assertEqual(result["ocr_status"], "not_started")


if __name__ == "__main__":
    unittest.main()
