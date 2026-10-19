# backend — OCR 결과 검수 (Human-in-the-loop)

```
도면.pdf ─▶ eDOCr2 (edocr2/test_drawing.py) ─▶ data/도면_origin.txt + data/도면_result.jpg
                                                   │  (TXT 그대로 입력)
                                                   ▼
                              [ocr_review]  작업자 검수 (기하공차 확정 + 빠진 치수 추가)
                                                   │
                                                   ▼
                     data/도면_reviewed.txt  (TXT 그대로 출력, 바뀐 줄만 다름)
                     data/도면_review_log.txt (이번 검수 기록) + logs/review_history.csv (누적 기록)
                                                   │
                                                   ▼
                                        data/ocr_to_metadata.py
```

- 시스템은 정답을 모른다. 기하공차 값은 **전부 작업자가 확정**하고, 숫자 모양이 아닌 값(예: `,.01`)만 `format_error`로 표시한다.
- 치수는 가정상 **인식된 값은 그대로 사용**한다. 못 읽은 치수는 작업자가 도면을 클릭해서 추가한다.
- `도면_reviewed.txt`는 원본 TXT의 **바뀐 줄만 고친다**. 그래서 원본 TXT를 읽던 코드는 그대로 읽을 수 있다.

## 폴더 구성

```
backend/
├─ ocr_review/          ✅ 실제 프로젝트 코드 (이것만 있으면 동작)
│   ├─ review.py          검사(형식 오류) + 작업자 수정 반영        ← 핵심
│   ├─ txt_format.py      eDOCr2 TXT 읽기 / 바뀐 줄만 고쳐 쓰기
│   ├─ logs.py            검수 기록 (이번 기록 TXT·JSON + 누적 CSV)
│   ├─ files.py           도면 이름으로 data 폴더에서 찾기, 결과 저장
│   ├─ render.py          결과 이미지 (reviewed.jpg / edits_log.jpg, 선택)
│   ├─ api.py             프론트 연결용 API (FastAPI)
│   └─ __main__.py        명령줄 실행 (review / apply)
├─ demo/                🎬 시연용 (지워도 프로젝트 코드는 멀쩡)
│   ├─ check.py           터미널에서 작업자처럼 검수
│   ├─ samples/           3도면 eDOCr2 결과 (TXT + 색칠 이미지)
│   ├─ 시연방법.md         실행법 + 정답 입력표
│   └─ output/            시연 결과 저장 (GitHub에 안 올라감)
└─ tests/               🔧 자동 테스트 (코드 고친 뒤 안 깨졌는지 확인)
    ├─ test_ocr_review.py
    └─ fixtures/          테스트용 TXT + 정답 수정 JSON
```

## 설치

표준 라이브러리만 쓴다 (Python 3.8+). 선택 기능만 추가 설치.

| 기능 | 필요 |
| --- | --- |
| 검수 (review / apply / 시연) | 없음 |
| `도면_reviewed.jpg`, `도면_edits_log.jpg` 생성 | `pip install pillow` (없으면 건너뜀) |
| API 서버 | `pip install fastapi uvicorn` |

## 실행 (backend 폴더에서)

### 🎬 시연

```powershell
python demo/check.py HDH_63_3 --frame-offset 56,56
```

자세한 방법과 정답 입력표: `demo/시연방법.md`

### ✅ 실제 프로젝트

eDOCr2 결과가 레포의 `data/` 폴더에 있으면 **도면 이름만** 주면 된다. 결과도 `data/`에 저장된다.

```powershell
# 1) 프론트에 줄 확인 목록 (도면_review.json)
python -m ocr_review review HDH_63_3

# 2) 작업자 수정 반영 → 도면_reviewed.txt + 검수 기록
python -m ocr_review apply HDH_63_3 도면_edits.json          # --json 붙이면 도면_reviewed.json 도 저장
```

API (프론트 연결): 팀 서버 `app.py`에 이미 붙어 있다 (`app.include_router(review_router)`). 혼자 켜볼 때는:

```powershell
uvicorn ocr_review.api:app --reload --port 8000
# POST /api/ocr-review/submit  {"name": "HDH_63_01", "items": [화면 항목], "reviewer": "관리자"}   ← 팀 화면이 쓰는 것
#   화면의 최종 항목 목록(GDT_001_1, DIMENSION_006, ADM1 …)을 원본 TXT와 비교해 확정·수정·추가를 계산 → apply(save) 와 같게 저장
# GET  /api/ocr-review/origin/HDH_63_01   → data/origin/HDH_63_01_origin.txt 내용
# POST /api/ocr-review/review  {"name": "HDH_63_01"}                    → 확인 목록 JSON (origin_txt를 직접 보내도 됨)
# POST /api/ocr-review/apply   {"name": "HDH_63_01", "edits": {...}, "save": true}
#   → {"reviewed_txt", "log", "log_text", "saved"(save일 때 저장한 파일)}
#   save: true → data/reviewed/(결과) + data/logs/(기록, edits.json) 에 저장 (명령줄과 같은 위치)
# GET  /api/ocr-review/history → 누적 기록 CSV
```

화면(관리자 체크리스트) → `edits` 연결표 (프론트 `src/lib/drawings/reviewApi.ts`)

| 화면 | edits | 예 |
| --- | --- | --- |
| 기하공차 항목 확인·수정 (전부) | `gdt: [{"item_id": "G01-1", "value": "0.0025"}]` | 화면 id `HDH_63_01-G01-1` → `G01-1` |
| OCR 치수의 "기준 치수" 수정 | `dimensions: [{"item_id": "D06", "value": "84", "kind": "length"}]` | 잘못 읽은 값 고치기 (5 → 84) |
| 치수 추가 | `added_dimensions: [{"value": "7", "kind": "length", "x": 1267, "y": 1103, "coord": "image"}]` | 못 읽은 치수 |
| 상한/하한 공차·측정기 | 보내지 않음 | OCR 결과가 아니라 검사 기준 |

### 🔧 테스트

```powershell
python -m unittest discover -s tests -v
```

## 결과와 기록

| 파일 | 내용 | 언제 |
| --- | --- | --- |
| `도면_reviewed.txt` | 고쳐진 TXT. 원본과 같은 형식 (바뀐 줄만 다름) | 항상 |
| `도면_reviewed.json` | 같은 결과를 정리한 JSON. 항목마다 출처(`ocr`/`edited`/`added`) | `--json` |
| `도면_review_log.txt` | 사람이 읽는 이번 검수 기록 (누가, 언제, 무엇을 → 무엇으로) | 항상 |
| `도면_review_log.json` | 같은 기록, 프로그램용 | 항상 |
| `logs/review_history.csv` | **모든 검수의 모든 항목이 계속 쌓임** (덮어쓰지 않음). 엑셀로 열기 | 항상 |
| `도면_reviewed.jpg` | 검수 끝난 도면. 색칠 결과 + **OCR이 못 읽어서 추가한 치수만** eDOCr2 치수 색으로 형광펜 (라벨 없음) | `도면_result.jpg`가 옆에 있으면 자동 |
| `도면_edits_log.jpg` | 수정 기록 이미지. OK(그대로 확정) / FIX(OCR값 → 고친값) / ADD(추가) 라벨 | `도면_result.jpg`가 옆에 있으면 자동 |

누적 기록 열: 검수 시각, 도면, 작업자, 항목, 종류, 처리(confirmed/edited/added), 기호, 전, 후, 형식 오류 여부, 좌표, 원본 파일, 원본 지문(sha256).
→ "어떤 기호·값이 자주 틀리나" 통계, 반복 오류 자동 수정 규칙, OCR 정확도 검증에 쓴다.

## 데이터 형식

### 검수 화면용 JSON (review 결과, 프론트가 읽음)

```json
{
  "schema": "ocr-review/1",
  "image": {"width": 2339, "height": 1654, "dpi": null, "frame_offset": null},
  "summary": {"gdt_rows": 9, "gdt_format_error": 1, "dimensions": 17},
  "gdt": [
    {"item_id": "G05-1", "symbol": "⏊", "symbol_name": "직각도", "value": ",.01", "datums": ["A"],
     "status": "format_error", "message": "숫자 형식이 아님 (글자 깨짐)",
     "position": {"x": 825, "y": 704, "anchor": "frame_top_left", "coord": "image"},
     "position_norm": {"x": 0.352715, "y": 0.425635}}
  ],
  "dimensions": [
    {"item_id": "D01", "text": "C2", "status": "auto",
     "position": {"x": 156, "y": 135, "anchor": "text_center", "coord": "frame"}}
  ]
}
```

- `item_id`: 기하공차는 `G{TXT 번호}-{틀 안의 줄}` (2단 틀이면 `G01-1`, `G01-2`), 치수는 `D{번호}`
- `status`: 기하공차 `check`(확인 필요) / `format_error`(형식 오류), 치수 `auto`

### 작업자 수정 JSON (프론트 → apply)

```json
{
  "reviewer": "이종민",
  "frame_offset": [56, 56],
  "gdt": [
    {"item_id": "G01-1", "value": "0.0035"},
    {"item_id": "G05-1", "value": "0.01"}
  ],
  "added_dimensions": [
    {"value": "7", "kind": "length", "tolerance": {"type": "general"},
     "x": 1267, "y": 1103, "coord": "image"}
  ]
}
```

- `dimensions` (선택): OCR이 잘못 읽은 치수 값 고치기. `item_id`는 `D{TXT 번호}`. 번호·좌표는 그대로 두고 글자만 바꾼다.
- `gdt`: **모든 기하공차 줄**을 넣는다 (그대로 맞으면 OCR 값을 그대로). 빠지면 거부한다 (`--allow-incomplete`로 해제 가능).
  기호나 데이텀을 바꾸려면 `"symbol": "⌰"`, `"datums": ["A", "B"]`를 추가한다.
- `kind`: `length` / `diameter`(⌀) / `radius`(R) / `chamfer`(C) / `thread`(M)
- `tolerance`: `{"type": "general"}` / `{"type": "symmetric", "value": "0.02"}` → `7±0.02` /
  `{"type": "deviation", "upper": "+0.02", "lower": "-0.01"}` → `7 +0.02/-0.01`
- `box` (선택): 추가한 치수의 글자 영역 `[x1, y1, x2, y2]` (이미지 픽셀). 있으면 그 칸을 형광펜으로 칠하고, 없으면 클릭 위치 주변 글자를 자동으로 찾아 칠한다.
- `x`, `y`: 작업자가 클릭한 위치 (`coord: "image"` = 색칠 결과 이미지 픽셀). TXT에는 다른 치수와 같은 기준(도면 테두리 기준)으로 바꿔서 적는다.

예시: `tests/fixtures/HDH_61_2_edits.json`, `HDH_62_2_edits.json`, `HDH_63_3_edits.json`
(3도면 정답대조표 기준. 적용하면 기하공차 25줄·치수 52개 전부 정답과 같아진다)

## 호환성 메모 (팀 확인 필요)

1. **좌표 기준이 구역마다 다르다.** eDOCr2 원본 좌표가 치수·기타 글자는 도면 테두리 안쪽 기준, 기하공차·표는 전체 이미지 기준이다 (HDH 도면에서 56px 차이).
   → 수정이 `test_drawing.py`에 아래 한 줄을 추가하면 이 코드가 자동으로 읽어서 맞춘다. 없으면 수정 JSON의 `frame_offset`을 쓴다.
   ```python
   f.write(f"Frame offset : {frame.x}, {frame.y}\n")   # frame이 None이면 0, 0
   ```
2. **원본 TXT에는 dpi가 없다.** `data/ocr_to_metadata.py`는 `Image size … PDF 200 dpi`가 없으면 바로 멈춘다.
   → `reviewed.txt`에는 `(PDF 200 dpi)`를 붙여서 통과하게 했다 (pdf2image 기본값 200, `--dpi`로 변경 가능).
3. **`data/ocr_to_metadata.py`가 GitHub에서 98줄에서 끊겨 있다.** 항목을 만드는 부분과 `main`이 없어서 실행해도 결과 파일이 안 나온다. 원본 파일을 다시 올려야 한다.
   또 표제란을 `PART NAME … QTY … PROJECTION …` 순서의 평문으로 가정하는데, 지금 TXT는 단어 목록(`[{'text': 'PART', ...}]`)이고 HDH 도면에는 QTY/PROJECTION 칸이 없다.
4. GD&T 좌표는 틀의 **왼쪽 위**, 치수 좌표는 글자 **중심**이다.
