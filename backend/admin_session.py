"""Form login using the existing administrator credentials; no passwords are stored in cookies."""
import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix='/api/admin', tags=['관리자 로그인'])
COOKIE = '__Host-dx_admin'
TTL = 2 * 60 * 60
_attempts = defaultdict(deque)
_lock = threading.Lock()


def _signature(value):
    secret = os.environ.get('ADMIN_TOKEN', '')
    if not secret:
        raise ValueError('administrator secret is not configured')
    return hmac.new(secret.encode(), ('admin-session-v1:' + value).encode(), hashlib.sha256).hexdigest()


def session_valid(request):
    value = request.cookies.get(COOKIE, '')
    try:
        version, expiry, nonce, signature = value.split('.')
        expires = int(expiry)
        return (version == 'v1' and time.time() < expires <= time.time() + TTL
                and len(nonce) == 32 and hmac.compare_digest(signature, _signature('.'.join((version, expiry, nonce)))))
    except (ValueError, TypeError):
        return False


def same_origin(request):
    return request.headers.get('origin') == f'{request.url.scheme}://{request.url.netloc}'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_credentials(username, password):
    # Only the configured, TLS-protected administrator service receives these credentials.
    host = os.environ.get('ADMIN_HOST', 'admin.165-245-178-152.sslip.io')
    if not host or any(c in host for c in '/@?#\\'):
        raise HTTPException(503, '관리자 인증 주소 설정을 확인해주세요.')
    authorization = base64.b64encode(f'{username}:{password}'.encode()).decode()
    request = urllib.request.Request(f'https://{host}/health', headers={'Authorization': 'Basic ' + authorization})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=10) as response:
            return response.status == 200 and response.read(128).strip() == b'{"ok":true}'
    except urllib.error.HTTPError as error:
        if error.code == 401:
            return False
        raise HTTPException(503, '관리자 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.') from None
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(503, '관리자 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.') from None


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=1024)


@router.post('/session')
def login(payload: Login, request: Request):
    if request.url.scheme != 'https':
        raise HTTPException(403, 'HTTPS 로그인 화면에서 접속해주세요.')
    if request.headers.get('origin') and not same_origin(request):
        raise HTTPException(403, '같은 사이트의 로그인 화면에서 접속해주세요.')
    if not os.environ.get('ADMIN_TOKEN') or os.environ.get('DEPLOY_MODE') != 'public':
        raise HTTPException(503, '이 환경에는 배포 관리자 로그인이 설정되지 않았습니다.')
    key = request.client.host if request.client else 'unknown'
    with _lock:
        attempts = _attempts[key]
        now = time.monotonic()
        while attempts and attempts[0] <= now - 300:
            attempts.popleft()
        if len(attempts) >= 5:
            raise HTTPException(429, '로그인 시도가 많습니다. 5분 뒤 다시 시도해주세요.')
        attempts.append(now)
    if ':' in payload.username or not verify_credentials(payload.username, payload.password):
        raise HTTPException(401, '아이디 또는 비밀번호를 확인해주세요.')
    unsigned = f'v1.{int(time.time()) + TTL}.{secrets.token_hex(16)}'
    response = JSONResponse({'authenticated': True}, headers={'Cache-Control': 'no-store'})
    response.set_cookie(COOKIE, unsigned + '.' + _signature(unsigned), secure=True, httponly=True, samesite='strict', max_age=TTL, path='/')
    return response


@router.delete('/session')
def logout(request: Request):
    if not same_origin(request):
        raise HTTPException(403, '같은 사이트에서 로그아웃해주세요.')
    response = JSONResponse({'authenticated': False}, headers={'Cache-Control': 'no-store'})
    response.delete_cookie(COOKIE, secure=True, httponly=True, samesite='strict', path='/')
    return response
