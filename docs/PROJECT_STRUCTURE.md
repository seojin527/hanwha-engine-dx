# 프로젝트 구조

이 문서는 **현재 저장소에 실제로 있는 구조**를 정리한 것이다 (2026-10-26, `cleanup/backend-data` 브랜치 기준).
향후 제안은 맨 아래 「향후 제안」에만 적는다.

## 표시 규칙

| 표시 | 뜻 |
| --- | --- |
| `[코드]` | 소스 코드 |
| `[입력 원본]` | 사람이 넣는 원본 (도면 PDF, 오류사례 엑셀) |
| `[자동 생성]` | 서버·도구가 실행 중에 만드는 파일 |
| `[DB]` | SQLite · Chroma 저장소 |
| `[샘플]` | 테스트·시연용으로 함께 쓰는 고정 파일 |
| `[문서]` | 설명 문서 |
| 🔒 **로컬** | Git 으로 공유하지 않음 (PC 마다 따로 생김, `.gitignore`) |
| (표시 없음) | Git 으로 공유 |

모든 저장 위치는 [`backend/paths.py`](../backend/paths.py) 한 곳에서 정한다. 서버를 어느 폴더에서 실행해도 같은 위치를 쓴다.

## 최상위

```
HW/
├─ README.md                       [문서] 실행·적재·백업 안내 (이 문서로 연결)
├─ docs/
│  └─ PROJECT_STRUCTURE.md         [문서] 이 문서
├─ backend/                        [코드] API 서버, 저장소, 도구 → 아래 상세
├─ data/                           [입력 원본][샘플][자동 생성] → 아래 상세
├─ frontend/                       [코드] React 화면 → 아래 (오류 DB 관련 파일 중심)
├─ edocr2/                         [코드] eDOCr2 OCR 엔진 (자동 OCR 이 test_drawing_cpu.py 를 실행)
│  └─ edocr2/tools/models/*.keras  🔒 로컬 — 모델 가중치 (용량이 커서 별도 배포)
├─ ragflow/                        [코드] RAGFlow 소스 (현재 서버와 연결되지 않음)
├─ convert_weights.py              [코드] eDOCr2 가중치 변환 스크립트
├─ gpu_requirements.txt            [문서] GPU OCR 환경 패키지 목록 (pip freeze)
├─ .venv-ocr/                      🔒 로컬 — 자동 OCR 용 Python 3.10 환경
└─ backups/                        🔒 로컬 — tools/backup_local_data.py 가 만드는 DB 백업
```

## backend/

```
backend/
├─ README.md                    [문서] 관리자 검토(ocr_review) 상세 설명
├─ requirements.txt             [문서] 서버 의존성 (Python 3.12)
├─ paths.py                     [코드] ★ 모든 파일·DB 위치 설정
│
├─ app.py                       [코드] FastAPI 앱 · 시작 시 테이블·컬렉션 준비 · 라우터 연결
├─ app_auto.py                  [코드] app + 업로드 시 자동 CPU OCR (운영 실행: uvicorn app_auto:app)
│
├─ drawing_library.py           [코드] 부품·도면 등록/조회/삭제 · SQLite 연결(database())
├─ ocr_jobs.py                  [코드] 자동 OCR 작업 큐 · eDOCr2 하위 프로세스 실행
├─ ocr_metadata.py              [코드] eDOCr2 TXT → 화면용 JSON 변환 (서버가 쓰는 변환기)
├─ general_tolerance.py         [코드] 일반공차 ISO 2768-m
├─ ocr_results.py               [코드] OCR 결과(JSON·이미지) 저장·조회 · revision 관리
├─ ocr_api.py                   [코드] OCR 결과 조회 API · 기존 공통 오류 검색 API(보존)
├─ measurement_api.py           [코드] 측정값 저장·판정·조회
├─ ocr_review/                  [코드] 관리자 검토 (검토 화면 API · 결과 파일 · 수정 이력)
│  ├─ api.py                      검토 API (/api/ocr-review/...)
│  ├─ review.py, txt_format.py    검토 규칙 · eDOCr2 TXT 읽기/고쳐 쓰기
│  ├─ files.py, logs.py           결과·로그 파일 저장 (data/reviewed, data/logs)
│  ├─ render.py                   결과 이미지 (reviewed.jpg, edits_log.jpg)
│  └─ __main__.py                 명령줄 검토 (python -m ocr_review)
│
├─ purpose_errors/              [코드] ★ 목적별(제작·조립·검증) 오류사례 저장소 — 화면이 쓰는 것
│  ├─ purposes.py                 목적 → 원문 테이블 · 연결 기록 테이블 · 컬렉션 · 스키마
│  ├─ schemas/
│  │  ├─ manufacturing.py         부품제작 원문 스키마·입력 검증 (독립 수정)
│  │  ├─ assembly.py              조립 원문 스키마·입력 검증 (독립 수정)
│  │  └─ verification.py          검증 원문 스키마·입력 검증 (독립 수정)
│  ├─ store.py                    원문·연결 기록 SQLite 처리 (공통)
│  ├─ vectors.py                  E5 임베딩 · Chroma 반영 · 검색 (공통)
│  ├─ api.py                      /api/purposes/{목적}/... 등록·조회·재시도·연결 기록·검색
│  ├─ ingest.py                   엑셀 적재 (단일 --file / 일괄 --all)
│  └─ migrate_legacy.py           기존 공통 오류 → 목적 저장소 이관 (기본 미리보기)
│
├─ error_case_store.py          [코드] 기존 공통 오류 원문(error_cases) · 기존 컬렉션 접근 (보존용)
├─ error_case_api.py            [코드] 기존 공통 오류 등록 API /api/error-cases (보존, 화면 미사용)
├─ point_error_api.py           [코드] 기존 공통 포인트 연결 API (보존, 화면 미사용)
│
├─ tools/
│  ├─ backup_local_data.py      [코드] storage/·vector_db/ 백업 · 건수·ID 비교
│  └─ ocr_to_metadata/          [코드] 팀 변환기 (명령줄 전용, 서버 미사용)
│     ├─ ocr_to_metadata.py       data/reviewed/<이름>_reviewed.txt → data/normalized/<이름>_metadata.json
│     ├─ gdt_metadata.py          기하공차 파서
│     └─ titleblock_metadata.py   표제란 파서
│
├─ demo/                        [코드][샘플] 검토 시연 (check.py, samples/HDH_6x_x_origin.txt·_result.jpg, 시연방법.md)
├─ tests/                       [코드] 단위·통합 테스트 (임시 SQLite·Chroma 만 사용)
│  ├─ test_purpose_errors.py      목적별 저장소 격리 · 적재 · 이관 · 시작
│  ├─ test_ocr_review.py, test_review_log.py, test_general_tolerance.py
│  ├─ test_ocr_results.py, test_point_ui.py
│  ├─ test_gdt_metadata.py, test_titleblock_metadata.py   (tools/ocr_to_metadata 테스트)
│  └─ fixtures/                 [샘플] HDH_6x_x_origin.txt, _edits.json 등
│
├─ .venv/                       🔒 로컬 — 서버 가상환경
├─ logs/                        🔒 로컬 [자동 생성] save=false 검토 때만 생김 (지금은 없음)
│
├─ storage/                     🔒 로컬 [DB][자동 생성]
│  ├─ library.sqlite3           [DB] 공통 SQLite (아래 표)
│  ├─ uploads/<도면ID>.pdf|png|jpg        업로드 원본 (DB drawings.stored_filename 에 파일명만 저장)
│  ├─ ocr_results/<32자리 hex>.jpg        화면용 OCR 결과 이미지 (DB ocr_results.image_filename)
│  ├─ ocr_jobs/<작업ID>/                  자동 OCR 작업 폴더: <도면ID>_origin.txt, _result.jpg, metadata.json, run.log
│  ├─ environment-verification/           이전 환경 검증 산출물 (서버 미사용, 아래 「정리 보류」)
│  └─ ui-verification/                    이전 화면 검증 산출물 (서버 미사용, 아래 「정리 보류」)
│
└─ vector_db/                   🔒 로컬 [DB] Chroma (chroma.sqlite3 + 컬렉션별 바이너리 폴더)
```

### SQLite `backend/storage/library.sqlite3` 의 테이블

| 구분 | 테이블 | 비고 |
| --- | --- | --- |
| 공통 | `parts`, `drawings` | 부품·도면 (파일은 storage/uploads) |
| 공통 | `ocr_results`, `ocr_jobs` | OCR 결과 JSON · revision · 작업 상태 |
| (미사용) | `drawing_workflow`, `drawing_workflow_history` | 현재 코드가 읽거나 쓰지 않는 이전 테이블 (0건). 삭제하지 않고 둠 |
| 목적별 | `measurement_records`, `measurement_attempts` | 측정값 · 측정 이력. `work_purpose`(manufacturing·assembly·verification)로 구분하며 기본키는 (도면, OCR revision, 목적, 항목). 목적 구분 전 기록은 `unclassified` 로 보존 |
| 목적별 | `manufacturing_error_cases`, `manufacturing_point_error_reports` | 부품제작 오류 원문 · 도면 포인트 연결 기록 |
| 목적별 | `assembly_error_cases`, `assembly_point_error_reports` | 조립 |
| 목적별 | `verification_error_cases`, `verification_point_error_reports` | 검증 |
| 기존(보존) | `error_cases`, `point_error_reports` | 기존 공통 오류 DB. 이관 확인 전까지 보존, 화면 미사용 |

### Chroma `backend/vector_db/` 의 컬렉션

| 컬렉션 | 원문 테이블 | 사용 |
| --- | --- | --- |
| `manufacturing_errors_v1` | `manufacturing_error_cases` | 부품제작 페이지 검색 |
| `assembly_errors_v1` | `assembly_error_cases` | 조립 페이지 검색 |
| `verification_errors_v1` | `verification_error_cases` | 검증 페이지 검색 |
| `error_cases_e5_small_v1` | `error_cases` (+ 벡터에만 있는 32건) | 기존(보존). 없어도 서버는 시작되고 이전 API 만 503 |

임베딩 모델은 공통으로 `intfloat/multilingual-e5-small` 을 쓴다 (`purpose_errors/vectors.py`).

## data/

```
data/
├─ README.md                    [문서] 원본을 넣는 곳 · 파일 규칙
├─ manufacturing/*.xlsx         [입력 원본] 부품제작 오류 엑셀 4개 (RAGFlow_<부품>_가공_오류DB.xlsx)
├─ assembly/                    [입력 원본] 조립 오류 엑셀 자리 (현재 비어 있음, .gitkeep)
├─ verification/*.xlsx          [입력 원본] 검증 오류 엑셀 5개 (RAGFlow_<부품>_오류DB.xlsx)
├─ error_cases/*.xlsx           [입력 원본] 기존 공통 오류 DB 의 원본 2개 (보존)
├─ input/HDH_63_NN.pdf          [입력 원본] eDOCr2 로 직접 돌릴 도면 PDF (NN = 01~10)
├─ 1_image.png · 1_metadata.json · 1_metadata_origin.json · 1_origin.txt
│                               [샘플] 이전 단일 도면 API · 테스트
├─ normalized/<이름>_metadata.json      [샘플] 변환 결과 (1, HDH_63_01~10)
├─ origin/
│  ├─ HDH_63_NN_origin.txt, _result.jpg [샘플] eDOCr2 원문·색칠 결과
│  ├─ <도면ID>_origin.txt, _result.jpg  🔒 로컬 [자동 생성] 자동 OCR 이 검토용으로 복사
│  └─ cpu-<시각>/                       🔒 로컬 [자동 생성] 수동 CPU OCR 결과
├─ reviewed/
│  ├─ HDH_63_NN_reviewed.txt, .jpg      [샘플] 검토 완료 결과
│  └─ <도면ID>_<revision>_reviewed.*    🔒 로컬 [자동 생성] 관리자 검토 저장 결과
└─ logs/
   ├─ HDH_63_NN_review*.json/.txt, _edits*.json/.jpg   [샘플] 검토 로그
   ├─ <도면ID>_<revision>_review_log.*, _edits_log.jpg 🔒 로컬 [자동 생성] 관리자 검토 로그
   └─ review_history.csv                               🔒 로컬 [자동 생성] 누적 검토 이력
```

`<도면ID>` 는 업로드할 때 만들어지는 UUID 이다 (예: `e6c2300a-…`). 같은 PC 의 DB 와 짝이 맞을 때만 의미가 있어서 공유하지 않는다.

## frontend/ (오류 DB 연결 관련 파일 중심)

```
frontend/
├─ src/
│  ├─ App.tsx                          [코드] 진입 흐름 · 공통 상태 · 관리자 검토 · 작업 페이지 전환
│  ├─ pages/
│  │  ├─ ManufacturingPage.tsx         [코드] 부품제작 작업 페이지 → ManufacturingPanel
│  │  ├─ AssemblyPage.tsx              [코드] 조립 작업 페이지 → AssemblyPanel
│  │  ├─ VerificationPage.tsx          [코드] 검증 작업 페이지 → VerificationPanel
│  │  └─ workspaceTypes.ts, WorkspaceShared.tsx
│  ├─ components/
│  │  ├─ ManufacturingPanel.tsx        [코드] PURPOSE='manufacturing' 로 검색·등록
│  │  ├─ AssemblyPanel.tsx             [코드] PURPOSE='assembly'
│  │  ├─ VerificationPanel.tsx         [코드] PURPOSE='verification'
│  │  ├─ PointErrorForm.tsx            [코드] 목적별 등록 폼 (항목은 lib/errorForms)
│  │  └─ … (도면 뷰어 · 측정 · 관리자 검토 · 3D 등)
│  └─ lib/
│     ├─ purpose.ts                    [코드] 작업 목적 타입
│     ├─ drawingAPI.ts                 [코드] fetchItemErrors(목적, …) → /api/purposes/{목적}/…/errors
│     ├─ pointAPI.ts                   [코드] 등록·이력·재시도 → /api/purposes/{목적}/…
│     └─ errorForms/{manufacturing,assembly,verification}.ts  [코드] 목적별 등록 폼 항목
├─ public/engine-viewer/, images/      [샘플] 3D 뷰어 · 데모 도면 이미지
├─ node_modules/                       🔒 로컬
└─ dist/                               🔒 로컬 [자동 생성] npm run build 결과
```

API 주소는 `frontend/src/lib/drawingAPI.ts` 의 `API_BASE` (`http://127.0.0.1:8000`).

## 데이터 흐름

### 1. 도면 업로드 → OCR → 관리자 검토 → 결과 저장

```
[화면] 도면 업로드
  └─ POST /api/parts/{부품}/drawings (app_auto)
       ├─ backend/storage/uploads/<도면ID>.pdf 저장 · drawings 행 추가
       └─ OCR 작업 등록 (ocr_jobs 테이블)
[OcrWorker] (ocr_jobs.py)
  └─ .venv-ocr + edocr2/test_drawing_cpu.py 실행
       ├─ storage/ocr_jobs/<작업ID>/<도면ID>_origin.txt, _result.jpg, run.log
       ├─ ocr_metadata.convert() → metadata.json
       ├─ data/origin/<도면ID>_origin.txt, _result.jpg 로 복사 (검토용)
       └─ save_ocr_result(): ocr_results 행(JSON·revision) + storage/ocr_results/<hex>.jpg
[화면] OCR 결과 조회  GET /api/drawings/{도면ID}/ocr , /ocr/image
[화면·관리자] 검토     GET/POST /api/ocr-review/drawing/{도면ID}
  └─ 검토 완료 저장
       ├─ data/reviewed/<도면ID>_<revision>_reviewed.txt/.jpg
       ├─ data/logs/<도면ID>_<revision>_review_log.* , _edits_log.jpg , review_history.csv
       └─ ocr_results 갱신 (save_reviewed_items: 새 revision, 검토자·review_history 를 JSON 에 기록)
[화면] 결과 파일 목록·다운로드  GET /api/ocr-review/drawing/{도면ID}/files
[화면·작업자] 측정 저장  POST /api/drawings/{도면ID}/items/{항목}/measurement (본문 work_purpose 필수)
                          → measurement_records/_attempts (그 목적의 행만 저장·갱신)
[화면] 측정 조회        GET /api/drawings/{도면ID}/measurements?revision=&purpose=<목적>
[화면] 측정 이력        GET /api/drawings/{도면ID}/items/{항목}/measurement-attempts?revision=&purpose=<목적>
```

### 2. 목적별 오류 엑셀 → SQLite → 임베딩 → Chroma → 화면 검색

```
data/<목적>/*.xlsx  (시트 '오류주의사항DB')
  └─ python -m purpose_errors.ingest --purpose <목적> --all
       ├─ schemas/<목적>.py 로 행 검사·정리 (파일 간 case_id 중복이면 중단)
       ├─ <목적>_error_cases 에 원문 저장 (같은 case_id 는 갱신, vector_status='pending')
       ├─ E5 임베딩 ("passage: " + search_text)
       └─ <목적>_errors_v1 컬렉션에 upsert → vector_status='ready' (실패 시 'failed', 원문 보존)
[화면] 작업 페이지(부품제작·조립·검증)에서 측정항목 선택
  └─ <목적>Panel → GET /api/purposes/<목적>/drawings/{도면ID}/items/{항목}/errors
       ├─ 도면 소속 부품 + 형상으로 후보 범위 지정 (schemas/<목적>.py search_filter)
       ├─ E5 임베딩 ("query: " + 검색 문장)
       └─ <목적>_errors_v1 에서만 검색 (비어 있으면 빈 목록, 다른 컬렉션으로 대체하지 않음)
[화면] 오류사례 등록 (PointErrorForm)
  └─ POST /api/purposes/<목적>/drawings/{도면ID}/items/{항목}/error-cases
       ├─ <목적>_error_cases + <목적>_point_error_reports (도면·항목·OCR revision·항목 스냅샷)
       └─ <목적>_errors_v1 반영 (실패 시 POST /api/purposes/<목적>/error-cases/{case}/retry-index)
```

## Git 공유 기준

| 공유 (Git) | 로컬 전용 (`.gitignore`) |
| --- | --- |
| 코드 (`backend/`, `frontend/src`, `edocr2/`) | `backend/storage/`, `backend/vector_db/`, `backend/logs/` |
| 오류사례 엑셀 (`data/manufacturing`, `assembly`, `verification`, `error_cases`) | `data/` 안의 `<도면ID>_*` 검토 산출물, `data/logs/review_history.csv`, `data/origin/cpu-*/` |
| 도면 PDF·OCR·검토 샘플 (`HDH_63_NN_*`, `1_*`, `normalized/`) | `.venv/`, `.venv-ocr/`, `node_modules/`, `frontend/dist/`, `backups/` |
| 문서 (`README.md`, `docs/`, `data/README.md`) | eDOCr2 모델 가중치 (`*.keras`, `*.npz`) |

## 정리 보류 (판단 필요)

| 항목 | 상태 | 남긴 이유 |
| --- | --- | --- |
| `backend/storage/environment-verification/` (35MB), `ui-verification/` (21MB) | 서버·테스트가 참조하지 않음. 이전 검증 때의 vector_db 사본·스크립트·스크린샷 | 이전 검증 기록이라 임의 삭제하지 않음. 필요 없으면 직접 지우거나 `backups/` 로 옮긴다 |
| 기존 공통 오류 DB (`error_cases` 42건, `error_cases_e5_small_v1` 74건) · `error_case_api.py` · `point_error_api.py` · 이전 단일 도면 API | 화면 미사용. 목적별 저장소로 이관된 사례 0건 | 이관 확인 전까지 보존. 74건 중 32건은 벡터에만 있다 (`data/error_cases/RAGFlow_가상오류DB.xlsx` 출처) |
| `ragflow/` | 서버와 연결 없음 | 별도 실험용으로 보여 이번 범위에서 제외 |
| SQLite `drawing_workflow`, `drawing_workflow_history` | 현재 코드 참조 없음, 0건 | DB 구조 변경은 이번 범위 밖이라 그대로 둠 |

## 향후 제안 (아직 적용하지 않음)

- 기존 공통 오류 DB 를 목적별로 이관한 뒤 (`purpose_errors.migrate_legacy`), 이전 API 와 `error_cases` 를 정리한다.
- 서버가 `data/origin`·`data/reviewed`·`data/logs` 에 쓰는 검토 산출물을 `backend/storage/` 아래로 옮기면 공유 샘플과 로컬 산출물이 폴더로 나뉜다 (`paths.py` 와 기존 파일 이전 필요).
