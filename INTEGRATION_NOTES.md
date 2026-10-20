# main + jm_ocr 통합

## 기준과 방식

- 작업 폴더: `C:\HW-dev`, 작업 브랜치: `integration-dev`.
- fetch 후 기준: `origin/main` = `8e20a9de6804ab43f4fe9af7ba08e4b9d3b2baaf`.
- 통합 대상: `origin/jm_ocr` = `b46e1fba5903e0ead414298f1b8116f723aa5307`.
- 공통 이력이 없는 두 트리를 전체 merge하지 않고 main 위에 기능을 이식했다. 병합 진행 상태나 병합 커밋은 없다. `combined_ocr`는 사용하지 않았다.
- 커밋, push, PR 생성, 로컬 main 브랜치 이동은 하지 않았다.

## 코드·API·데이터 비교와 결합

| 영역 | main | jm_ocr | 통합 결과 |
| --- | --- | --- | --- |
| OCR 실행 | app_auto, CPU 작업 큐, 상태 polling, JPG 저장·좌표 검증 | 정적 도면 및 PNG 샘플 중심 | main 실행기·JPG 검증·polling 유지 |
| 측정 입력 | MeasurementEntry, SQLite measurement_records | 데모 도면별 브라우저 저장 | 기존 데모 유지, 등록 도면의 실측 입력과 서버 저장 연결 |
| 오류 등록·검색 | 포인트별 등록, 임베딩, 검색, 재색인 | 정적 오류 사례 | main 유지, 누락된 포인트 이력 조회와 중복 요청 처리 보완 |
| 검수 | ocr_review TXT 엔진은 있으나 앱 연결 누락 | 치수 수정, 항목 목록 submit, 결과 다운로드, 누적 기록 | jm_ocr 엔진/API 이식 및 app.py에 router 연결 |
| 관리자 화면 | 없음 | 대규모 정적 데모 App 및 localStorage overlay | main App에 등록 도면용 DrawingReviewPanel 결합 |
| 수정 결과 | OCR JSON·이미지·revision | TXT 결과·파일 이력과 브라우저 overlay | 등록 도면은 SQLite에 전후 JSON·검토자·시각·버전 저장, TXT API는 기존 형식 유지 |
| 뷰어 | 선택·확대·이동 및 좌표 크기 검사 | 화면 맞춤, 마커 anchor, 강조선·위치 선택 지원 | jm 뷰어 기능 이식, CPU 진행 표시와 main의 크기 검증 유지 |

jm_ocr의 App.tsx 전체를 대체하면 main의 CPU OCR polling과 등록 도면 작업 흐름이 사라지므로 화면은 기존 App에 결합했다. jm_ocr의 정적 데모 이미지 묶음·로컬 업로드 우회·pdfjs 의존성은 가져오지 않았다. package.json/package-lock.json은 main 그대로이며 런타임 의존성을 추가하지 않았다.

`ocr_api.py`의 도면별 조회·검색과 `ocr_results.py`의 JPG 저장·검증은 유지한다. 새 `ocr_review/drawing_api.py`가 동일한 ocr_results 레코드를 트랜잭션으로 수정하므로 두 API가 수정된 원문과 공차를 함께 사용한다. 이미지 바이트는 보존하고 URL revision만 새 버전에 맞춘다.

## 사용

기존 CPU 서버 진입점은 `backend`에서 `python -m uvicorn app_auto:app --host 127.0.0.1 --port 8000`이다. 이 앱은 app.py의 검수·측정·오류 router도 사용한다.

1. 등록 도면을 선택하고 CPU OCR 완료를 기다린다.
2. 오른쪽의 **관리자 편집**을 열고 검토자를 입력한다.
3. 도면/표에서 항목을 선택해 인식값, 기준 치수, 상·하한, 형상·공차 유형을 수정한다.
4. 각 항목의 인식값·공차·좌표를 확인한다. 모든 항목을 확인하면 **검토 완료**가 활성화된다.
5. **수정 저장**은 미완료 검토로 저장하며 수정 항목의 자동 판정을 보류한다. **검토 완료**는 전 항목 확인을 서버에서도 검사한다.
6. **수정 이력 보기**에서 검토자·시각·항목별 전후 정보를 확인한다.

등록 도면 API:

- `POST /api/drawings/{id}/ocr/review`: revision, reviewer, edits, confirmed_ids, complete.
- `GET /api/drawings/{id}/ocr/reviews`: 검토 이력.
- jm_ocr의 `/api/ocr-review/review`, `/submit`, `/apply`, `/result/...`, `/history`도 유지한다.

## 검증

- Windows PowerShell / Git 2.42.0.windows.2 사용, fetch 성공.
- `frontend`: `npm ci`, `npm run build`, `npm run lint` 성공.
- `backend`: 전체 unittest **48개 통과**, Python compileall 성공.
- `git diff --check` 성공. Git의 LF→CRLF 안내는 있으나 공백 오류는 없다.
- 테스트 범위: TXT 검수·치수 수정·추가·파일 이력, 등록 도면 검토 저장, 이미지 연결, 새 버전 검색·실측 판정, 미완료 검토 판정 보류, 잘못된 수정/미확인 완료 거부, 오래된 버전 충돌, 이전 실측값 보존, 오류 등록 중복 방지·재색인·이력, CPU 큐의 저장 결과 재사용 및 TXT→JSON 변환.
- 기존 OCR 테스트가 중단된 PNG 샘플 API를 기대해 현재 JPG 저장 계약으로 갱신했다. Windows 기본 cp949 대신 fixture를 UTF-8로 명시했다.
- 누락된 타입을 보완해 TypeScript 검사를 통과시켰고 Vite 설정의 `__dirname` 경고를 제거했다.

테스트 재실행 (설치한 테스트 의존성은 이 작업 폴더의 `.test-deps`에만 위치):

```powershell
$env:PYTHONPATH='C:\HW-dev\.test-deps'
python -X utf8 -m unittest discover -s backend/tests -v
```

## 남은 제약

- 실제 eDOCr2 추론은 실행하지 못했다. 이 worktree에 `.venv-ocr`가 없고 TensorFlow/OCR 실행 환경을 설치하지 않았다.
- 실제 검색 서버 시작/모델 임베딩/Chroma 검색은 검증하지 못했다. 현재 환경에 sentence-transformers·chromadb와 backend/vector_db가 없어 API 테스트는 모델·컬렉션 대역을 사용했다.
- 브라우저 화면을 실제 조작한 E2E 검증은 하지 않았다. 프론트 빌드·타입 검사와 서버 API 통합 테스트를 수행했다.
- 관리자 전환은 jm_ocr와 동일하게 UI 모드이며 계정 인증·권한 제어 기능은 아니다.
- 검토 저장 시 새 OCR revision을 만든다. 이전 실측값·오류 보고는 SQLite에 보존하며 현재 버전으로 자동 복사하지 않는다. 과거 버전을 탐색하는 별도 화면은 없다.
- 등록 도면 검토 결과는 SQLite JSON 이력이고, TXT 검수 API의 결과 파일/CSV와는 별도 저장 형식이다.
- 정적 데모 도면 모음, 도면 클릭으로 누락 치수 추가 등 jm_ocr 전체 데모 UI를 그대로 이식한 것은 아니다. TXT 엔진의 치수 추가는 유지되며 등록 도면 UI는 기존 항목 수정·검토·이력을 지원한다.
- 테스트 의존성에서 Starlette의 HTTPX 사용 중단 예정 경고가 발생하지만 테스트 실패는 없다.
