# OCR 메타데이터 변환

## 프로젝트에 넣을 위치
- `data/error_cases/RAGFlow_가상오류DB.xlsx`: 검색 대상 오류사례 원본
- `data/drawings/PR-04/ocr_result.txt`: OCR 원문
- `data/drawings/PR-04/drawing_metadata.json`: 변환 결과
- `data/drawings/PR-04/annotated.png`: 같은 픽셀 크기의 색상박스 이미지(사용자가 추가)
- `scripts/ocr_to_metadata.py`: 변환 코드

RAGFlow 소스 폴더 안에는 데이터를 넣을 필요가 없습니다. 엑셀을 프로젝트에 저장하는 것과 RAGFlow 지식베이스에 업로드하는 것은 별도 작업입니다.

## 실행 (프로젝트 루트, PowerShell)

```powershell
python .\scripts\ocr_to_metadata.py .\data\drawings\PR-04\ocr_result.txt .\data\drawings\PR-04\drawing_metadata.json --drawing-id PR-04-DEMO-001 --image-file data/drawings/PR-04/annotated.png
```

Python 3.9 이상 권장. 별도 패키지를 설치하지 않습니다. 다운로드 파일을 같은 폴더에서 테스트할 때:

```powershell
python .\ocr_to_metadata.py .\ocr_result.txt .\drawing_metadata.json
```

## JSON 사용

- `items`에는 치수 17개와 기하공차 2개, 총 19개가 저장됩니다.
- `raw_text`는 OCR 원문을 보존합니다.
- `position`은 이미지 왼쪽 위를 원점으로 하는 글자 중심 좌표입니다. `x_normalized`, `y_normalized`는 원본 가로/세로로 나눈 비율입니다.
- 화면에 맞춰 크기를 바꾸면 `화면 x = x_normalized × 실제 표시 이미지 너비`, `화면 y = y_normalized × 실제 표시 이미지 높이`로 표시합니다. 이미지에 여백이 있다면 이미지 시작 위치를 더합니다. 확대·이동·회전 시에도 같은 변환을 적용합니다.
- `bbox`는 현재 TXT에 박스 크기가 없어서 null입니다. 실제 색상박스를 클릭 영역으로 쓰려면 OCR 단계에서 left/top/width/height 또는 bbox를 추가로 받아야 합니다. 문자 중심 좌표는 실제 측정면 위치와 다를 수 있습니다.
- `feature_type`과 `tol_type`는 엑셀 검색 조건과 연결합니다. UNKNOWN은 필터에서 제외하여 확실하지 않은 형상을 강제하지 않습니다.
- `⌀16±0.01`은 지름이라는 사실만 확정할 수 있습니다. 구멍(HOLE)인지 축(SHAFT)인지는 문자만으로 확정하지 않습니다.
- `M10`은 나사 유형으로 분류하되 피치·등급·내외나사 여부는 확인 대상으로 둡니다.
- 단순 숫자는 LINEAR_DIMENSION으로 분류하되 형상과 일반공차는 추정하지 않습니다.
- 첫 번째/16번째 지름 OCR과 두 기하공차는 표기가 불명확하여 값·공차를 확정하지 않습니다. GDT의 `symbol_candidates`는 후보일 뿐 판정 기준이 아닙니다.
- 표제란의 `$US304`는 material_raw에 보존하며 SUS304로 자동 교정하지 않습니다.


## 검색 및 화면 연결
1. 엑셀을 RAGFlow 지식베이스에 업로드하고 파싱합니다.
2. 사용자가 도면 항목을 선택하면 앱이 그 항목의 `item_id`를 기억합니다.
3. `retrieval_query` 문자열로 RAGFlow 검색 API를 호출합니다.
4. 검색된 오류사례의 `case_id`와 선택한 `item_id`를 앱에서 연결합니다.
5. 적용/제외 조건을 확인한 뒤 해당 마커 옆에 결과를 표시합니다.


이 JSON은 앱에서 사용할 데이터 구조이며 RAGFlow가 자동으로 인식하는 전용 업로드 형식이 아닙니다. `retrieval_metadata` 역시 앱이 보관할 정보입니다. JSON을 업로드하는 것만으로 자동 필터나 이미지 연결이 생성되지 않습니다. 개별 컬럼 필터를 쓰려면 설치 버전의 메타데이터/파싱 설정에 맞게 별도 등록해야 합니다.

엑셀 priority는 가상 테스트용 중요도입니다. 검색 점수에 자동 반영되지 않습니다. 확실한 적용 조건을 우선 확인한 뒤 앱에서 정렬용으로 사용할 수 있습니다. 가상 사례와 현장 검증이 끝나지 않은 추출값으로 자동 품질 판정을 수행하지 않습니다.

도면 ID는 샘플 식별자이며 실제 저장 시 도면과 개정별로 고유하게 부여합니다. 지정한 이미지 경로의 존재나 크기는 이 스크립트가 검사하지 않습니다. 제공된 결과 파일은 실제 이미지가 첨부되지 않아 image.file이 null입니다.
