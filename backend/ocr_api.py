"""선택 도면에 대한 OCR 결과 조회·적용 및 관련 오류 검색 API."""
import json
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from ocr_results import DATA_DIR, read_ocr_result, save_ocr_result, get_result_image

router = APIRouter(prefix='/api/drawings', tags=['OCR 결과'])


@router.get('/{drawing_id}/ocr')
def get_ocr(drawing_id: str):
    return read_ocr_result(drawing_id)


@router.post('/{drawing_id}/ocr/sample')
def apply_sample(drawing_id: str):
    # 샘플을 모든 업로드에 자동 적용하지 않는다. UI에서 명시적으로 선택한 도면에만 적용.
    json_path = DATA_DIR / 'normalized' / '1_metadata.json'
    image_path = DATA_DIR / '1_image.png'
    if not json_path.is_file() or not image_path.is_file():
        raise HTTPException(404, 'data/normalized/1_metadata.json과 data/1_image.png를 확인해주세요.')
    try:
        metadata = json.loads(json_path.read_text(encoding='utf-8-sig'))
        return save_ocr_result(drawing_id, metadata, image_path.read_bytes())
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/{drawing_id}/ocr/image')
def ocr_image(drawing_id: str, revision: str | None = None):
    return FileResponse(get_result_image(drawing_id, revision), media_type='image/png')


def retrieval_query(item):
    parts = [f"도면 표기 {item['raw_text']}"]
    for key, label in [('measurement_characteristic', '검사 특성'), ('feature_type', '형상'), ('tol_type', '공차 유형')]:
        value = item.get(key)
        if value and value not in ('UNKNOWN', 'UNSPECIFIED'):
            parts.append(f'{label} {value}')
    parts.append('관련 측정 오류사례와 주의사항 검색')
    return '. '.join(parts)


@router.get('/{drawing_id}/items/{item_id}/errors')
def item_errors(drawing_id: str, item_id: str, request: Request, top_k: int = Query(3, ge=1, le=10)):
    snapshot = read_ocr_result(drawing_id)
    if snapshot['result'] is None:
        raise HTTPException(409, 'OCR 추출 결과를 먼저 적용해주세요.')
    item = next((i for i in snapshot['result']['items'] if i['id'] == item_id), None)
    if item is None:
        raise HTTPException(404, '이 도면의 측정항목을 찾을 수 없습니다.')
    collection = request.app.state.collection
    feature = item.get('feature_type')
    where = {'feature_type': feature} if feature and feature != 'UNKNOWN' else None
    candidates = collection.get(where=where, include=['metadatas'])
    errors = []
    if candidates['ids']:
        vector = request.app.state.model.encode(['query: ' + retrieval_query(item)], normalize_embeddings=True)
        result = collection.query(query_embeddings=vector.tolist(), where=where,
            n_results=min(top_k, len(candidates['ids'])), include=['metadatas', 'distances'])
        for iid, meta, distance in zip(result['ids'][0], result['metadatas'][0], result['distances'][0]):
            errors.append({**(meta or {}), 'case_id': iid, 'distance': float(distance)})
    return {'drawing_id': drawing_id, 'item_id': item_id, 'revision': snapshot['revision'],
            'result_type': 'candidate', 'errors': errors}
