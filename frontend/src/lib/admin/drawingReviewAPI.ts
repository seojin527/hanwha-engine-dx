import { apiUrl } from "../drawingAPI";
import type { OcrDocument, OcrSnapshot } from "../ocr";

export interface ReviewGdtRow {
  item_id: string;
  entry_no: number;
  row: number;
  raw: string;
  symbol: string;
  symbol_name: string | null;
  value: string;
  datums: string[];
  status: string;
  message: string | null;
}

export interface ReviewDimension {
  item_id: string;
  no: number;
  text: string;
  position: { x: number; y: number };
  position_image: { x: number; y: number } | null;
}

export interface DrawingReviewSource {
  drawing_id: string;
  revision: string;
  result: OcrDocument;
  review: {
    gdt: ReviewGdtRow[];
    dimensions: ReviewDimension[];
    warnings: string[];
  };
}

export interface DrawingReviewEdits {
  gdt: Array<{
    item_id: string;
    value: string;
    symbol?: string;
    datums?: string[];
  }>;
  dimensions: Array<{
    item_id: string;
    text: string;
  }>;
  added_dimensions: Array<{
    text: string;
    x: number;
    y: number;
    coord: "image";
  }>;
}
export interface InspectionSetting {
  measurement_mode: "numeric" | "gauge";
  feature_type: string;
  /** 실측값 방식의 공차 출처. drawing·general은 서버가 표기에서 다시 계산한다. */
  tolerance_source?: "drawing" | "general" | "special";
  nominal_value?: number;
  upper_deviation?: number;
  lower_deviation?: number;
  unit: string;
  instrument: string;
  gauge_criteria: string;
  position_confirmed: boolean;
}


export interface DrawingReviewRequest {
  revision: string;
  reviewer: string;
  confirmed_item_ids: string[];
  edits: DrawingReviewEdits;
  inspection_settings?: Record<string, InspectionSetting>;
}

export interface ReviewLog {
  reviewer?: string;
  reviewed_at?: string;
  summary: Record<string, number>;
  changes: Array<{
    item_id: string;
    type: string;
    action: string;
    before: string | null;
    after: string;
  }>;
  warnings: string[];
}

export interface DrawingReviewResponse {
  snapshot: OcrSnapshot;
  log: ReviewLog;
  /** 결과 파일 자동 생성이 실패했을 때 이유 (검토 저장은 된 상태) */
  files_error?: string | null;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `검수 요청 실패 (${response.status})`;

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
      // JSON
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function reviewUrl(drawingId: string): string {
  return apiUrl(
    `/api/ocr-review/drawing/${encodeURIComponent(drawingId)}`,
  );
}

export async function fetchDrawingReview(
  drawingId: string,
  signal?: AbortSignal,
): Promise<DrawingReviewSource> {
  const response = await fetch(reviewUrl(drawingId), { signal });
  return readResponse<DrawingReviewSource>(response);
}

export async function saveDrawingReview(
  drawingId: string,
  request: DrawingReviewRequest,
): Promise<DrawingReviewResponse> {
  const response = await fetch(reviewUrl(drawingId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  return readResponse<DrawingReviewResponse>(response);
}

export interface ReviewPreviewMarker {
  id: string;
  number: number;
  text: string;
  x: number;
  y: number;
}


export interface ReviewResultFile {
  kind: string;
  label: string;
  url: string;
  updated_at?: number;
}

export interface ReviewFileList {
  drawing_id: string;
  revision: string;
  files: ReviewResultFile[];
  error?: string | null;
}

/** 검토 완료 때 자동으로 만들어진 결과 파일 목록 (정답본·기록·이미지·작업자 입력 JSON·누적 CSV). */
export async function fetchDrawingReviewFiles(
  drawingId: string,
  revision: string,
  signal?: AbortSignal,
): Promise<ReviewFileList> {
  const response = await fetch(
    apiUrl(
      `/api/ocr-review/drawing/${encodeURIComponent(drawingId)}/files?revision=${encodeURIComponent(revision)}`,
    ),
    { signal },
  );
  return readResponse<ReviewFileList>(response);
}
