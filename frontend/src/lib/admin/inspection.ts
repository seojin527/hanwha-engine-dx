export interface PointInspectionRecord {
  pointId: number;
  status: 'pending' | 'completed' | 'flagged';
  measuredValue: string;
  tolerance: string;
  notes?: string;
}

export const STORAGE_KEYS = {
  RESULTS: 'hanwha_inspection_results_v2',
  SELECTED_ID: 'hanwha_selected_point_id',
};

// 1~17번 전체 포인트에 대한 초기 검수 결과
export const DEFAULT_INITIAL_RESULTS: Record<number, PointInspectionRecord> = {
  1: { pointId: 1, status: 'completed', measuredValue: '40.004', tolerance: '±0.010' },
  2: { pointId: 2, status: 'completed', measuredValue: '30.002', tolerance: '±0.015' },
  3: { pointId: 3, status: 'pending', measuredValue: '', tolerance: '±0.100' },
  4: { pointId: 4, status: 'pending', measuredValue: '', tolerance: '0.010' },
  5: { pointId: 5, status: 'pending', measuredValue: '', tolerance: '0.020' },
  6: { pointId: 6, status: 'pending', measuredValue: '', tolerance: '±0.020' },
  7: { pointId: 7, status: 'pending', measuredValue: '', tolerance: '±0.020' },
  8: { pointId: 8, status: 'pending', measuredValue: '', tolerance: '±0.05' },
  9: { pointId: 9, status: 'pending', measuredValue: '', tolerance: '±0.1' },
  10: { pointId: 10, status: 'pending', measuredValue: '', tolerance: '±0.2' },
  11: { pointId: 11, status: 'pending', measuredValue: '', tolerance: '±0.05' },
  12: { pointId: 12, status: 'pending', measuredValue: '', tolerance: '±0.05' },
  13: { pointId: 13, status: 'pending', measuredValue: '', tolerance: '±0.01' },
  14: { pointId: 14, status: 'pending', measuredValue: '', tolerance: '±0.05' },
  15: { pointId: 15, status: 'pending', measuredValue: '', tolerance: '±0.05' },
  16: { pointId: 16, status: 'pending', measuredValue: '', tolerance: '±0.01' },
  17: { pointId: 17, status: 'pending', measuredValue: '', tolerance: '±0.01' },
};

export function getPointStatus(record?: PointInspectionRecord): 'pending' | 'completed' | 'flagged' {
  if (!record) return 'pending';
  return record.status || 'pending';
}

// value가 무엇이든 안전하게 문자열로 변환하여 trim 수행 (에러 원천 차단)[cite: 13]
export function evaluateItemMeasurement(value: any, spec?: string): 'completed' | 'pending' | 'flagged' {
  if (value === null || value === undefined) return 'pending';
  const strValue = String(value).trim();
  if (strValue === '') return 'pending';
  return 'completed';
}
// ------------------------------------------------------------ 실측값 판정
export interface JudgeResult {
  status: 'pending' | 'completed' | 'flagged'; // completed = OK, flagged = NG
  judgement: 'OK' | 'NG' | null;
  deviation: number | null;  // 기준치수 대비 편차 (치수 항목)
  message: string;
}

const EPS = 1e-9;
const round = (value: number) => Number(value.toFixed(4));
const signed = (value: number) => `${value >= 0 ? '+' : ''}${round(value)}`;

/**
 * 실측값을 허용 범위(상·하한, 경계값 포함)와 비교해 OK/NG를 판정한다.
 * - 기하공차: 0 ≤ 측정값 ≤ 공차값 이면 OK
 * - 허용 범위가 없는 항목(나사 등)은 게이지 판정 버튼으로 처리
 */
export function judgeMeasurement(
  raw: string,
  dimension: { nominal?: number | null; lower?: number | null; upper?: number | null },
  isGdt = false,
): JudgeResult {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) return { status: 'pending', judgement: null, deviation: null, message: '' };
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) {
    return { status: 'pending', judgement: null, deviation: null, message: '숫자 형식이 아닙니다 (예: 30.012)' };
  }
  const value = Number(text);
  const { nominal = null, lower = null, upper = null } = dimension;
  if (typeof lower !== 'number' || typeof upper !== 'number') {
    return { status: 'pending', judgement: null, deviation: null, message: '허용 범위가 없는 항목입니다. 게이지 판정 버튼을 사용하세요.' };
  }
  if (isGdt && value < 0) {
    return { status: 'pending', judgement: null, deviation: null, message: '기하공차 측정값은 0 이상이어야 합니다' };
  }
  const deviation = !isGdt && typeof nominal === 'number' ? round(value - nominal) : null;
  if (value > upper + EPS) {
    return { status: 'flagged', judgement: 'NG', deviation, message: `상한 초과 (${signed(value - upper)} mm)` };
  }
  if (value < lower - EPS) {
    return { status: 'flagged', judgement: 'NG', deviation, message: `하한 미달 (${signed(value - lower)} mm)` };
  }
  return {
    status: 'completed', judgement: 'OK', deviation,
    message: isGdt ? `허용 ${upper} mm 이내` : '규격 적합',
  };
}
