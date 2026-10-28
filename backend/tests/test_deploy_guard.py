"""공개 배포 체험 모드: 변경 요청 서버 측 차단과 관리자 토큰 허용.

실행 (backend 폴더에서): python -m unittest tests.test_deploy_guard -v
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import deploy_guard  # noqa: E402


def make_app():
    app = FastAPI()
    app.middleware("http")(deploy_guard.guard_middleware)

    @app.get("/api/parts")
    def parts():
        return {"parts": []}

    @app.post("/api/parts")
    def create():
        return {"ok": True}

    @app.post("/api/parts/{part_id}/drawings")
    def upload(part_id: str):
        return {"ok": True}

    @app.post("/api/drawings/{drawing_id}/ocr/run")
    def run(drawing_id: str):
        return {"ok": True}

    @app.post("/api/drawings/{drawing_id}/ocr/sample")
    def sample(drawing_id: str):
        return {"ok": True}

    @app.get("/api/deploy-mode")
    def mode(request: Request):
        return deploy_guard.mode_info(request)

    return app


class DeployGuardTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(make_app())

    def tearDown(self):
        self.client.close()

    def test_local_mode_allows_writes(self):
        with mock.patch.dict(os.environ, {"DEPLOY_MODE": "local"}):
            self.assertEqual(self.client.post("/api/parts").status_code, 200)
            self.assertFalse(self.client.get("/api/deploy-mode").json()["read_only"])

    def test_public_mode_blocks_writes_without_token(self):
        with mock.patch.dict(os.environ, {"DEPLOY_MODE": "public", "ADMIN_TOKEN": "secret"}):
            self.assertEqual(self.client.get("/api/parts").status_code, 200)
            self.assertEqual(self.client.post("/api/parts").status_code, 403)
            self.assertEqual(self.client.post("/api/parts", headers={"X-Admin-Token": "wrong"}).status_code, 403)
            self.assertTrue(self.client.get("/api/deploy-mode").json()["read_only"])

    def test_public_mode_without_configured_token_blocks_everything(self):
        with mock.patch.dict(os.environ, {"DEPLOY_MODE": "public", "ADMIN_TOKEN": ""}):
            self.assertEqual(self.client.post("/api/parts", headers={"X-Admin-Token": ""}).status_code, 403)

    def test_public_mode_admin_token_allows_writes_with_rate_limit(self):
        env = {"DEPLOY_MODE": "public", "ADMIN_TOKEN": "secret", "WRITE_RATE_PER_MIN": "2"}
        with mock.patch.dict(os.environ, env), mock.patch.object(deploy_guard, "_writes", deploy_guard._Window()):
            headers = {"X-Admin-Token": "secret", "X-Forwarded-For": "10.0.0.9"}
            self.assertEqual(self.client.post("/api/parts", headers=headers).status_code, 200)
            self.assertEqual(self.client.post("/api/parts", headers=headers).status_code, 200)
            self.assertEqual(self.client.post("/api/parts", headers=headers).status_code, 429)
            self.assertFalse(self.client.get("/api/deploy-mode", headers=headers).json()["read_only"])

    def test_ocr_capacity_only_limits_public_mode(self):
        with mock.patch.dict(os.environ, {"DEPLOY_MODE": "local"}):
            deploy_guard.check_ocr_capacity(99)
        with mock.patch.dict(os.environ, {"DEPLOY_MODE": "public", "OCR_MAX_ACTIVE": "2"}):
            with self.assertRaises(HTTPException) as caught:
                deploy_guard.check_ocr_capacity(2)
            self.assertEqual(caught.exception.status_code, 429)

    def test_ocr_disabled_blocks_ocr_routes_even_for_admin(self):
        env = {"DEPLOY_MODE": "public", "ADMIN_TOKEN": "secret", "OCR_ENABLED": "0"}
        with mock.patch.dict(os.environ, env), mock.patch.object(deploy_guard, "_writes", deploy_guard._Window()):
            admin = {"X-Admin-Token": "secret"}
            for path in ("/api/parts/p1/drawings", "/api/drawings/d1/ocr/run", "/api/drawings/d1/ocr/sample"):
                self.assertEqual(self.client.post(path, headers=admin).status_code, 403, path)
            # OCR 과 무관한 관리자 변경은 그대로 허용
            self.assertEqual(self.client.post("/api/parts", headers=admin).status_code, 200)
            self.assertFalse(self.client.get("/api/deploy-mode").json()["ocr_enabled"])
            with self.assertRaises(HTTPException) as caught:
                deploy_guard.check_ocr_capacity(0)
            self.assertEqual(caught.exception.status_code, 403)

    def test_ocr_disabled_also_applies_in_local_mode(self):
        with mock.patch.dict(os.environ, {"DEPLOY_MODE": "local", "OCR_ENABLED": "0"}):
            self.assertEqual(self.client.post("/api/drawings/d1/ocr/run").status_code, 403)
            self.assertEqual(self.client.post("/api/parts").status_code, 200)


if __name__ == "__main__":
    unittest.main()
