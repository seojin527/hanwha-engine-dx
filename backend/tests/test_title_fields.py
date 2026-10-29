"""서버가 쓰는 표제란 읽기(ocr_metadata.title_fields) 테스트: 부품번호·축척.

실행 (backend 폴더에서): python -m unittest tests.test_title_fields -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ocr_metadata import title_fields  # noqa: E402


def w(text, left, top, width, height):
    return {"text": text, "left": left, "top": top, "width": width, "height": height}


# 실제 OCR 결과(PISTON HEAD)의 표제란 단어 좌표: 라벨 칸(SCALE / SHEET SIZE)과 값 칸('1:20, A3')의 세로 위치가 어긋난다.
PH = [w("PART", 1479, 959, 79, 25), w("NAME", 1571, 959, 85, 25), w("PISTON", 1873, 958, 114, 27), w("HEAD", 2002, 959, 83, 25),
      w("PART", 1488, 1042, 79, 25), w("NO.", 1580, 1041, 52, 27), w("PM01-PH-6001", 1868, 1041, 221, 27),
      w("SCALE", 1513, 1104, 95, 27), w("1:20,", 1917, 1122, 73, 32), w("A3", 2004, 1122, 38, 27),
      w("SHEET", 1471, 1145, 100, 27), w("SIZE", 1583, 1145, 68, 27),
      w("OPERATOR", 1477, 1208, 170, 27), w("DONG", 1884, 1208, 91, 27), w("HYUN", 1989, 1209, 84, 26),
      w("DATE", 1521, 1293, 81, 25), w("2026-10-22", 1893, 1292, 172, 27),
      w("MATERIAL", 1484, 1376, 156, 25), w("HEAT-RESISTANT", 1786, 1375, 270, 27), w("STEEL", 2068, 1375, 94, 27),
      w("UNIT", 1524, 1459, 76, 26), w("MM", 1965, 1459, 49, 25)]

# 같은 양식의 CRANK SHAFT 도면 (축척 1:50)
CS = [w("PART", 1479, 959, 79, 25), w("NAME", 1571, 959, 85, 25), w("CRANK", 1882, 958, 106, 27), w("SHAFT", 1999, 958, 100, 27),
      w("PART", 1499, 1042, 80, 25), w("NO.", 1592, 1041, 52, 27), w("PM01-CS-6001", 1880, 1041, 219, 27),
      w("SCALE", 1525, 1104, 94, 27), w("1:50,", 1931, 1122, 73, 32), w("A3", 2017, 1122, 38, 27),
      w("SHEET", 1482, 1145, 100, 27), w("SIZE", 1594, 1145, 69, 27),
      w("UNIT", 1535, 1459, 76, 26), w("MM", 1965, 1459, 49, 25)]


class PartNoAndScale(unittest.TestCase):
    def test_misaligned_scale_cells(self):
        fields, _ = title_fields([PH])
        self.assertEqual(fields["part_no"], "PM01-PH-6001")
        self.assertEqual(fields["drawing_scale"], "1:20")      # 용지 크기(A3)는 떼어 낸다

    def test_other_drawing_same_layout(self):
        fields, _ = title_fields([CS])
        self.assertEqual((fields["part_no"], fields["drawing_scale"]), ("PM01-CS-6001", "1:50"))

    def test_label_and_value_on_same_line(self):
        fields, _ = title_fields([[w("SCALE", 100, 100, 90, 26), w("1.5:1,", 300, 100, 80, 26), w("A3", 400, 100, 40, 26)]])
        self.assertEqual(fields["drawing_scale"], "1.5:1")

    def test_spaced_ratio_is_normalized(self):
        fields, _ = title_fields([[w("SCALE", 100, 100, 90, 26), w("1", 300, 100, 20, 26), w(":", 325, 100, 10, 26), w("20", 340, 100, 30, 26)]])
        self.assertEqual(fields["drawing_scale"], "1:20")

    def test_empty_scale_cell_does_not_steal_next_row(self):
        # 값 칸이 빈 SCALE 줄 다음이 비율 모양이 아니면(UNIT 줄) 읽지 않는다.
        fields, _ = title_fields([[w("SCALE", 100, 100, 90, 26), w("UNIT", 100, 200, 80, 26), w("MM", 300, 200, 50, 26)]])
        self.assertNotIn("drawing_scale", fields)
        self.assertEqual(fields["unit"], "MM")

    def test_non_ratio_value_is_kept_as_read(self):
        fields, _ = title_fields([[w("SCALE", 100, 100, 90, 26), w("NTS", 300, 100, 60, 26)]])
        self.assertEqual(fields["drawing_scale"], "NTS")

    def test_missing_scale_stays_missing(self):
        fields, _ = title_fields([[w("PART", 100, 100, 70, 26), w("NO.", 180, 100, 50, 26), w("X-1", 300, 100, 50, 26)]])
        self.assertNotIn("drawing_scale", fields)


if __name__ == "__main__":
    unittest.main()
