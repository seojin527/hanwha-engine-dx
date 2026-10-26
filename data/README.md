# data/ — 입력 원본 · 공유 샘플 · 검토 산출물

이 폴더에는 **사람이 넣는 원본**(도면 PDF, 오류사례 엑셀), **함께 쓰는 샘플**(HDH_63_xx), 그리고
**서버가 만드는 검토 산출물**이 함께 있다. 코드는 두지 않는다 (변환 도구는 `backend/tools/ocr_to_metadata/`).

경로는 모두 `backend/paths.py` 에 정의돼 있다. 폴더 이름을 바꾸려면 그 파일을 고친다.

## 원본을 넣는 곳

| 폴더 | 넣는 것 | 쓰는 곳 |
| --- | --- | --- |
| `manufacturing/` | 부품제작 오류사례 엑셀 (`*.xlsx`) | `python -m purpose_errors.ingest --purpose manufacturing --all` |
| `assembly/` | 조립 오류사례 엑셀 (아직 없음) | `... --purpose assembly --all` |
| `verification/` | 검증 오류사례 엑셀 | `... --purpose verification --all` |
| `input/` | eDOCr2 로 직접 돌릴 도면 PDF (`HDH_63_01.pdf` …) | `edocr2/test_drawing_cpu.py` |

오류사례 엑셀 형식: 시트 `오류주의사항DB`, 필수 컬럼 `case_id` · `case_title` · `search_text`.
나머지 컬럼은 `backend/purpose_errors/schemas/<목적>.py` 의 `RECORD_FIELDS` 를 따른다 (없으면 빈 값).
같은 목적 안에서 `case_id` 가 겹치면 적재를 멈춘다. 적재는 서버를 멈춘 상태에서 한다.

화면에서 업로드하는 도면은 이 폴더가 아니라 `backend/storage/uploads/` 에 저장된다.

## 보존용 원본

| 폴더 | 내용 |
| --- | --- |
| `error_cases/` | 기존 공통 오류 DB(`error_cases` 테이블 · `error_cases_e5_small_v1` 컬렉션)의 원본 엑셀. 목적별 이관 확인 전까지 보존한다. 화면 검색에는 쓰지 않는다. |

## 공유 샘플 (테스트·시연)

| 파일 | 쓰는 곳 |
| --- | --- |
| `1_image.png`, `1_metadata.json`, `1_metadata_origin.json`, `1_origin.txt` | 이전 단일 도면 API(`/api/drawing`), OCR 결과 테스트 |
| `normalized/<이름>_metadata.json` | 변환 결과 샘플 (`tools/ocr_to_metadata` 가 `reviewed/` 에서 만든다), 테스트 |
| `origin/HDH_63_NN_origin.txt`, `_result.jpg` | eDOCr2 원문·색칠 결과 샘플 |
| `reviewed/HDH_63_NN_reviewed.txt`, `.jpg` | 검토 완료 샘플 |
| `logs/HDH_63_NN_*` | 검토 로그 샘플 |

## 서버가 만드는 파일 (직접 수정하지 않음 · Git 공유 안 함)

관리자 검토와 자동 OCR 은 업로드 도면 ID(UUID) 이름으로 아래 파일을 만든다.
같은 PC 의 `backend/storage/library.sqlite3` 와 짝이 맞을 때만 의미가 있어서 `.gitignore` 로 제외한다.

| 위치 | 파일 이름 규칙 | 만드는 곳 |
| --- | --- | --- |
| `origin/` | `<도면ID>_origin.txt`, `<도면ID>_result.jpg` | 자동 OCR (`backend/ocr_jobs.py`) |
| `reviewed/` | `<도면ID>_<revision>_reviewed.txt/.jpg` | 관리자 검토 저장 (`backend/ocr_review`) |
| `logs/` | `<도면ID>_<revision>_review_log.*`, `_edits_log.jpg` | 관리자 검토 저장 |
| `logs/review_history.csv` | 누적 검토 이력 | 관리자 검토 저장 |
| `origin/cpu-<시각>/` | 수동 CPU OCR 실행 결과 | `edocr2/test_drawing_cpu.py` |

이 파일들은 `backend/tools/backup_local_data.py` 백업에 들어가지 않는다. PC 를 옮길 때는 함께 복사한다.

## 변환 도구 (검토 TXT → 메타데이터 JSON)

```powershell
cd backend
.venv\Scripts\python.exe tools\ocr_to_metadata\ocr_to_metadata.py HDH_63_05
# data\reviewed\HDH_63_05_reviewed.txt → data\normalized\HDH_63_05_metadata.json
```

서버의 자동 OCR·검토는 이 도구가 아니라 `backend/ocr_metadata.py` 를 쓴다.
