"""표제란 파싱 테스트 (tools/ocr_to_metadata).  backend 폴더에서:  python -m unittest discover -s tests -v"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(os.path.dirname(HERE), 'tools', 'ocr_to_metadata')
sys.path.insert(0, TOOL)
FIXTURE = os.path.join(HERE, 'fixtures', 'HDH_63_3_origin.txt')

from ocr_to_metadata import convert  # noqa: E402
from titleblock_metadata import parse_title_block  # noqa: E402

OLD = "PART NAME PISTON ROD PART NO. PR-04 MATERIAL $US304 QTY 1 SCALE 1:1 UNIT mm PROJECTION 3rd angle DRAWN 2026-10-11"


def words(*rows):
    """rows: [(top, 'TEXT', left), ...] 로 단어 리스트 문자열 만들기"""
    return str([dict(text=t, left=l, top=top, width=60, height=26) for top, t, l in rows])


class TitleBlock(unittest.TestCase):
    def test_new_format_with_coordinates(self):
        with open(FIXTURE, encoding='utf-8') as f:
            tables = [l.split(':', 1)[1].strip() for l in f if l.strip().startswith('table 1:')]
        r = parse_title_block(tables)
        self.assertEqual((r['part_name'], r['part_no']), ('PISTON ROD', 'HX50-PR-1001'))
        self.assertEqual((r['drawing_scale'], r['unit'], r['unit_raw']), ('1.5:1', 'mm', 'MM'))
        self.assertEqual((r['drawn_date'], r['sheet_size'], r['operator']), ('2026-10-16', 'A3', 'DONG HYUN'))
        self.assertIsNone(r['quantity'])

    def test_material_equal_to_part_name_is_flagged_not_confirmed(self):
        with open(FIXTURE, encoding='utf-8') as f:
            tables = [l.split(':', 1)[1].strip() for l in f if l.strip().startswith('table 1:')]
        r = parse_title_block(tables)
        self.assertEqual(r['material_raw'], 'PISTON ROD')
        self.assertIsNone(r['material_normalized'])
        self.assertTrue(any('MATERIAL' in x and 'PART NAME' in x for x in r['review_reasons']))
        self.assertFalse(any('US304' in x for x in r['review_reasons']))

    def test_old_flat_format(self):
        r = parse_title_block([OLD])
        self.assertEqual((r['part_no'], r['material_raw'], r['quantity'], r['drawn_date']),
                         ('PR-04', '$US304', 1, '2026-10-11'))
        self.assertTrue(any('$US304' in x for x in r['review_reasons']))   # 실제로 $US304 일 때만 경고

    def test_label_order_and_empty_cell(self):
        # 값 칸이 빈 SCALE 이 다음 행 값을 훔치면 안 됨
        t = words((100, 'SCALE', 10), (200, 'UNIT', 10), (200, 'MM', 300))
        r = parse_title_block([t])
        self.assertIsNone(r['drawing_scale'])
        self.assertEqual(r['unit'], 'mm')
        self.assertTrue(any('SCALE' in x for x in r['review_reasons']))

    def test_bad_values_are_flagged(self):
        r = parse_title_block([words((1, 'SCALE', 0), (1, 'ABC', 200), (50, 'UNIT', 0), (50, 'XX', 200),
                                     (90, 'QTY', 0), (90, 'two', 200), (130, 'DATE', 0), (130, '16/10', 200))])
        self.assertEqual(len(r['review_reasons']) >= 4, True)
        self.assertIsNone(r['quantity'])
        self.assertIsNone(r['drawn_date'])

    def test_convert_end_to_end(self):
        with open(FIXTURE, encoding='utf-8') as f:
            src = f.read().replace('px,', 'px (PDF 200 dpi),') + '\nFrame offset : 56, 56\n'
        doc = convert(src, 'HDH_63_05', 'HDH_63_05_reviewed.jpg')
        self.assertEqual(doc['part_no'], 'HX50-PR-1001')
        self.assertEqual(doc['item_count'], 26)   # 치수 17 + 기하공차 9줄 (프레임 5개)


if __name__ == '__main__':
    unittest.main()
