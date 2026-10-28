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
  measurement_mode?: "numeric" | "gauge";
  gauge_criteria?: string;
  instrument?: string;
  /** DRAWING(도면 공차) / GENERAL(일반공차 ISO 2768-m) / SPECIAL(관리자 특별 공차) */
  tolerance_source?: "DRAWING" | "GENERAL" | "SPECIAL" | null;
  /** 허용 공차 근거. project_default 는 도면 표기가 아니라 프로젝트 기본 정책(ISO 2768-m)으로 적용한 값 */
  tolerance_basis?: "drawing" | "drawing_note" | "project_default" | "admin" | null;
  /** 관리자가 바꾸지 않아 시스템 기본값이 그대로 저장된 설정 필드 */
  defaults_applied?: string[];
  /** 관리자가 검사 기준까지 확정한 항목 */
  inspection_approved?: boolean;
  /** 관리자가 오인식으로 제외한 항목. 작업·관람 화면에는 나오지 않는다. */
  excluded?: boolean;
}
export interface OcrDocument {
  review_status?: string;
  reviewer?: string;
  review_history?: OcrReviewHistoryEntry[];
  drawing_id: string;
  source_drawing_id?: string;
  part_name?: string | null;
  unit?: string | null;
  image: { width_px: number; height_px: number; coordinate_status?: string };
  review_reasons?: string[];
  items: OcrItem[];
}
export interface OcrSnapshot {
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
  // 번호는 전체 순서를 그대로 쓴다 (검토 화면·측정 계획의 번호와 맞춘다). 오인식 제외 항목만 뺀다.
  return document.items
    .map((source, index) => ({
      id: index + 1, displayNumber: index + 1,
      x: source.position.x, y: source.position.y,
      feature: { name: names[source.measurement_characteristic || ''] || source.category },
      source,
    }))
    .filter((point) => !point.source.excluded);
}
const SOURCE_LABEL: Record<string, string> = {
  DRAWING: '도면 공차', GENERAL: '일반공차 ISO 2768-m', SPECIAL: '특별 공차',
};
const fmt = (value: number) => Number(value.toFixed(6)).toString();
export function toleranceText(item: OcrItem): string {
  if (typeof item.lower_limit === 'number' && typeof item.upper_limit === 'number') {
    const range = `${fmt(item.lower_limit)} ~ ${fmt(item.upper_limit)} ${item.unit || ''}`.trim();
    let basis = '';
    if (typeof item.nominal_value === 'number' && typeof item.upper_deviation === 'number' && typeof item.lower_deviation === 'number') {
      const dev = item.upper_deviation === -item.lower_deviation
        ? `±${fmt(item.upper_deviation)}`
        : `${item.upper_deviation >= 0 ? '+' : ''}${fmt(item.upper_deviation)}/${fmt(item.lower_deviation)}`;
      basis = `${fmt(item.nominal_value)} ${dev} → `;
    }
    const source = item.tolerance_source
      ? `${SOURCE_LABEL[item.tolerance_source]}${item.tolerance_basis === 'project_default' ? ' · 프로젝트 기본 정책, 도면 표기 아님' : ''}`
      : '';
    return `${basis}${range}${source ? ` (${source})` : ''}`;
  }
  return item.tol_type === 'UNKNOWN' ? '해석 확인 필요' : '기준 확인 필요';
}

export interface OcrReviewHistoryEntry {
  previous_revision: string;
  revision: string;
  log: {
    reviewer?: string;
    reviewed_at?: string;
    changes: Array<{
      item_id: string;
      type: string;
      action: string;
      before: string | null;
      after: string;
    }>;
  };
}
/** 저장된 관리자 검토 정보 (검토자 · 시각). 검토 전이면 null. */
export function reviewInfoOf(document: OcrDocument | null | undefined): { reviewer: string; at: string } | null {
  if (!document || document.review_status !== 'reviewed') return null;
  const last = document.review_history?.[document.review_history.length - 1];
  let at = '';
  if (last?.log.reviewed_at) {
    const date = new Date(last.log.reviewed_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    at = Number.isNaN(date.getTime())
      ? last.log.reviewed_at
      : `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return { reviewer: document.reviewer || last?.log.reviewer || '', at };
}
