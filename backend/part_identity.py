"""부품 식별: 화면 표시명과 검색용 부품 식별값을 나눈다.

표시명(parts.name)은 관리자가 자유롭게 짓는다 ('커넥팅 로드', '피스톤 로드 · 검토 완료 예시' 등).
오류사례 검색은 표시명 글자가 아니라 부품 키(CH·CR·CS·PH·PR)로 묶는다.
  1. 관리자가 부품을 3D 에 명시적으로 연결한 engine_part_key 를 먼저 쓴다.
  2. 없으면 표시명·표제란 PART NAME 을 공통 별칭으로 찾는다 (띄어쓰기·대소문자 무시).
오류 DB 의 part_family 값은 바꾸지 않는다. 같은 키로 해석되는 기존 표기를 모두 검색 조건에 넣는다.
"""

from typing import Iterable, Optional

from drawing_library import database

# 공통 별칭. 앞에서부터 찾는다 (띄어쓰기를 지운 소문자 기준, 포함 여부).
PART_ALIASES: dict[str, tuple[str, ...]] = {
    "PR": ("피스톤로드", "pistonrod"),
    "PH": ("피스톤헤드", "pistonhead", "피스톤크라운", "pistoncrown"),
    "CR": ("커넥팅로드", "connectingrod", "conrod"),
    "CS": ("크랭크샤프트", "크랭크축", "crankshaft"),
    "CH": ("크로스헤드", "crosshead"),
}


def alias_key(*names) -> Optional[str]:
    """부품 이름(표시명·표제란·오류 DB 표기)을 별칭으로 부품 키로 바꾼다. 못 찾으면 None."""
    for name in names:
        text = "".join(str(name or "").split()).lower()
        if not text:
            continue
        for key, words in PART_ALIASES.items():
            if any(word in text for word in words):
                return key
    return None


def drawing_part(drawing_id: str, document: Optional[dict] = None) -> dict:
    """도면이 속한 부품의 표시명과 검색용 키. key_source 는 키를 어디서 정했는지 (engine·alias·None)."""
    with database() as db:
        row = db.execute(
            "SELECT p.name, p.engine_part_key FROM drawings d JOIN parts p ON p.part_id=d.part_id WHERE d.drawing_id=?",
            (drawing_id,),
        ).fetchone()
    name = row["name"] if row else ""
    explicit = row["engine_part_key"] if row else None
    if explicit in PART_ALIASES:
        return {"name": name, "key": explicit, "key_source": "engine"}
    key = alias_key(name, (document or {}).get("part_name"))
    return {"name": name, "key": key, "key_source": "alias" if key else None}


def search_families(part: dict, known: Iterable[str]) -> list[str]:
    """검색 조건에 넣을 part_family 값: 표시명 그대로 + 오류 DB 의 기존 표기 중 같은 키로 해석되는 것."""
    families = [part["name"]] if part.get("name") else []
    if part.get("key"):
        for value in sorted({str(v) for v in known if v}):
            if alias_key(value) == part["key"] and value not in families:
                families.append(value)
    return families
