import { apiUrl } from "./drawingAPI";
import type { WorkPurpose } from "./purpose";

export type MeasurementMode = "numeric" | "gauge";

export type MeasurementJudgement = "pass" | "fail" | "review";

export type MeasurementStatus =
  | "pending"
  | "completed"
  | "remeasure"
  | "review_required";

export interface MeasurementRecord {
  item_id: string;
  /** 이 기록을 저장한 작업 목적 */
  work_purpose: WorkPurpose;
  measurement_mode: MeasurementMode;
  measured_value: string;
  gauge_result: "pass" | "fail" | null;
  confirmed: boolean;
  instrument: string;
  note: string;
  judgement: MeasurementJudgement;
  judgement_reason: string;
  status: MeasurementStatus;
  updated_at?: string;
}

export interface MeasurementRequest {
  revision: string;
  measurement_mode: MeasurementMode;
  measured_value: string;
  gauge_result: "pass" | "fail" | null;
  confirmed: boolean;
  instrument: string;
  note: string;
}

interface MeasurementList {
  drawing_id: string;
  revision: string;
  work_purpose: WorkPurpose;
  records: MeasurementRecord[];
}

export interface SavedMeasurement extends MeasurementRecord {
  drawing_id: string;
  revision: string;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `측정 요청 실패 (${response.status})`;

    try {
      const body = await response.json();

      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        message = body.detail
          .map((entry: unknown) => {
            if (typeof entry === "string") return entry;

            if (
              entry !== null &&
              typeof entry === "object" &&
              "msg" in entry
            ) {
              return String(entry.msg);
            }

            return JSON.stringify(entry);
          })
          .join("\n");
      }
    } catch {
      // JSON 응답이 아니면 기본 오류 메시지를 사용한다.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/** 이 작업 목적에서 저장한 측정 기록만 조회한다. */
export async function fetchMeasurements(
  purpose: WorkPurpose,
  drawingId: string,
  revision: string,
  signal?: AbortSignal,
): Promise<MeasurementList> {
  const response = await fetch(
    apiUrl(
      `/api/drawings/${encodeURIComponent(drawingId)}/measurements?revision=${encodeURIComponent(revision)}&purpose=${purpose}`,
    ),
    { signal },
  );

  return readResponse<MeasurementList>(response);
}

/** 이 작업 목적의 측정 기록으로 저장한다 (다른 목적의 기록은 바뀌지 않는다). */
export async function saveMeasurement(
  purpose: WorkPurpose,
  drawingId: string,
  itemId: string,
  request: MeasurementRequest,
): Promise<SavedMeasurement> {
  const response = await fetch(
    apiUrl(
      `/api/drawings/${encodeURIComponent(drawingId)}/items/${encodeURIComponent(itemId)}/measurement`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, work_purpose: purpose }),
    },
  );

  return readResponse<SavedMeasurement>(response);
}

export const measurementStatusLabels: Record<MeasurementStatus, string> = {
  pending: "대기",
  completed: "완료",
  remeasure: "재측정 필요",
  review_required: "판정 기준 확인 필요",
};

export const measurementStatusClasses: Record<MeasurementStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  completed: "bg-emerald-100 text-emerald-800",
  remeasure: "bg-red-100 text-red-700",
  review_required: "bg-amber-100 text-amber-800",
};