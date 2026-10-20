"""demo/check.py : 뒤로 가기(b)와 저장 전 최종 확인 테스트.  backend 폴더에서: python -m unittest discover -s tests"""
import contextlib
import io
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "demo"))

import check  # noqa: E402
from ocr_review import OcrTxt  # noqa: E402

ORIGIN = open(os.path.join(HERE, "fixtures", "HDH_63_3_origin.txt"), encoding="utf-8").read()
TRUTH = ["⏥|0.0035|A\n⫽|0.012", "○|0.0014|A\n⌯|0.015", "⌖|0.023|A\n◎|0.017",
         "⌭|0.004|A\n⏤|0.012", "⏊|0.01|A"]


def run(answers):
    it = iter(answers)
    out = {}

    def save(reviewed, log):
        out["reviewed"], out["log"] = reviewed, log
        return []

    with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
        rc = check.run_check(ORIGIN, "HDH_63_3", os.path.join(tmp, "e.json"), save,
                             frame_offset=[56, 56], ask=lambda _p: next(it))
    return rc, out


class TestDemoCheck(unittest.TestCase):
    def test_straight_answers(self):
        rc, out = run(["이종민", "0.0035", "", "0.0014", "", "", "", "0.004", "", "0.01",
                       "y", "7", "", "", "1267,1103", "", ""])
        self.assertEqual(rc, 0)
        self.assertEqual([g.text for g in OcrTxt.parse(out["reviewed"]).gdt], TRUTH)

    def test_back_and_fix_before_saving(self):
        rc, out = run([
            "이종민",
            "0.0035", "", "0.04",          # 3번을 잘못 확정
            "b", "0.0014",                 # 4번에서 b → 3번 다시 입력
            "", "", "", "0.004", "", "0.01",
            "y", "7", "", "", "1267,1103",
            "y", "9", "", "", "100,100",  # 실수로 치수 하나 더 추가
            "",
            "2", "0.013",                  # 최종 확인: 2번 잘못 고침
            "2", "",                       # 다시 2번 → Enter = OCR 값으로 되돌림
            "d2",                          # 실수로 추가한 치수 삭제
            "",                            # 저장
        ])
        self.assertEqual(rc, 0)
        doc = OcrTxt.parse(out["reviewed"])
        self.assertEqual([g.text for g in doc.gdt], TRUTH)
        self.assertEqual([d.text for d in doc.dims][-1], "7")
        self.assertEqual(out["log"]["summary"]["dimensions_added"], 1)

    def test_quit_without_saving(self):
        rc, out = run(["", "0.0035", "", "0.0014", "", "", "", "0.004", "", "0.01", "", "q"])
        self.assertEqual(rc, 130)
        self.assertEqual(out, {})

    def test_back_not_allowed_on_first_and_format_error_needs_number(self):
        rc, out = run(["", "b", "0.0035", "", "0.0014", "", "", "", "0.004", "", "", "0.01", "", ""])
        self.assertEqual(rc, 0)   # 1번의 b, 9번(형식 오류)의 Enter 는 다시 물어봄


if __name__ == "__main__":
    unittest.main()
