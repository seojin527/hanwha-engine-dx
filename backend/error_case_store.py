"""기존 공통 오류사례 원문 테이블 (error_cases).

화면은 목적별 저장소(purpose_errors)를 쓴다. 이 테이블과 공통 컬렉션은
목적별 이관이 확인될 때까지 보존하며, 이전 API 와 이관 명령만 사용한다.
"""

from fastapi import HTTPException

from drawing_library import database, init_library


def init_error_cases():
    with database() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS error_cases (
                case_id TEXT PRIMARY KEY,
                data_origin TEXT NOT NULL DEFAULT '',
                part_family TEXT NOT NULL DEFAULT '',
                feature_type TEXT NOT NULL DEFAULT 'UNKNOWN',
                feature_name TEXT NOT NULL DEFAULT '',
                measurement_characteristic TEXT NOT NULL DEFAULT '',
                tol_type TEXT NOT NULL DEFAULT 'UNSPECIFIED',
                drawing_text_example TEXT NOT NULL DEFAULT '',
                error_category TEXT NOT NULL DEFAULT '',
                case_title TEXT NOT NULL,
                error_description TEXT NOT NULL DEFAULT '',
                cause TEXT NOT NULL DEFAULT '',
                precaution TEXT NOT NULL DEFAULT '',
                recommended_instrument TEXT NOT NULL DEFAULT '',
                applicable_condition TEXT NOT NULL DEFAULT '',
                exclude_condition TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT '',
                part_zone TEXT NOT NULL DEFAULT '',
                error_type_code TEXT NOT NULL DEFAULT '',
                error_type TEXT NOT NULL DEFAULT '',
                severity TEXT NOT NULL DEFAULT '',
                process_stage TEXT NOT NULL DEFAULT '',
                impact TEXT NOT NULL DEFAULT '',
                corrective_action TEXT NOT NULL DEFAULT '',
                ocr_note TEXT NOT NULL DEFAULT '',
                keywords TEXT NOT NULL DEFAULT '',
                search_text TEXT NOT NULL DEFAULT '',
                vector_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (vector_status IN ('pending', 'ready', 'failed')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


def legacy_collection(app):
    """기존 공통 컬렉션. 새 PC 처럼 없으면 이전 API 만 503 으로 거부한다."""
    collection = getattr(app.state, "collection", None)
    if collection is None:
        raise HTTPException(503, "기존 공통 오류사례 저장소가 없습니다. 목적별 API(/api/purposes/...)를 사용하세요.")
    return collection


if __name__ == "__main__":
    init_library()
    init_error_cases()
    print("error_cases 테이블 준비 완료")