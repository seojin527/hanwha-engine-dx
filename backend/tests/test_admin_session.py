import os
import unittest
from unittest import mock
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
import admin_session as auth
import deploy_guard


class AdminSessionTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {'DEPLOY_MODE': 'public', 'ADMIN_TOKEN': 'test-key', 'OCR_ENABLED': '0'})
        self.env.start()
        auth._attempts.clear()
        app = FastAPI()
        app.middleware('http')(deploy_guard.guard_middleware)
        app.include_router(auth.router)
        @app.post('/api/parts')
        def write(): return {'ok': True}
        @app.get('/api/deploy-mode')
        def mode(request: Request): return deploy_guard.mode_info(request)
        self.client = TestClient(app, base_url='https://dx.example.test')
        self.origin = {'Origin': 'https://dx.example.test'}

    def tearDown(self):
        self.client.close()
        self.env.stop()

    def login(self):
        with mock.patch.object(auth, 'verify_credentials', return_value=True):
            return self.client.post('/api/admin/session', json={'username': 'admin', 'password': 'private'}, headers=self.origin)

    def test_valid_credentials_create_secure_session_and_enable_same_origin_writes(self):
        r = self.login()
        self.assertEqual(r.status_code, 200)
        for flag in ['Secure', 'HttpOnly', 'SameSite=strict', 'Path=/']:
            self.assertIn(flag, r.headers['set-cookie'])
        self.assertNotIn('private', r.headers['set-cookie'])
        self.assertEqual(self.client.post('/api/parts', headers=self.origin).status_code, 200)
        self.assertFalse(self.client.get('/api/deploy-mode').json()['read_only'])
        self.assertTrue(self.client.get('/api/deploy-mode').json()['admin_session'])

    def test_wrong_credentials_keep_public_read_only(self):
        with mock.patch.object(auth, 'verify_credentials', return_value=False):
            self.assertEqual(self.client.post('/api/admin/session', json={'username': 'admin', 'password': 'wrong'}, headers=self.origin).status_code, 401)
        self.assertEqual(self.client.post('/api/parts', headers=self.origin).status_code, 403)

    def test_cross_origin_and_missing_origin_writes_denied(self):
        self.login()
        for headers in [{}, {'Origin': 'https://evil.example'}]:
            self.assertEqual(self.client.post('/api/parts', headers=headers).status_code, 403)
        with mock.patch.object(auth, 'verify_credentials') as verify:
            self.assertEqual(self.client.post('/api/admin/session', json={'username': 'admin', 'password': 'private'}, headers={'Origin': 'https://evil.example'}).status_code, 403)
            verify.assert_not_called()

    def test_expired_tampered_sessions_and_logout(self):
        self.login()
        cookie = self.client.cookies.get(auth.COOKIE)
        with mock.patch.object(auth.time, 'time', return_value=10**12):
            self.assertEqual(self.client.post('/api/parts', headers=self.origin).status_code, 403)
        self.client.cookies.set(auth.COOKIE, cookie[:-1] + ('0' if cookie[-1] != '0' else '1'), domain='dx.example.test')
        self.assertEqual(self.client.post('/api/parts', headers=self.origin).status_code, 403)
        self.client.cookies.clear()
        self.login()
        self.assertEqual(self.client.delete('/api/admin/session', headers=self.origin).status_code, 200)
        self.assertEqual(self.client.post('/api/parts', headers=self.origin).status_code, 403)

    def test_password_attempts_are_limited(self):
        with mock.patch.object(auth, 'verify_credentials', return_value=False):
            for _ in range(5):
                self.assertEqual(self.client.post('/api/admin/session', json={'username': 'admin', 'password': 'wrong'}, headers=self.origin).status_code, 401)
            self.assertEqual(self.client.post('/api/admin/session', json={'username': 'admin', 'password': 'wrong'}, headers=self.origin).status_code, 429)

    def test_verification_refuses_upstream_redirects(self):
        import urllib.error
        with mock.patch.object(auth.urllib.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = urllib.error.HTTPError('https://admin.example', 302, 'redirect', {}, None)
            with self.assertRaises(Exception) as caught:
                auth.verify_credentials('admin', 'private')
            self.assertEqual(caught.exception.status_code, 503)
        self.assertIsNone(auth._NoRedirect().redirect_request(None,None,302,'',{},'https://evil.example'))
