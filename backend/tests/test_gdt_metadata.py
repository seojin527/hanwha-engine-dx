"""기하공차 구조화 테스트 (tools/ocr_to_metadata).  backend 폴더에서:  python -m unittest discover -s tests -v"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(os.path.dirname(HERE), 'tools', 'ocr_to_metadata')
sys.path.insert(0, TOOL)
FIXTURE = os.path.join(HERE, 'fixtures', 'HDH_63_3_origin.txt')

from gdt_metadata import parse_frame_line, parse_gdt_frame, parse_gdt_row  # noqa: E402
from ocr_to_metadata import convert  # noqa: E402


class Gdt(unittest.TestCase):
    def test_frame_line_newline_is_real(self):
        text, x, y = parse_frame_line("['⏥|0.035|A\\n⫽|0.012', (868, 854)]")
        self.assertEqual(text, '⏥|0.035|A\n⫽|0.012')
        self.assertEqual((x, y), (868, 854))

    def test_frame_line_with_apostrophe_and_numpy(self):
        text, x, y = parse_frame_line('["⏥|0.0|A\'", (np.int64(10), np.int64(20))]')
        self.assertEqual((text, x, y), ("⏥|0.0|A'", 10, 20))

    def test_row_basic(self):
        r = parse_gdt_row('⏊|0.04|A')
        self.assertEqual((r['gdt_type'], r['gdt_category'], r['tolerance_value']), ('PERPENDICULARITY', 'ORIENTATION', 0.04))
        self.assertEqual((r['datum_references'], r['tolerance_zone'], r['requires_review']), (['A'], 'WIDTH', False))

    def test_diameter_zone_modifier_and_multiple_datums(self):
        r = parse_gdt_row('⌖|⌀0.05Ⓜ|A|B|C')
        self.assertEqual((r['tolerance_value'], r['tolerance_zone'], r['material_condition']), (0.05, 'DIAMETER', 'MMC'))
        self.assertEqual(r['datum_references'], ['A', 'B', 'C'])
        self.assertEqual(parse_gdt_row('⫽|0.01|AB')['datum_references'], ['A', 'B'])

    def test_broken_ocr_is_flagged_not_guessed(self):
        r = parse_gdt_row('⏊|,.01|A')
        self.assertIsNone(r['tolerance_value'])
        self.assertTrue(r['requires_review'])
        self.assertIsNone(parse_gdt_row('↗|0.015⏊|AB')['tolerance_value'])
        u = parse_gdt_row('???|0.1')
        self.assertEqual(u['gdt_type'], 'UNKNOWN')
        self.assertTrue(u['requires_review'])

    def test_datum_written_only_on_first_row_is_not_flagged(self):
        rows = parse_gdt_frame('⏥|0.035|A\n⫽|0.012')
        self.assertEqual([r['datum_references'] for r in rows], [['A'], []])
        self.assertEqual([r['frame_datum_references'] for r in rows], [['A'], ['A']])
        self.assertFalse(any(r['requires_review'] for r in rows))

    def test_orientation_without_any_datum_in_frame_is_flagged(self):
        self.assertTrue(parse_gdt_frame('⏊|0.04')[0]['requires_review'])
        self.assertFalse(parse_gdt_frame('⏥|0.04')[0]['requires_review'])   # 평면도는 데이텀 불필요

    def test_convert_splits_frames_into_rows(self):
        with open(FIXTURE, encoding='utf-8') as f:
            src = f.read().replace('px,', 'px (PDF 200 dpi),') + '\nFrame offset : 56, 56\n'
        doc = convert(src, 'T', 'T.jpg')
        gdt = [i for i in doc['items'] if i['category'] == 'GDT']
        self.assertEqual((len(gdt), doc['counts']['gdt_frames'], doc['counts']['dimensions']), (9, 5, 17))
        self.assertEqual(gdt[0]['id'], 'GDT_001_1')
        self.assertEqual(gdt[1]['frame_id'], 'GDT_001')
        self.assertEqual(gdt[0]['position'], gdt[1]['position'])
        self.assertNotIn('\\n', gdt[0]['raw_text'])


if __name__ == '__main__':
    unittest.main()
