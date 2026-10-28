"""기존 app을 유지하면서 업로드→CPU OCR 자동 실행을 추가한다.
실행: python -m uvicorn app_auto:app --host 127.0.0.1 --port 8000
단일 프로세스로 실행한다 (--workers 사용하지 않음).
"""
from contextlib import asynccontextmanager
from fastapi import APIRouter, File, UploadFile

from app import app
from deploy_guard import check_ocr_capacity, ocr_enabled
from drawing_library import database, upload_drawing
from ocr_jobs import OcrWorker, enqueue, snapshot

previous_lifespan=app.router.lifespan_context


@asynccontextmanager
async def automatic_lifespan(application):
    async with previous_lifespan(application):
        if not ocr_enabled():
            # OCR_ENABLED=0 이면 대기 중인 작업도 실행하지 않는다.
            application.state.ocr_worker=None
            yield
            return
        worker=OcrWorker();worker.start()
        application.state.ocr_worker=worker
        try:yield
        finally:worker.close()


app.router.lifespan_context=automatic_lifespan
router=APIRouter(tags=['CPU OCR 자동 실행'])


def active_ocr_count():
    with database() as db:
        return db.execute("SELECT COUNT(*) FROM ocr_jobs WHERE status IN ('queued','running')").fetchone()[0]


@router.post('/api/parts/{part_id}/drawings',status_code=201)
def upload_and_start(part_id: str, file: UploadFile=File(...)):
    # OCR 이 꺼진 서버: 파일만 저장하고 'OCR 미실행' 으로 둔다 (OCR 은 노트북에서 처리).
    if not ocr_enabled():
        return upload_drawing(part_id,file)
    # 공개 배포에서는 업로드 전에 OCR 한도를 확인한다 (로컬 실행은 제한 없음)
    check_ocr_capacity(active_ocr_count())
    drawing=upload_drawing(part_id,file)
    job=enqueue(drawing['drawing_id'])
    return {**drawing,'ocr_status':job['status']}


@router.get('/api/drawings/{drawing_id}/ocr')
def get_automatic_ocr(drawing_id: str):
    return snapshot(drawing_id)


@router.post('/api/drawings/{drawing_id}/ocr/run',status_code=202)
def start_ocr(drawing_id: str):
    check_ocr_capacity(active_ocr_count())
    return enqueue(drawing_id)


# Place the automatic handlers before the old handlers, across FastAPI versions.
# Other routes (images, RAG, parts) continue to use the existing app.
count=len(app.router.routes)
app.include_router(router)
automatic_routes=app.router.routes[count:]
del app.router.routes[count:]
app.router.routes[0:0]=automatic_routes
app.openapi_schema=None
