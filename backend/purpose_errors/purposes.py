"""작업 목적(부품제작·조립·검증)별 오류사례 저장소 정의.

목적마다 원문 테이블 · 포인트 연결 기록 테이블 · 벡터 컬렉션 · 스키마 모듈이 따로 있다.
목적 이름이 없거나 잘못되면 거부한다. 다른 목적이나 기존 공통 저장소로 대체하지 않는다.
"""

from dataclasses import dataclass
from enum import Enum
from types import ModuleType

from .schemas import assembly, manufacturing, verification


class Purpose(str, Enum):
    manufacturing = "manufacturing"
    assembly = "assembly"
    verification = "verification"


@dataclass(frozen=True)
class PurposeStore:
    purpose: Purpose
    label: str
    case_table: str
    report_table: str
    collection: str
    schema: ModuleType
    case_prefix: str

    # 관리자 기능 테이블. 이름은 목적 값에서만 만든다 (요청값으로 만들지 않는다).
    @property
    def link_table(self) -> str:
        """도면 측정항목에 명시적으로 연결한 사례 (연결 해제 시각을 남긴다)."""
        return f"{self.purpose.value}_case_links"

    @property
    def history_table(self) -> str:
        """등록·수정·비활성화·재활성화·연결·해제 이력."""
        return f"{self.purpose.value}_case_history"


STORES: dict[Purpose, PurposeStore] = {
    Purpose.manufacturing: PurposeStore(
        purpose=Purpose.manufacturing,
        label="부품제작",
        case_table="manufacturing_error_cases",
        report_table="manufacturing_point_error_reports",
        collection="manufacturing_errors_v1",
        schema=manufacturing,
        case_prefix="MFG",
    ),
    Purpose.assembly: PurposeStore(
        purpose=Purpose.assembly,
        label="조립",
        case_table="assembly_error_cases",
        report_table="assembly_point_error_reports",
        collection="assembly_errors_v1",
        schema=assembly,
        case_prefix="ASM",
    ),
    Purpose.verification: PurposeStore(
        purpose=Purpose.verification,
        label="검증",
        case_table="verification_error_cases",
        report_table="verification_point_error_reports",
        collection="verification_errors_v1",
        schema=verification,
        case_prefix="VER",
    ),
}

for _purpose, _store in STORES.items():
    # 스키마 모듈을 잘못 연결하면 서버 시작 단계에서 바로 드러나게 한다.
    assert _store.schema.PURPOSE == _purpose.value, _purpose


class UnknownPurpose(ValueError):
    pass


def get_store(value) -> PurposeStore:
    """목적 이름으로 저장소를 찾는다. 없거나 잘못된 값은 UnknownPurpose."""
    try:
        purpose = Purpose(value)
    except ValueError as error:
        allowed = ", ".join(p.value for p in Purpose)
        raise UnknownPurpose(f"작업 목적이 올바르지 않습니다: {value!r} (허용: {allowed})") from error
    return STORES[purpose]
