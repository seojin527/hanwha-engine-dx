// 관리자 "검토 완료" → 백엔드 OCR 검수 API(/api/ocr-review/submit)로 보내 서버에 저장한다.
//
// 화면은 관리자 수정값을 반영한 "최종 항목 목록"만 보낸다. 서버(backend/ocr_review)가
// eDOCr2 원본 TXT(<도면>_origin.txt)와 비교해서 무엇을 확정·수정·추가했는지 스스로 계산하고
//   data/reviewed/<도면>_reviewed.txt  (검수 끝난 결과, 원본과 같은 형식)
//   data/logs/                          (검수 기록: 누가·언제·무엇을→무엇으로, 누적 CSV)
// 를 저장한다.
//
// 항목 id 규칙 (도면 추출 JSON 과 같음)
//   GDT_001_2     → 기하공차 1번 틀 2번째 줄
//   DIMENSION_006 → 원본 치수 6번. 값이 원본과 다르면 "잘못 읽은 값 수정"
//   ADM1 등        → 관리자가 추가한 치수
// 상한/하한 공차·측정기는 OCR 결과가 아니라 검사 기준이라 보내지 않는다 (화면에서 관리).
//
// 서버가 꺼져 있거나 원본 TXT가 없는 도면(샘플 1번 등)이면 지금처럼 이 브라우저에만 완료 기록을 남긴다.

import type { DemoDrawingDoc } from "../demoDrawings";
import { applyEditsToDoc } from "./adminOverlay";
import type { ItemEdit } from "./adminStore";

/** 백엔드 주소 (drawingAPI.ts 와 같은 서버) */
export const REVIEW_API_BASE = "http://127.0.0.1:8000";

export type SubmitResult =
  | { status: "saved"; saved: string[]; warnings: string[] }
  | { status: "rejected"; messages: string[] }
  | { status: "skipped"; message: string }
  | { status: "offline"; message: string };

/** public/drawings/<도면>_origin.txt (eDOCr2 원본). 없으면 undefined → 서버의 data/origin 을 쓴다 */
async function loadOriginText(drawingKey: string): Promise<string | undefined> {
  try {
    const response = await fetch(`/drawings/${encodeURIComponent(drawingKey)}_origin.txt`);
    if (!response.ok) return undefined;
    const text = await response.text();
    return text.includes("[ DIMENSIONS ]") ? text : undefined; // 개발 서버가 없는 파일에 index.html 을 줄 수 있음
  } catch {
    return undefined;
  }
}

/** 검토 완료한 도면을 서버에 보낸다. doc 은 관리자가 추가한 치수까지 붙인 도면(docWithAdded) */
export async function submitReview(
  drawingKey: string,
  doc: DemoDrawingDoc,
  edits: Record<string, ItemEdit> | undefined,
  reviewer: string,
): Promise<SubmitResult> {
  const finalDoc = applyEditsToDoc(doc, edits);
  const items = finalDoc.items.map((item) => ({
    id: item.id,
    category: item.category,
    raw_text: item.raw_text,
    position: item.position,
    tolerance_value: item.tolerance_value ?? null,
    datum_references: item.datum_references,
  }));
  const originTxt = await loadOriginText(drawingKey);

  let response: Response;
  try {
    response = await fetch(`${REVIEW_API_BASE}/api/ocr-review/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: drawingKey, items, reviewer, origin_txt: originTxt ?? null, save: true }),
    });
  } catch {
    return { status: "offline", message: `검수 서버(${REVIEW_API_BASE})에 연결하지 못했습니다.` };
  }
  const data = await response.json().catch(() => null);
  if (response.status === 404) {
    return { status: "skipped", message: "이 도면은 eDOCr2 원본 TXT가 없어 서버 검수 기록을 남기지 않습니다." };
  }
  if (!response.ok) {
    const detail = data?.detail;
    const messages = Array.isArray(detail)
      ? detail.map((d: unknown) => (typeof d === "string" ? d : JSON.stringify(d)))
      : [String(detail ?? `HTTP ${response.status}`)];
    return { status: "rejected", messages };
  }
  return { status: "saved", saved: data?.saved ?? [], warnings: data?.warnings ?? [] };
}

/** 수정 내역에 남길 한 줄 */
export function describeSubmit(result: SubmitResult): string {
  switch (result.status) {
    case "saved":
      return `서버 저장됨 (${result.saved.length}개 파일)`;
    case "skipped":
      return "서버 기록 안 함 (원본 TXT 없는 도면)";
    case "offline":
      return "서버 연결 안 됨 (이 브라우저에만 저장)";
    default:
      return "서버 거부";
  }
}

// ---------------------------------------------------------------------------
// ⚠ 깨진 값 판단을 서버(/api/ocr-review/review)에 맡긴다
// ---------------------------------------------------------------------------

/** 서버 항목 번호 "G01-2" → 화면 항목 id "GDT_001_2" */
function screenGdtId(serverId: string): string | null {
  const m = /^G(\d+)-(\d+)$/.exec(serverId);
  return m ? `GDT_${m[1].padStart(3, "0")}_${m[2]}` : null;
}

/**
 * 서버가 원본 TXT를 검사한 결과: 화면 항목 id → ⚠ 이유 (깨진 값만).
 * 원본 TXT가 없거나 서버가 꺼져 있으면 null → 화면 규칙(adminOverlay.reviewWarning)을 그대로 쓴다.
 */
export async function fetchServerWarnings(drawingKey: string): Promise<Record<string, string> | null> {
  const originTxt = await loadOriginText(drawingKey);
  try {
    const response = await fetch(`${REVIEW_API_BASE}/api/ocr-review/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: drawingKey, origin_txt: originTxt ?? null }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const out: Record<string, string> = {};
    for (const g of data?.gdt ?? []) {
      const id = screenGdtId(String(g.item_id));
      if (id && g.status === "format_error") out[id] = `서버 검사: ${g.message} (OCR 값 "${g.value}")`;
    }
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 서버에 저장된 검수 결과 (정답본·검수 기록·이미지) 목록
// ---------------------------------------------------------------------------

export interface ServerResultFile {
  kind: string;
  label: string;
  /** 서버 주소를 붙인 전체 주소 */
  url: string;
}

export async function fetchServerResults(drawingKey: string): Promise<ServerResultFile[]> {
  try {
    const response = await fetch(`${REVIEW_API_BASE}/api/ocr-review/result/${encodeURIComponent(drawingKey)}`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data?.files ?? []).map((f: { kind: string; label: string; url: string; updated_at?: number }) => ({
      kind: f.kind,
      label: f.label,
      url: `${REVIEW_API_BASE}${f.url}?v=${Math.round(f.updated_at ?? 0)}`, // 다시 저장하면 새 파일을 보도록
    }));
  } catch {
    return [];
  }
}

/** 모든 도면의 누적 검수 기록 (CSV, 엑셀로 열기) */
export const REVIEW_HISTORY_URL = `${REVIEW_API_BASE}/api/ocr-review/history`;
