/** 팀원 JSON의 타입과 UI 변환. 추정값으로 검사 기준을 채우지 않는다. */
export interface OcrItem {
  id: string;
  category: string;
  raw_text: string;
  position: { x: number; y: number; anchor?: string };
  feature_type?: string;
  measurement_characteristic?: string;
  nominal_value?: number | null;
  unit?: string;
  tol_type?: string;
  upper_deviation?: number | null;
  lower_deviation?: number | null;
  lower_limit?: number | null;
  upper_limit?: number | null;
  requires_review?: boolean;
  coordinate_requires_review?: boolean;
  review_reasons?: string[];
}
export interface OcrDocument {
  review?: {completed: boolean; reviewer: string};
  drawing_id: string;
  source_drawing_id?: string;
  part_name?: string | null;
  image: { width_px: number; height_px: number; coordinate_status?: string };
  review_reasons?: string[];
  items: OcrItem[];
}
export interface OcrSnapshot {
  work_allowed?: boolean;
  review_status?: "pending" | "completed";
  drawing_id: string;
  status: 'completed' | 'not_started' | 'queued' | 'running' | 'failed';
  job?: {job_id?: string; status: string; stage: string; error: string};
  revision?: string;
  image_url?: string;
  result: OcrDocument | null;
}
export interface OcrPoint {
  id: number; // 화면 선택/번호에만 사용. 데이터 식별은 drawing_id + source.id
  displayNumber: number;
  x: number;
  y: number;
  feature: { name: string };
  source: OcrItem;
}
const names: Record<string, string> = {
  DIAMETER: '지름', THREAD_SPEC: '나사', CHAMFER_SIZE: '모따기',
  RADIUS: '반지름', LINEAR_DIMENSION: '길이', GEOMETRIC_TOLERANCE: '기하공차',
};
export function toOcrPoints(document: OcrDocument): OcrPoint[] {
  return document.items.map((source, index) => ({
    id: index + 1, displayNumber: index + 1,
    x: source.position.x, y: source.position.y,
    feature: { name: names[source.measurement_characteristic || ''] || source.category },
    source,
  }));
}
export function toleranceText(item: OcrItem): string {
  if (typeof item.lower_limit === 'number' && typeof item.upper_limit === 'number') {
    return `${item.lower_limit} ~ ${item.upper_limit} ${item.unit || ''}`.trim();
  }
  return item.tol_type === 'UNKNOWN' ? '해석 확인 필요' : '기준 확인 필요';
}
