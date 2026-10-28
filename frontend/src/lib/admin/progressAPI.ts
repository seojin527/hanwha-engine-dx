/** 관리자용 '선택한 부품·도면의 작업 진행 현황' 조회 (읽기 전용). */
import { apiUrl } from "../drawingAPI";
import type { OcrItem } from "../ocr";
import type { MeasurementStatus } from "../measurementAPI";
import type { StageKey } from "../machiningAPI";
import type { WorkPurpose } from "../purpose";

/** ok: 계산함 · no_target: 대상 없음 · unavailable: 산정 불가 (reason 참고) */
export type CardState = "ok" | "no_target" | "unavailable";

interface CardBase {
  state: CardState;
  reason: string;
  unit?: string;
  target?: number;
  completed?: number;
  failed?: number;
  incomplete?: number;
  progress?: number | null;
  last_recorded_at?: string | null;
}

export interface StageSummary {
  name: string;
  required_items: number;
  target: number;
  completed: number;
  failed: number;
  incomplete: number;
  progress: number | null;
  units_complete: number;
}

export interface ManufacturingCard extends CardBase {
  units?: string[];
  stages?: Record<StageKey, StageSummary>;
  template_found?: boolean;
  part_label?: string;
  by_unit?: Record<string, Record<StageKey, { required: number; passed: number; failed: number; complete: boolean; unlocked: boolean }>>;
}

export interface MeasurementCard extends CardBase {
  not_measured?: number;
  unconfirmed?: number;
  review_required?: number;
  previous_revision_records?: number;
}

export interface MeasurementRow {
  ocr_revision: string;
  item_id: string;
  measured_value: string;
  measurement_mode: string;
  gauge_result: string | null;
  instrument: string;
  note: string;
  judgement: "pass" | "fail" | "review";
  judgement_reason: string;
  confirmed: boolean;
  status: MeasurementStatus;
  updated_at: string;
}

export interface ProgressItem {
  item_id: string;
  number: number;
  raw_text: string;
  category: string;
  manufacturing: {
    plan: string;
    plan_label: string;
    stages: Partial<Record<StageKey, { completed: number; failed: number; recorded: number; units: number }>>;
  } | null;
  assembly: MeasurementRow | null;
  verification: MeasurementRow | null;
  links: Record<WorkPurpose, number>;
}

export interface DrawingProgress {
  drawing: { drawing_id: string; part_id: string; original_filename: string; name: string; part_name: string | null };
  owner: null;
  ocr: { has_result: boolean; revision?: string; review_status: string; item_count: number };
  unclassified_records: number;
  stages: { manufacturing: ManufacturingCard; assembly: MeasurementCard; verification: MeasurementCard };
  items: ProgressItem[];
}

export interface ItemLink {
  link_id: string;
  case_id: string;
  case_title: string;
  error_description: string;
  case_active: boolean;
  linked: boolean;
  source: string;
  created_at: string;
  unlinked_at: string | null;
}

export interface ItemProgress {
  item: OcrItem;
  revision: string;
  manufacturing: {
    records: (MeasurementRow & { serial: string; stage: StageKey; zero_checked: boolean })[];
    attempts: (Partial<MeasurementRow> & { serial: string; stage: StageKey; created_at: string })[];
  };
  assembly: { record: MeasurementRow | null; attempts: (Partial<MeasurementRow> & { created_at: string })[] };
  verification: { record: MeasurementRow | null; attempts: (Partial<MeasurementRow> & { created_at: string })[] };
  links: Record<WorkPurpose, ItemLink[]>;
  history: Record<WorkPurpose, { event_id: number; case_id: string; case_title: string | null; action: string; created_at: string; actor: string | null }[]>;
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.detail === "string" ? body.detail : `요청 실패 (${response.status})`);
  }
  return body as T;
}

export const fetchDrawingProgress = (drawingId: string, signal?: AbortSignal) =>
  request<DrawingProgress>(`/api/admin/drawings/${encodeURIComponent(drawingId)}/progress`, signal);

export const fetchItemProgress = (drawingId: string, itemId: string, revision: string, signal?: AbortSignal) =>
  request<ItemProgress>(
    `/api/admin/drawings/${encodeURIComponent(drawingId)}/progress/items/${encodeURIComponent(itemId)}?revision=${encodeURIComponent(revision)}`,
    signal,
  );
