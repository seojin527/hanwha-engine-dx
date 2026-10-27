/**
 * 치수 표기 해석·형식 검사, 일반공차(ISO 2768-m), 기하공차 값 검사.
 * 백엔드(general_tolerance.py, ocr_metadata.parse_dimension, ocr_review/review.py)와 같은 규칙.
 * 화면에서 미리 보여주는 용도이며, 최종 허용 범위는 서버가 다시 계산한다.
 */

export const GENERAL_LABEL = "일반공차 ISO 2768-m";

export type ToleranceSource = "drawing" | "general" | "special";

export const TOLERANCE_SOURCE_LABEL: Record<string, string> = {
  drawing: "도면 공차",
  general: GENERAL_LABEL,
  special: "특별 공차",
  DRAWING: "도면 공차",
  GENERAL: GENERAL_LABEL,
  SPECIAL: "특별 공차",
};

// ISO 2768-1 표 1 (길이·지름), 표 2 (모따기·반지름) — 중간급 m
const LINEAR_M: Array<[number, number | null, number]> = [
  [0.5, 3, 0.1], [3, 6, 0.1], [6, 30, 0.2], [30, 120, 0.3],
  [120, 400, 0.5], [400, 1000, 0.8], [1000, 2000, 1.2], [2000, 4000, 2],
];
const EDGE_M: Array<[number, number | null, number]> = [
  [0.5, 3, 0.2], [3, 6, 0.5], [6, null, 1],
];

function lookup(table: Array<[number, number | null, number]>, nominal: number) {
  for (let index = 0; index < table.length; index += 1) {
    const [low, high, deviation] = table[index];
    const above = index === 0 ? nominal >= low : nominal > low;
    if (above && (high === null || nominal <= high)) return deviation;
  }
  return null;
}

export type DimensionKind = "LINEAR_DIMENSION" | "DIAMETER" | "CHAMFER_SIZE" | "RADIUS" | "THREAD_SPEC";

export function generalDeviation(kind: DimensionKind | null, nominal: number | null): number | null {
  if (nominal === null || !Number.isFinite(nominal)) return null;
  if (kind === "LINEAR_DIMENSION" || kind === "DIAMETER") return lookup(LINEAR_M, nominal);
  if (kind === "CHAMFER_SIZE" || kind === "RADIUS") return lookup(EDGE_M, nominal);
  return null;
}

const NUM = String.raw`\d+(?:\.\d+)?`;
const SIGNED = String.raw`[+-]\d+(?:\.\d+)?`;
const THREAD_RE = new RegExp(String.raw`^M\s*(${NUM})(?:\s*[x×]\s*(${NUM}))?$`);
const PLAIN_RE = new RegExp(
  String.raw`^([⌀Øø]|R|C)?\s*(${NUM})(?:\s*±\s*(${NUM})|\s*(${SIGNED})\s*/\s*(${SIGNED}))?$`,
);

export interface ParsedDimension {
  valid: boolean;
  kind: DimensionKind | null;
  nominal: number | null;
  /** 도면에 적힌 공차 (없으면 null) */
  drawing: { upper: number; lower: number } | null;
  /** 개별 공차가 없을 때 적용할 일반공차 ± (적용 불가면 null) */
  general: number | null;
}

export function parseDimension(text: string): ParsedDimension {
  const value = text.trim();
  const thread = value.match(THREAD_RE);
  if (thread) {
    return { valid: true, kind: "THREAD_SPEC", nominal: Number(thread[1]), drawing: null, general: null };
  }
  const match = value.match(PLAIN_RE);
  if (!match) return { valid: false, kind: null, nominal: null, drawing: null, general: null };

  const prefix = match[1];
  const kind: DimensionKind = !prefix
    ? "LINEAR_DIMENSION"
    : prefix === "R"
      ? "RADIUS"
      : prefix === "C"
        ? "CHAMFER_SIZE"
        : "DIAMETER";
  const nominal = Number(match[2]);
  let drawing: ParsedDimension["drawing"] = null;
  if (match[3]) {
    drawing = { upper: Number(match[3]), lower: -Number(match[3]) };
  } else if (match[4]) {
    const a = Number(match[4]);
    const b = Number(match[5]);
    drawing = { upper: Math.max(a, b), lower: Math.min(a, b) };
  }
  return {
    valid: true,
    kind,
    nominal,
    drawing,
    general: drawing ? null : generalDeviation(kind, nominal),
  };
}

export const DIMENSION_EXAMPLES = "26, ⌀12±0.01, 26 +0.02/-0.01, R5, C0.5, M16";

/** 기하공차 공차값: 숫자만 (0.01, 1). 쉼표·글자가 섞이면 무효. */
/** 기하공차 값: 숫자, 또는 지름 공차역 표시가 붙은 숫자 (⌀0.2 — 위치도 등) */
export function isValidGdtValue(value: string): boolean {
  // '005'처럼 소수점이 빠진 값(0으로 시작하는 정수)은 유효하지 않다.
  return /^[Ø⌀∅]?(0|[1-9]\d*)(\.\d+)?$/.test(value.trim());
}

/**
 * eDOCr2가 가장 자주 틀린 모양: 소수점 뒤 0 하나를 빠뜨림 (0.0025 → 0.025, 값 10배).
 * 후보로만 보여주고 자동으로 바꾸지 않는다.
 */
export function droppedZeroCandidate(value: string): string | null {
  const match = value.trim().match(/^([Ø⌀∅]?)0\.(\d+)$/);
  if (!match) return null;
  return `${match[1]}0.0${match[2]}`;
}

export function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function formatRange(nominal: number, upper: number, lower: number, unit = "mm"): string {
  return `${formatNumber(nominal + lower)} ~ ${formatNumber(nominal + upper)} ${unit}`.trim();
}

export function formatDeviationPair(upper: number, lower: number): string {
  if (upper === -lower) return `±${formatNumber(upper)}`;
  const sign = (value: number) => (value >= 0 ? `+${formatNumber(value)}` : formatNumber(value));
  return `${sign(upper)} / ${sign(lower)}`;
}
