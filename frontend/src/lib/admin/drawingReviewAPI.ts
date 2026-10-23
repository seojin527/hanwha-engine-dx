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

export interface DrawingReviewRequest {
  revision: string;
  reviewer: string;
  confirmed_item_ids: string[];
  edits: DrawingReviewEdits;
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

export async function generateDrawingReviewFiles(
  drawingId: string,
  revision: string,
): Promise<{ files: ReviewResultFile[] }> {
  const response = await fetch(
    apiUrl(
      `/api/ocr-review/drawing/${encodeURIComponent(drawingId)}/export`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision }),
    },
  );

  return readResponse<{ files: ReviewResultFile[] }>(response);
}