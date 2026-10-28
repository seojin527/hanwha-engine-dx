"""CI 용 전체 백엔드 테스트 실행. 알려진 실패(tests/known_failures.txt)만 허용한다.

실행 (backend 폴더에서): python tools/run_ci_tests.py

- tests/test_*.py 전체를 실행한다 (건너뛰는 테스트 없음).
- 목록에 없는 실패·오류가 하나라도 있으면 종료 코드 1.
- 목록에 있는 테스트가 통과하면 역시 종료 코드 1 (목록에서 지우라는 뜻).
"""

import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
TESTS = BACKEND / "tests"


def known_failures() -> set[str]:
    lines = (TESTS / "known_failures.txt").read_text(encoding="utf-8").splitlines()
    return {line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")}


def main() -> int:
    sys.path.insert(0, str(BACKEND))
    sys.path.insert(0, str(TESTS))
    suite = unittest.defaultTestLoader.discover(str(TESTS), pattern="test_*.py", top_level_dir=str(TESTS))
    result = unittest.TextTestRunner(verbosity=1).run(suite)

    failed = {test.id() for test, _ in result.failures + result.errors}
    # 모듈을 불러오지 못한 경우(_FailedTest)도 실패로 센다.
    expected = known_failures()
    unexpected = sorted(failed - expected)
    now_passing = sorted(expected - failed)

    print("\n=== CI 테스트 요약 ===")
    print(f"실행 {result.testsRun} · 실패/오류 {len(failed)} · 알려진 실패 {len(failed & expected)} · 건너뜀 {len(result.skipped)}")
    for test_id in sorted(failed & expected):
        print(f"  [알려진 실패] {test_id}")
    for test_id in unexpected:
        print(f"  [새 실패] {test_id}")
    for test_id in now_passing:
        print(f"  [통과로 바뀜] {test_id}  → tests/known_failures.txt 에서 지우세요")
    if unexpected or now_passing:
        print("결과: 실패")
        return 1
    print("결과: 통과 (새 실패 없음)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
