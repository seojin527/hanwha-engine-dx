"""공개 배포용 접근 제한 (로컬 실행에는 영향 없음).

환경변수
    DEPLOY_MODE=local   (기본) 제한 없음 — 지금까지의 로컬 실행과 같다.
    DEPLOY_MODE=public  관람객 체험 모드. GET/HEAD/OPTIONS 만 허용하고 변경 요청은 403.
                        요청 헤더 X-Admin-Token 이 ADMIN_TOKEN 과 같을 때만 변경을 허용한다.
                        (헤더는 관리자 주소의 리버스 프록시가 Basic 인증 뒤에 붙인다. 공개 주소에서는 지운다.)
    ADMIN_TOKEN          관리자 요청 판별용 비밀값. Git 에 넣지 않는다 (/etc/hanwha-dx.env).
    WRITE_RATE_PER_MIN   관리자 변경 요청의 IP 당 분당 상한 (기본 60)
    OCR_MAX_ACTIVE       동시에 대기·실행 중일 수 있는 OCR 작업 수 (기본 2)
    OCR_MAX_PER_HOUR     시간당 OCR·업로드 시작 상한 (기본 20)
    OCR_ENABLED          0 이면 서버에서 OCR 을 만들지 않는다 (기본 1). 관리자 요청이어도
                         도면 업로드·OCR 실행·샘플 OCR 저장을 403 으로 막고, app_auto 의 OCR 작업자도 시작하지 않는다.
                         발표 서버(2GB)는 0 으로 두고 노트북에서 만든 OCR 결과를 데이터 사본으로 올린다.

로그인 화면의 역할 선택은 서버 인증이 아니다. 공개 배포에서는 이 미들웨어가 실제 보호선이다.
"""
import hmac
import os
import re
import threading
import time
from collections import deque

from fastapi import HTTPException
from fastapi.responses import JSONResponse

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# OCR 을 새로 만드는 요청: 도면 업로드(app_auto 에서 자동 OCR), OCR 실행, 샘플 OCR 저장
OCR_PATHS = re.compile(r"^/api/(parts/[^/]+/drawings|drawings/[^/]+/ocr/(run|sample))/?$")
OCR_DISABLED_MESSAGE = "이 서버에서는 OCR 을 실행하지 않습니다. 도면 업로드·OCR 은 노트북에서 처리한 뒤 데이터 사본으로 올립니다."


def deploy_mode() -> str:
    return os.environ.get("DEPLOY_MODE", "local").strip().lower()


def is_public() -> bool:
    return deploy_mode() == "public"


def ocr_enabled() -> bool:
    return os.environ.get("OCR_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")


def is_admin_request(request) -> bool:
    expected = os.environ.get("ADMIN_TOKEN", "")
    given = request.headers.get("x-admin-token", "")
    return bool(expected) and hmac.compare_digest(given.encode(), expected.encode())


class _Window:
    """키별 최근 시각 목록으로 처리하는 단순 슬라이딩 윈도 (단일 프로세스 전제)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.hits: dict[str, deque] = {}

    def allow(self, key: str, limit: int, seconds: float) -> bool:
        now = time.monotonic()
        with self.lock:
            queue = self.hits.setdefault(key, deque())
            while queue and now - queue[0] > seconds:
                queue.popleft()
            if len(queue) >= limit:
                return False
            queue.append(now)
            return True


_writes = _Window()
_ocr = _Window()


def _client_ip(request) -> str:
    # 프록시(Caddy)가 같은 서버에서 붙이는 값. 공개 포트로 uvicorn 을 직접 열지 않는다.
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "")


async def guard_middleware(request, call_next):
    if request.method not in SAFE_METHODS and not ocr_enabled() and OCR_PATHS.match(request.url.path):
        return JSONResponse({"detail": OCR_DISABLED_MESSAGE}, status_code=403)
    if not is_public() or request.method in SAFE_METHODS:
        return await call_next(request)
    if not is_admin_request(request):
        return JSONResponse(
            {"detail": "체험 모드에서는 조회만 할 수 있습니다. 변경은 관리자 시연 주소에서만 가능합니다."},
            status_code=403,
        )
    limit = int(os.environ.get("WRITE_RATE_PER_MIN", "60"))
    if not _writes.allow(_client_ip(request), limit, 60):
        return JSONResponse({"detail": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."}, status_code=429)
    return await call_next(request)


def check_ocr_capacity(active_count: int) -> None:
    """OCR 을 새로 시작하기 전에 부른다. 로컬 모드에서는 OCR_ENABLED 외에는 제한하지 않는다."""
    if not ocr_enabled():
        raise HTTPException(403, OCR_DISABLED_MESSAGE)
    if not is_public():
        return
    if active_count >= int(os.environ.get("OCR_MAX_ACTIVE", "2")):
        raise HTTPException(429, "OCR 작업이 이미 진행 중입니다. 끝난 뒤 다시 시도해 주세요.")
    if not _ocr.allow("all", int(os.environ.get("OCR_MAX_PER_HOUR", "20")), 3600):
        raise HTTPException(429, "시간당 OCR 실행 한도를 넘었습니다.")


def mode_info(request) -> dict:
    public = is_public()
    return {"mode": deploy_mode(), "read_only": public and not is_admin_request(request), "ocr_enabled": ocr_enabled()}
