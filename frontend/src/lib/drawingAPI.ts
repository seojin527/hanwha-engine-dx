import type { WorkPurpose } from "./purpose";

// 백엔드 주소. 기본은 로컬 서버이며, 검증용으로 다른 서버를 쓸 때만 VITE_API_BASE 로 바꾼다.
const API_BASE: string = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

export interface Part {
  part_id: string;
  name: string;
  created_at: string;
  drawing_count: number;
  /** 3D 엔진 모델의 부품 종류 (CS·CR·CH·PR·PH). 관리자가 연결하지 않았으면 null */
  engine_part_key?: string | null;
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
  /** 현재 OCR 결과 버전 (OCR 결과가 없으면 null). 도면 개정 번호가 아니다. */
  ocr_revision?: string | null;
  /** 관리자 검토 상태 ('reviewed' 면 검토 완료, 그 밖은 검토 전). OCR 결과가 없으면 null */
  review_status?: string | null;
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

// 부품 추가 (3D 부품 종류에 바로 연결할 수 있다)
export async function createPart(name: string, enginePartKey?: string | null) {
  const response = await fetch(`${API_BASE}/api/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(enginePartKey ? { name, engine_part_key: enginePartKey } : { name }),
  });

  return readResponse<Part>(response);
}

/** 등록 부품을 3D 엔진 부품 종류에 연결하거나(null 이면) 해제한다. */
export async function linkEnginePart(partId: string, enginePartKey: string | null) {
  const response = await fetch(`${API_BASE}/api/parts/${encodeURIComponent(partId)}/engine-part`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine_part_key: enginePartKey }),
  });
  return readResponse<Part>(response);
}

export interface PartMoveImpact {
  drawing_id: string;
  from_part: { part_id: string; name: string | null };
  to_part: { part_id: string; name: string };
  same_part: boolean;
  review_status: string | null;
  /** drawing_id 로 연결돼 이동 뒤에도 그대로인 기록 수 */
  kept: { measurements: number; machining_records: number; error_case_links: number };
  /** 부품 이름을 쓰는 기능 중 이동으로 의미가 달라지는 것 */
  changes: string[];
  needs_confirmation: boolean;
}

/** 소속 부품을 바꾸면 무엇이 유지·변경되는지 미리 본다 (서버 데이터는 바꾸지 않음). */
export async function fetchPartMoveImpact(drawingId: string, toPartId: string, signal?: AbortSignal) {
  const response = await fetch(
    `${API_BASE}/api/drawings/${encodeURIComponent(drawingId)}/part-move-impact?to_part_id=${encodeURIComponent(toPartId)}`,
    { signal },
  );
  return readResponse<PartMoveImpact>(response);
}

/** 도면의 소속 부품을 바꾼다 (drawings.part_id). expectedPartId 가 서버의 현재 값과 다르면 409 로 거부된다. */
export async function moveDrawingToPart(drawingId: string, partId: string, expectedPartId: string) {
  const response = await fetch(`${API_BASE}/api/drawings/${encodeURIComponent(drawingId)}/part`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ part_id: partId, expected_part_id: expectedPartId }),
  });
  return readResponse<{ changed: boolean; from_part_id?: string; drawing: Drawing }>(response);
}

/**
 * 진행률을 알 수 있는 도면 업로드 (기존 업로드 API와 같은 주소). abort() 로 취소할 수 있다.
 * 자동 OCR 서버(app_auto)로 실행 중이면 업로드 직후 OCR 작업이 시작된다.
 */
export function uploadDrawingWithProgress(
  partId: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): { promise: Promise<Drawing>; abort: () => void } {
  const request = new XMLHttpRequest();
  const promise = new Promise<Drawing>((resolve, reject) => {
    request.open("POST", `${API_BASE}/api/parts/${encodeURIComponent(partId)}/drawings`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    request.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // JSON 이 아니면 기본 문구
      }
      if (request.status >= 200 && request.status < 300 && body) resolve(body as Drawing);
      else reject(new Error(typeof body?.detail === "string" ? body.detail : `업로드 실패 (${request.status})`));
    };
    request.onerror = () => reject(new Error("서버에 연결할 수 없습니다. 네트워크와 서버 실행 상태를 확인해주세요."));
    request.onabort = () => reject(new DOMException("업로드를 취소했습니다.", "AbortError"));
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
  return { promise, abort: () => request.abort() };
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
  corrective_action?: string;
  impact?: string;
  severity?: string;
  process_stage?: string;
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
