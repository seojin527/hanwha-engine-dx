"""기존 app을 유지하면서 업로드→CPU OCR 자동 실행을 추가한다.
실행: python -m uvicorn app_auto:app --host 127.0.0.1 --port 8000
단일 프로세스로 실행한다 (--workers 사용하지 않음).
"""
from contextlib import asynccontextmanager
from fastapi import APIRouter, File, UploadFile

from app import app
from drawing_library import upload_drawing
from ocr_jobs import OcrWorker, enqueue, snapshot

previous_lifespan=app.router.lifespan_context


@asynccontextmanager
async def automatic_lifespan(application):
    async with previous_lifespan(application):
        worker=OcrWorker();worker.start()
        application.state.ocr_worker=worker
        try:yield
        finally:worker.close()


app.router.lifespan_context=automatic_lifespan
router=APIRouter(tags=['CPU OCR 자동 실행'])


@router.post('/api/parts/{part_id}/drawings',status_code=201)
def upload_and_start(part_id: str, file: UploadFile=File(...)):
    drawing=upload_drawing(part_id,file)
    job=enqueue(drawing['drawing_id'])
    return {**drawing,'ocr_status':job['status']}


@router.get('/api/drawings/{drawing_id}/ocr')
def get_automatic_ocr(drawing_id: str):
    return snapshot(drawing_id)


@router.post('/api/drawings/{drawing_id}/ocr/run',status_code=202)
def start_ocr(drawing_id: str, force: bool = False):
    # ?force=true 이면 저장된 결과가 있어도 다시 실행한다 (기본은 기존 동작)
    return enqueue(drawing_id, force)


# Place the automatic handlers before the old handlers, across FastAPI versions.
# Other routes (images, RAG, parts) continue to use the existing app.
count=len(app.router.routes)
app.include_router(router)
automatic_routes=app.router.routes[count:]
del app.router.routes[count:]
app.router.routes[0:0]=automatic_routes
app.openapi_schema=None
