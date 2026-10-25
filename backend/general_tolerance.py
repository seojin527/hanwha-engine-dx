"""일반공차 (KS B ISO 2768-1, 중간급 m).

도면에 개별 공차가 없는 치수에 기본으로 적용한다.
관리자가 '특별 공차'를 입력하면 그 값이 우선한다.

표 1: 길이 치수 (지름 포함)       표 2: 모따기 높이·외부 반지름 (파단 모서리)
  0.5 이상   3 이하   ±0.1            0.5 이상 3 이하  ±0.2
  3 초과     6 이하   ±0.1            3 초과   6 이하  ±0.5
  6 초과    30 이하   ±0.2            6 초과           ±1
 30 초과   120 이하   ±0.3
120 초과   400 이하   ±0.5
400 초과  1000 이하   ±0.8
1000 초과 2000 이하   ±1.2
2000 초과 4000 이하   ±2
0.5 미만이거나 표 범위를 넘으면 일반공차를 적용하지 않는다 (개별 공차 필요).
"""
from typing import Optional

GENERAL_CLASS = "m"
GENERAL_LABEL = "일반공차 ISO 2768-m"

# (초과, 이하, ±편차). 첫 구간만 0.5 '이상'.
LINEAR_M = [
    (0.5, 3, 0.1), (3, 6, 0.1), (6, 30, 0.2), (30, 120, 0.3),
    (120, 400, 0.5), (400, 1000, 0.8), (1000, 2000, 1.2), (2000, 4000, 2.0),
]
EDGE_M = [(0.5, 3, 0.2), (3, 6, 0.5), (6, None, 1.0)]

LINEAR_CHARACTERISTICS = {"LINEAR_DIMENSION", "DIAMETER"}
EDGE_CHARACTERISTICS = {"CHAMFER_SIZE", "RADIUS"}


def _lookup(table, nominal: float) -> Optional[float]:
    for index, (low, high, deviation) in enumerate(table):
        above = nominal >= low if index == 0 else nominal > low
        if above and (high is None or nominal <= high):
            return deviation
    return None


def general_deviation(characteristic: Optional[str], nominal) -> Optional[float]:
    """측정 특성과 기준치수에 맞는 ±편차. 적용할 수 없으면 None."""
    if isinstance(nominal, bool) or not isinstance(nominal, (int, float)):
        return None
    if characteristic in LINEAR_CHARACTERISTICS:
        return _lookup(LINEAR_M, float(nominal))
    if characteristic in EDGE_CHARACTERISTICS:
        return _lookup(EDGE_M, float(nominal))
    return None
