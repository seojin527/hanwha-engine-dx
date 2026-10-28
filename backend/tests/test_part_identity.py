"""화면 표시명과 검색용 부품 식별값 분리: 오류 DB 표기를 바꾸지 않고 별칭·부품 키로 잇는다."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from part_identity import alias_key, search_families  # noqa: E402

# 시연 서버 오류 DB 에 실제로 들어 있는 표기 (검증 목적)
KNOWN = ["크랭크샤프트", "크로스헤드", "피스톤헤드", "피스톤 로드", "커넥팅로드"]


class Aliases(unittest.TestCase):
    def test_spacing_and_synonyms(self):
        self.assertEqual(alias_key("커넥팅 로드"), alias_key("커넥팅로드"))
        self.assertEqual(alias_key("피스톤 헤드"), "PH")
        self.assertEqual(alias_key("크랭크축"), alias_key("크랭크샤프트"))
        self.assertEqual(alias_key("", "CROSS HEAD"), "CH")
        self.assertEqual(alias_key("피스톤 로드 · 검토 완료 예시"), "PR")

    def test_unknown_name(self):
        self.assertIsNone(alias_key("크랭크"))
        self.assertIsNone(alias_key(""))


class Families(unittest.TestCase):
    def test_display_name_kept_and_db_spelling_added(self):
        part = {"name": "커넥팅 로드", "key": "CR"}
        self.assertEqual(search_families(part, KNOWN), ["커넥팅 로드", "커넥팅로드"])

    def test_synonym_from_engine_key(self):
        part = {"name": "크랭크축", "key": "CS"}
        self.assertEqual(search_families(part, KNOWN), ["크랭크축", "크랭크샤프트"])

    def test_other_parts_not_mixed(self):
        part = {"name": "피스톤 헤드", "key": "PH"}
        self.assertEqual(search_families(part, KNOWN), ["피스톤 헤드", "피스톤헤드"])

    def test_without_key_only_display_name(self):
        self.assertEqual(search_families({"name": "크랭크", "key": None}, KNOWN), ["크랭크"])

    def test_old_piston_rod_rule_still_holds(self):
        part = {"name": "피스톤로드", "key": "PR"}
        self.assertEqual(search_families(part, KNOWN), ["피스톤로드", "피스톤 로드"])


if __name__ == "__main__":
    unittest.main()
