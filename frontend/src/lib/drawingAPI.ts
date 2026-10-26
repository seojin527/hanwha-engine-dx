import type { WorkPurpose } from "./purpose";

const API_BASE = "http://127.0.0.1:8000";

export interface Part {
  part_id: string;
  name: string;
  created_at: string;
  drawing_count: number;
}

export interface Drawing {
  drawing_id: string;
  part_id: string;
  name: string;
  original_filename: string;
  media_type: string;
  size_bytes: number;
  ocr_status: string;
  created_at: string;
  file_url: string;
}

// 서버 오류 메시지를 화면에서 사용할 수 있게 처리
async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `요청 실패 (${response.status})`;

    try {
      const body = await response.json();

      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        message = body.detail
          .map((entry: unknown) => {
            if (typeof entry === "string") return entry;
            if (entry !== null && typeof entry === "object" && "msg" in entry) {
              return String(entry.msg);
            }
            return JSON.stringify(entry);
          })
          .join(", ");
      }
    } catch {
      // JSON 응답이 아니면 기본 오류 메시지 사용
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

// 부품 목록 조회
export async function fetchParts(signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/api/parts`, { signal });
  return readResponse<{ parts: Part[] }>(response);
}

// 부품 추가
export async function createPart(name: string) {
  const response = await fetch(`${API_BASE}/api/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  return readResponse<Part>(response);
}

// 선택한 부품의 도면 목록 조회
export async function fetchDrawings(
  partId: string,
  signal?: AbortSignal
) {
  const response = await fetch(
    `${API_BASE}/api/parts/${encodeURIComponent(partId)}/drawings`,
    { signal }
  );

  return readResponse<{
    part_id: string;
    drawings: Drawing[];
  }>(response);
}

// 선택한 부품 아래 실제 파일 업로드
export async function uploadDrawing(partId: string, file: File) {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(
    `${API_BASE}/api/parts/${encodeURIComponent(partId)}/drawings`,
    {
      method: "POST",
      body: form,
    }
  );

  return readResponse<Drawing>(response);
}

// 이미지·PDF 표시용 주소
export function drawingFileUrl(drawing: Drawing) {
  return new URL(drawing.file_url, API_BASE).href;
}
// API 기본 주소와 오류 처리는 기존 부품 API와 공유한다.
export function apiUrl(path: string) {
  return new URL(path, API_BASE).href;
}
export async function fetchOcr(drawingId: string, signal?: AbortSignal) {
  return readResponse<import('./ocr').OcrSnapshot>(await fetch(
    `${API_BASE}/api/drawings/${encodeURIComponent(drawingId)}/ocr`, { signal }
  ));
}
export async function applySampleOcr(drawingId: string) {
  return readResponse<import('./ocr').OcrSnapshot>(await fetch(
    `${API_BASE}/api/drawings/${encodeURIComponent(drawingId)}/ocr/sample`, { method: 'POST' }
  ));
}
export interface ErrorCandidate {
  case_id: string;
  case_title?: string;
  error_description?: string;
  cause?: string;
  precaution?: string;
  recommended_instrument?: string;
  applicable_condition?: string;
  exclude_condition?: string;
  data_origin?: string;
  source_file?: string;
  distance: number;
}
/** 작업 목적의 오류사례 컬렉션에서만 검색한다 (다른 목적·공통 컬렉션은 섞지 않는다). */
export async function fetchItemErrors(purpose: WorkPurpose, drawingId: string, itemId: string, signal?: AbortSignal) {
  return readResponse<{ purpose: WorkPurpose; drawing_id: string; item_id: string; revision: string; errors: ErrorCandidate[] }>(await fetch(
    `${API_BASE}/api/purposes/${purpose}/drawings/${encodeURIComponent(drawingId)}/items/${encodeURIComponent(itemId)}/errors`, { signal }
  ));
}
