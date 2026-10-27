"""OCR 하위 프로세스 실패 기록 테스트: 종료 코드·stderr 가 진행률 출력에 묻히지 않는지."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ocr_jobs  # noqa: E402

CHILD = r"""
import os, sys
for _ in range(200):
    print("1/1 [==============================] - ETA: 0s")
    print("1/1 [==============================] - 0s 150ms/step")
print("[STAGE] 치수 OCR... CPU에서는 시간이 걸릴 수 있습니다.", flush=True)
def recognize_dimensions():
    os.abort()          # 네이티브 abort 와 같은 즉시 종료 (파이썬 예외·traceback 없음)
recognize_dimensions()
"""


class FailureLoggingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_child(self, faulthandler: bool):
        env = os.environ.copy()
        env.pop("PYTHONFAULTHANDLER", None)
        if faulthandler:
            env["PYTHONFAULTHANDLER"] = "1"
        log_path, err_path = self.dir / "run.log", self.dir / "stderr.log"
        with log_path.open("wb") as log, err_path.open("wb") as err:
            code = subprocess.call([sys.executable, "-c", CHILD], stdout=log, stderr=err, env=env)
        return code, log_path, err_path

    def test_abort_is_reported_with_exit_code_stage_and_python_stack(self):
        code, log_path, err_path = self.run_child(faulthandler=True)
        self.assertNotEqual(code, 0)
        message = ocr_jobs.OcrWorker.failure_message(code, "[STAGE] 치수 OCR...", log_path, err_path)

        first_line = message.splitlines()[0]
        self.assertIn("OCR 실행 실패 (종료 코드", first_line)
        self.assertIn("마지막 단계: 치수 OCR...", message)
        # faulthandler 가 남긴 파이썬 호출 위치가 메시지 앞쪽에 있다
        self.assertIn("Fatal Python error", message)
        self.assertIn("recognize_dimensions", message)
        # 진행률 줄은 오류 요약에 섞이지 않는다
        self.assertNotIn("ms/step", message.split("마지막 일반 출력")[0])
        self.assertLessEqual(len(message), 2400)
        self.assertIn(str(err_path), message)
        # stdout 로그에는 진행률만 있다
        self.assertNotIn("Fatal Python error", log_path.read_text(encoding="utf-8", errors="replace"))

    def test_no_stderr_is_stated_explicitly(self):
        code, log_path, err_path = self.run_child(faulthandler=False)
        message = ocr_jobs.OcrWorker.failure_message(code, "", log_path, err_path)
        self.assertIn("파이썬 예외 없이 프로세스가 종료됨", message)
        self.assertIn("마지막 단계: 시작 전", message)

    def test_describe_exit_codes(self):
        self.assertIn("0xC0000409", ocr_jobs.describe_exit(0xC0000409))
        self.assertIn("abort", ocr_jobs.describe_exit(0xC0000409))
        if os.name == "nt":
            # Windows 에서 같은 값이 음수로 오는 경우도 같은 설명
            self.assertEqual(ocr_jobs.describe_exit(-1073740791), ocr_jobs.describe_exit(0xC0000409))
        self.assertEqual(ocr_jobs.describe_exit(1), "1")
        self.assertEqual(ocr_jobs.meaningful_lines("1/1 [====] - 0s 1ms/step\r\n\r\nreal error\r\n", 5), ["real error"])


if __name__ == "__main__":
    unittest.main()
