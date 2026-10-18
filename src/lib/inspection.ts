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