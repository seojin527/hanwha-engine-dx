import { apiUrl } from './drawingAPI';
import type { WorkPurpose } from './purpose';

export interface RegistrationResult {
  case_id: string;
  saved: boolean;
  vector_status: 'ready' | 'failed';
  message: string;
  drawing_id: string;
  item_id: string;
  revision: string;
}
async function json<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), options);
  const body = await response.json();
  if (!response.ok) {
    const message = typeof body.detail === 'string' ? body.detail
      : Array.isArray(body.detail) ? body.detail.map((x: {msg?: string}) => x.msg || String(x)).join(', ')
      : `요청 실패 (${response.status})`;
    throw new Error(message);
  }
  return body;
}
const post = (body: unknown): RequestInit => ({method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
// 오류사례 등록·이력·재시도는 작업 목적의 저장소만 사용한다.
const purposeBase = (purpose: WorkPurpose, drawingId: string) =>
  `/api/purposes/${purpose}/drawings/${encodeURIComponent(drawingId)}`;
export function registerPointError(purpose: WorkPurpose, drawingId: string, itemId: string, body: Record<string, string>) {
  return json<RegistrationResult>(`${purposeBase(purpose, drawingId)}/items/${encodeURIComponent(itemId)}/error-cases`, post(body));
}
export function retryCaseIndex(purpose: WorkPurpose, caseId: string) {
  return json<RegistrationResult>(`/api/purposes/${purpose}/error-cases/${encodeURIComponent(caseId)}/retry-index`, post({}));
}
export function fetchPointReports(purpose: WorkPurpose, drawingId: string, itemId: string, revision: string, signal?: AbortSignal) {
  return json<{reports: {case_id: string; case_title: string; error_description: string; vector_status: string; created_at: string}[]}>(
    `${purposeBase(purpose, drawingId)}/items/${encodeURIComponent(itemId)}/error-cases?revision=${encodeURIComponent(revision)}`, {signal});
}
