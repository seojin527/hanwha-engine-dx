"""백엔드가 읽고 쓰는 파일·DB 위치를 한곳에 모은 설정.

모든 경로는 이 파일 위치를 기준으로 한 절대 경로이므로, 서버를 어느 폴더에서 실행해도 같다.
위치를 바꾸려면 이 파일만 고치고, 기존 데이터를 같은 위치로 옮긴다 (README 의 백업·복구 참고).

공유(Git) ─ data/ 의 입력 원본·샘플, 코드
로컬 전용 ─ storage/, vector_db/, data 안의 실행 산출물 (도면 ID 이름의 파일)
"""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent


def _env_dir(name: str, default: Path) -> Path:
    # 서버 배포에서는 코드 폴더 밖(/srv/hanwha-dx/...)을 가리켜 재배포 때 데이터가 덮이지 않게 한다.
    value = os.environ.get(name, "").strip()
    return Path(value).resolve() if value else default


# ------------------------------------------------------------------ 로컬 실행 데이터 (Git 제외)
STORAGE_DIR = _env_dir("DX_STORAGE_DIR", BACKEND_DIR / "storage")
LIBRARY_DB = STORAGE_DIR / "library.sqlite3"          # 공통 SQLite (부품·도면·OCR·측정·검토·오류 원문)
UPLOAD_DIR = STORAGE_DIR / "uploads"                  # 업로드한 도면 원본 (DB 에는 파일명만 저장)
OCR_JOB_DIR = STORAGE_DIR / "ocr_jobs"                # CPU OCR 작업 폴더 (작업 ID 별)
OCR_RESULT_DIR = STORAGE_DIR / "ocr_results"          # 화면에 띄우는 OCR 결과 이미지 (DB 에는 파일명만 저장)
VECTOR_DB_DIR = _env_dir("DX_VECTOR_DB_DIR", BACKEND_DIR / "vector_db")          # Chroma (목적별 컬렉션 + 기존 공통 컬렉션)
REVIEW_DRY_RUN_LOG_DIR = _env_dir("DX_LOG_DIR", BACKEND_DIR / "logs")       # 저장 없이(save=false) 검수할 때만 쓰는 누적 기록

# ------------------------------------------------------------------ data/ (입력 원본·샘플 + 검토 산출물)
DATA_DIR = _env_dir("DX_DATA_DIR", REPO_ROOT / "data")
INPUT_DIR = DATA_DIR / "input"                        # eDOCr2 에 넣을 도면 PDF
ORIGIN_DIR = DATA_DIR / "origin"                      # eDOCr2 원문 TXT · 결과 JPG (<이름>_origin.txt, <이름>_result.jpg)
REVIEWED_DIR = DATA_DIR / "reviewed"                  # 관리자 검토 결과 (<이름>_reviewed.txt/.jpg)
REVIEW_LOG_DIR = DATA_DIR / "logs"                    # 검토 로그·수정 이력 (review_history.csv 포함)
NORMALIZED_DIR = DATA_DIR / "normalized"              # 변환된 메타데이터 샘플 (테스트용)
SAMPLE_METADATA = DATA_DIR / "1_metadata.json"        # 이전 단일 도면 API(/api/drawing) 샘플
LEGACY_ERROR_EXCEL_DIR = DATA_DIR / "error_cases"     # 기존 공통 오류 DB 의 원본 엑셀 (보존용)

# 목적별 오류사례 원본 엑셀 폴더 (purpose_errors.ingest --all 이 읽는 곳)
ERROR_EXCEL_DIRS = {
    "manufacturing": DATA_DIR / "manufacturing",
    "assembly": DATA_DIR / "assembly",
    "verification": DATA_DIR / "verification",
}

# 기존 공통 오류 저장소 (목적별 이관 확인 전까지 보존, 화면에서는 사용하지 않음)
LEGACY_ERROR_COLLECTION = "error_cases_e5_small_v1"
