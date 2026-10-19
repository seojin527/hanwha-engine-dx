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
  drawing_id: string;
  source_drawing_id?: string;
  part_name?: string | null;
  image: { width_px: number; height_px: number; coordinate_status?: string };
  review_reasons?: string[];
  items: OcrItem[];
}
export interface OcrSnapshot {
  drawing_id: string;
  status: 'completed' | 'not_started';
  revision?: string;
  image_url?: string;
  result: OcrDocument | null;
}
export type LabelSide = 'top' | 'right' | 'bottom' | 'left';
export interface LabelAnchor { x: number; y: number; side: LabelSide }
export interface OcrPoint {
  id: number; // 화면 선택/번호에만 사용. 데이터 식별은 drawing_id + source.id
  displayNumber: number;
  x: number;
  y: number;
  labelAnchor?: LabelAnchor;
  feature: { name: string };
  source: OcrItem;
}

// OCR 결과에는 글자 박스 크기가 없으므로 글자 수로 폭을 어림해
// 번호 마커를 치수 글자 오른쪽(기하공차는 틀 왼쪽)에 붙인다.
// 기준: 2339px 폭 도면에서 글자 높이 약 27px, 글자 폭 약 16px.
function estimateLabelAnchor(item: OcrItem, imageWidth: number): LabelAnchor {
  const scale = imageWidth > 0 ? imageWidth / 2339 : 1;
  const { x, y } = item.position;
  if (item.category === 'GDT') {
    const row = Number((item as { row_index?: number }).row_index) || 1;
    return { x, y: y + (16 + (row - 1) * 32) * scale, side: 'left' };
  }
  const halfWidth = (item.raw_text.length * 8 + 6) * scale;
  return { x: x + halfWidth, y, side: 'right' };
}
const names: Record<string, string> = {
  DIAMETER: '지름', THREAD_SPEC: '나사', CHAMFER_SIZE: '모따기',
  RADIUS: '반지름', LINEAR_DIMENSION: '길이', GEOMETRIC_TOLERANCE: '기하공차',
};
export function toOcrPoints(document: OcrDocument): OcrPoint[] {
  return document.items.map((source, index) => ({
    id: index + 1, displayNumber: index + 1,
    x: source.position.x, y: source.position.y,
    labelAnchor: estimateLabelAnchor(source, document.image.width_px),
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
