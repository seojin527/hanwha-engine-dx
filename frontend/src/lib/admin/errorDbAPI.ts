/**
 * 관리자 오류 DB 관리 API (목적별). 모든 요청에 목적이 들어가며 다른 목적의 저장소는 섞지 않는다.
 * 서버 인증은 없다: 화면에서 관리자에게만 메뉴를 보여 줄 뿐이다.
 */
import { apiUrl } from "../drawingAPI";
import type { WorkPurpose } from "../purpose";

export type VectorStatus = "pending" | "ready" | "failed";

export interface SchemaField {
  key: string;
  label: string;
  required: boolean;
}

export interface PurposeSchema {
  purpose: WorkPurpose;
  label: string;
  fields: SchemaField[];
  feature_types: string[];
  excel: { sheet: string; columns: string[]; required_columns: string[]; info_columns: string[] };
}

export interface ErrorDbSummary {
  uploads: { applied: number; rejected: number; files: number; rows: number; last: string | null };
  cases: { total: number; active: number; inactive: number };
  vector: { ready: number; failed: number; pending: number };
  links: { active: number; unlinked: number; cases: number };
}

export interface CaseRow {
  case_id: string;
  case_title: string;
  error_description: string;
  part_family: string;
  feature_type: string;
  data_origin: string;
  active: boolean;
  vector_status: VectorStatus;
  created_at: string;
  updated_at: string;
  link_count: number;
}

export interface Location {
  openable: boolean;
  reason: string;
}

export interface CaseLink {
  link_id: string;
  case_id: string;
  case_title: string;
  case_active: boolean;
  drawing_id: string;
  drawing_name: string | null;
  part_id: string | null;
  part_name: string | null;
  ocr_revision: string;
  item_id: string;
  raw_text: string;
  source: "point_report" | "admin";
  linked: boolean;
  created_at: string;
  unlinked_at: string | null;
  location: Location;
}

export type HistoryAction = "create" | "update" | "deactivate" | "reactivate" | "link" | "unlink";

export interface HistoryEvent {
  event_id: number;
  purpose: WorkPurpose;
  case_id: string;
  case_title: string | null;
  case_active: boolean | null;
  action: HistoryAction;
  drawing_id: string | null;
  drawing_name: string | null;
  part_id: string | null;
  part_name: string | null;
  ocr_revision: string | null;
  item_id: string | null;
  upload_id: string | null;
  detail: Record<string, unknown>;
  actor: string | null;
  created_at: string;
  location: Location;
}

export interface CaseDetail {
  case: Record<string, string> & { case_id: string; active: boolean; vector_status: VectorStatus };
  links: CaseLink[];
  history: HistoryEvent[];
}

export interface UploadError {
  file: string;
  sheet: string;
  row: number | null;
  case_id: string;
  message: string;
}

export interface FilePlan {
  file: string;
  sheet: string;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
}

export interface UploadPreview {
  ok: boolean;
  errors: UploadError[];
  rows?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  files?: FilePlan[];
  changes?: {
    file: string;
    row: number;
    case_id: string;
    case_title: string;
    action: "created" | "updated" | "unchanged";
    changed_fields: string[];
    active: boolean | null;
  }[];
}

export interface UploadResult {
  upload_id: string;
  saved: boolean;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  vector_status: "none" | "ready" | "failed";
  vector_ready: number;
  vector_failed: number;
  files: (FilePlan & { indexed: number; vector_status: "none" | "ready" | "failed" })[];
}

export interface UploadRecord {
  upload_id: string;
  source: "admin_ui" | "cli";
  status: "applied" | "rejected";
  file_count: number;
  row_count: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  vector_status: "none" | "pending" | "ready" | "failed";
  vector_ready: number;
  vector_failed: number;
  errors: UploadError[];
  created_at: string;
  files: {
    file_index: number;
    file_name: string;
    sheet: string;
    row_count: number;
    created_count: number;
    updated_count: number;
    unchanged_count: number;
    vector_status: string;
  }[];
}

/** 서버 오류. 엑셀 반영 거부는 errors 에 위치별 오류가 들어 있다. */
export class AdminApiError extends Error {
  errors: UploadError[];
  constructor(message: string, errors: UploadError[] = []) {
    super(message);
    this.errors = errors;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // JSON 이 아닌 응답
  }
  if (!response.ok) {
    const detail = body?.detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      throw new AdminApiError(String(detail.message ?? `요청 실패 (${response.status})`), detail.errors ?? []);
    }
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((entry: { msg?: string }) => entry.msg || String(entry)).join(", ")
          : `요청 실패 (${response.status})`;
    throw new AdminApiError(message);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const base = (purpose: WorkPurpose) => `/api/admin/purposes/${purpose}`;

export const fetchSchema = (purpose: WorkPurpose, signal?: AbortSignal) =>
  request<PurposeSchema>(`${base(purpose)}/schema`, { signal });

export const fetchSummary = (purpose: WorkPurpose, signal?: AbortSignal) =>
  request<ErrorDbSummary>(`${base(purpose)}/summary`, { signal });

export function fetchCases(
  purpose: WorkPurpose,
  query: { q?: string; active?: "all" | "active" | "inactive"; vector?: "all" | VectorStatus; limit?: number; offset?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return request<{ total: number; items: CaseRow[] }>(`${base(purpose)}/error-cases?${params}`, { signal });
}

export const fetchCaseDetail = (purpose: WorkPurpose, caseId: string, signal?: AbortSignal) =>
  request<CaseDetail>(`${base(purpose)}/error-cases/${encodeURIComponent(caseId)}`, { signal });

export const createCase = (purpose: WorkPurpose, values: Record<string, string>) =>
  request<{ case_id: string; vector_status: VectorStatus; message: string }>(`${base(purpose)}/error-cases`, json("POST", values));

export const updateCase = (purpose: WorkPurpose, caseId: string, values: Record<string, string>) =>
  request<{ case_id: string; saved?: boolean; vector_status: VectorStatus; message: string; changed_fields: string[] }>(
    `${base(purpose)}/error-cases/${encodeURIComponent(caseId)}`,
    json("PUT", values),
  );

export const setCaseActive = (purpose: WorkPurpose, caseId: string, active: boolean) =>
  request<{ active: boolean; changed: boolean }>(
    `${base(purpose)}/error-cases/${encodeURIComponent(caseId)}/${active ? "reactivate" : "deactivate"}`,
    { method: "POST" },
  );

export const retryVectors = (purpose: WorkPurpose, caseIds?: string[]) =>
  request<{ requested: number; ready: number; failed: number }>(
    `${base(purpose)}/vector/retry`,
    json("POST", caseIds ? { case_ids: caseIds } : {}),
  );

export function fetchLinks(
  purpose: WorkPurpose,
  query: { state?: "active" | "unlinked" | "all"; drawing_id?: string; item_id?: string; case_id?: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
  return request<{ items: CaseLink[] }>(`${base(purpose)}/links?${params}`, { signal });
}

export const createLink = (purpose: WorkPurpose, body: { case_id: string; drawing_id: string; item_id: string; revision: string }) =>
  request<{ link_id: string }>(`${base(purpose)}/links`, json("POST", body));

export const unlinkCase = (purpose: WorkPurpose, linkId: string) =>
  request<{ changed: boolean }>(`${base(purpose)}/links/${encodeURIComponent(linkId)}/unlink`, { method: "POST" });

export function fetchHistory(
  purpose: WorkPurpose,
  query: { case_id?: string; drawing_id?: string; item_id?: string; action?: HistoryAction; limit?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]),
  );
  return request<{ items: HistoryEvent[] }>(`${base(purpose)}/history?${params}`, { signal });
}

export const fetchUploads = (purpose: WorkPurpose, signal?: AbortSignal) =>
  request<{ items: UploadRecord[] }>(`${base(purpose)}/uploads`, { signal });

function filesBody(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return { method: "POST", body: form } satisfies RequestInit;
}

export const previewUpload = (purpose: WorkPurpose, files: File[]) =>
  request<UploadPreview>(`${base(purpose)}/uploads/preview`, filesBody(files));

export const applyUpload = (purpose: WorkPurpose, files: File[]) =>
  request<UploadResult>(`${base(purpose)}/uploads`, filesBody(files));

export const exportUrl = (purpose: WorkPurpose) => apiUrl(`${base(purpose)}/export.xlsx`);

export const ACTION_LABEL: Record<HistoryAction, string> = {
  create: "등록",
  update: "수정",
  deactivate: "비활성화",
  reactivate: "재활성화",
  link: "연결",
  unlink: "연결 해제",
};

export const VECTOR_LABEL: Record<VectorStatus, string> = {
  ready: "반영 완료",
  failed: "반영 실패",
  pending: "반영 대기",
};
