# hanwha-engine-dx
한화엔진 DX Academy | 도면 기반 측정 업무 지원 시스템
<img width="2172" height="724" alt="image" src="https://github.com/user-attachments/assets/e842be59-3f77-4019-a433-7b1d10ec7e37" />


## Overview

설계도면의 측정 정보를 구조화하고, 측정 위치·검사 기준·과거 오류사례를 연결하는 품질 업무 지원 프로젝트.


| 구성원 | 역할 |
| --- | --- |
| 박수정 | eDOCr2 |
| 마서진 | overall system build |
| 이도연 | frontend |
| 이종민 | system validation & finalize |
| 한동현 | mechanical drawing  |

## Scope

| 영역 | 주요 기능 |
| --- | --- |
| 도면 분석 | 치수·공차·기하공차 추출 및 항목화 |
| 측정 가이드 | 도면 마커와 측정항목 연동 |
| 품질 지식 | 항목별 오류사례 및 주의사항 조회 |
| 검사 기록 | 측정값 입력·판정·이력 관리 |

## Workflow

부품 조회 → 도면 분석 → 측정 기준 확인 → 검사 수행 → 결과 기록

## Tech Stack

React · Vite · Tailwind CSS · shadcn/ui  
Python · FastAPI · SQLite · Chroma(E5 임베딩) · eDOCr2

## 폴더 구성

| 폴더 | 역할 | Git 공유 |
| --- | --- | --- |
| `frontend/` | 화면 (React) | 공유 |
| `backend/` | API 서버 · 오류사례 저장소 · OCR 연결 · 도구 | 코드만 공유 |
| `backend/storage/` | 공통 SQLite · 업로드 · OCR 결과 | **로컬 전용** |
| `backend/vector_db/` | Chroma 벡터DB (목적별 오류사례 검색) | **로컬 전용** |
| `data/` | 입력 원본(도면·오류 엑셀)과 공유 샘플, 검토 산출물 | 원본·샘플만 공유 |
| `edocr2/` | eDOCr2 OCR 엔진 (자동 OCR 이 실행) | 공유 (모델 가중치 제외) |
| `docs/` | 문서 | 공유 |

파일별 역할, 데이터 흐름, 공유/로컬 구분은 **[docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)** 에 정리했다.
엑셀·도면을 넣을 위치는 [data/README.md](data/README.md) 를 본다.

> **코드를 pull 해도 DB 는 따라오지 않는다.** `backend/storage/`(SQLite·업로드)와 `backend/vector_db/`(Chroma)는 PC 마다 따로 만든다.
> 새 PC 에서는 아래 「새 PC 에서 DB 준비」를 따른다.

## 실행

### 1. 가상환경과 의존성 (최초 1회)

```powershell
# 백엔드 (Python 3.12)
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 프론트엔드 (Node.js)
cd ..\frontend
npm install
```

자동 OCR(도면 업로드 시 eDOCr2 실행)은 별도 환경 `.venv-ocr`(Python 3.10, 저장소 최상위)와 Tesseract·Poppler 가 필요하다.
`edocr2/requirements.txt` 로 `.venv-ocr` 를 만든다. 경로가 다르면 환경변수 `OCR_PYTHON`, `OCR_TESSERACT`, `OCR_POPPLER` 로 지정한다.

### 2. 서버 실행

```powershell
# 백엔드 (backend 폴더에서) — 업로드 시 자동 OCR 포함
.venv\Scripts\python.exe -m uvicorn app_auto:app --host 127.0.0.1 --port 8000

# 자동 OCR 없이 화면·검색만 확인할 때
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000

# 프론트엔드 (frontend 폴더에서) → http://localhost:3000
npm run dev
```

`--workers` 는 쓰지 않는다 (단일 프로세스). 같은 `storage/`·`vector_db/` 를 쓰는 서버를 두 개 띄우지 않는다.

### 3. 오류사례 엑셀 적재 (목적별)

작업 페이지(부품제작·조립·검증)마다 오류사례 저장소가 따로 있다. 엑셀을 `data/<목적>/` 에 넣고 **서버를 멈춘 상태에서** 적재한다.

```powershell
cd backend
# 파일 하나
.venv\Scripts\python.exe -m purpose_errors.ingest --purpose manufacturing --file ..\data\manufacturing\RAGFlow_피스톤로드_가공_오류DB.xlsx
# data/<목적>/ 의 엑셀 전부
.venv\Scripts\python.exe -m purpose_errors.ingest --purpose manufacturing --all
.venv\Scripts\python.exe -m purpose_errors.ingest --purpose verification --all
```

- `--purpose` 는 `manufacturing` · `assembly` · `verification` 중 하나이며 반드시 지정한다.
- 같은 `case_id` 는 갱신된다. 여러 파일에 같은 `case_id` 가 있으면 아무것도 저장하지 않고 멈춘다.
- 시트 이름은 `오류주의사항DB`, 필수 컬럼은 `case_id`, `case_title`, `search_text` 이다.

## 새 PC 에서 DB 준비

1. 위 「가상환경과 의존성」을 마친다.
2. **기존 DB 를 옮겨 쓸 때**: 원래 PC 에서 서버를 멈추고 `backend\tools\backup_local_data.py --backup` 으로 백업한 뒤,
   백업 폴더의 `storage\`, `vector_db\` 를 새 PC 의 `backend\` 아래에 복사한다. 복사 후 `--verify <백업 폴더>` 로 건수·ID 를 비교한다.
3. **새로 시작할 때**: 서버를 한 번 실행하면 빈 `storage/library.sqlite3` 와 빈 목적별 컬렉션이 만들어진다.
   서버를 멈추고 위 「오류사례 엑셀 적재」로 목적별 엑셀을 적재한다. 도면은 화면에서 업로드한다.

## 백업 · 복구

```powershell
cd backend
.venv\Scripts\python.exe tools\backup_local_data.py --manifest          # 현재 테이블·컬렉션 건수와 ID 해시 (읽기 전용)
.venv\Scripts\python.exe tools\backup_local_data.py --backup            # 서버를 멈춘 뒤 실행 → ..\backups\local-data-<시각>\
.venv\Scripts\python.exe tools\backup_local_data.py --verify ..\backups\local-data-<시각>
```

- 서버가 켜져 있으면 백업을 거부한다. 실행 중인 DB 폴더를 복사한 것은 정상 백업이 아니다.
- **복구**: 서버를 멈추고, 현재 `backend\storage`·`backend\vector_db` 를 다른 이름으로 옮겨 둔 뒤,
  백업 폴더의 `storage`·`vector_db` 를 `backend\` 로 복사한다. `--verify` 로 확인한 다음 서버를 실행한다.
- 검토 산출물(`data/origin`, `data/reviewed`, `data/logs` 의 도면 ID 이름 파일과 `review_history.csv`)은 이 백업에 들어가지 않으므로 필요하면 함께 복사한다.

## 측정 기록의 작업 목적

측정값·판정·완료 수·이력은 작업 페이지(부품제작·조립·검증)마다 따로 저장된다.
목적 구분 전에 저장된 기록은 서버를 새 코드로 처음 실행할 때 `unclassified`(미분류)로 보존되며 화면에는 나오지 않는다.
어느 목적의 기록인지 확인한 뒤 아래 명령으로 옮긴다 (기본은 미리보기, 이미 그 목적에 기록이 있으면 덮어쓰지 않고 중단).

```powershell
cd backend
.venv\Scripts\python.exe tools\assign_measurement_purpose.py --list
.venv\Scripts\python.exe tools\assign_measurement_purpose.py --purpose verification --drawing <도면ID> --item DIMENSION_001
.venv\Scripts\python.exe tools\assign_measurement_purpose.py --purpose verification --drawing <도면ID> --all-items --apply
```

## 테스트

```powershell
cd backend
.venv\Scripts\python.exe -m unittest discover -s tests      # 임시 SQLite·Chroma 만 사용
cd ..\frontend
npx tsc --noEmit; npm run build
```

## Status

MVP 개발 진행 중
<img width="1308" height="825" alt="image" src="https://github.com/user-attachments/assets/4c0cd01d-e6a6-4c34-a8ba-706338a4c674" />
