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

export type DimensionKind = "LINEAR_DIMENSION" | "DIAMETER" | "CHAMFER_SIZE" | "RADIUS" | "THREAD_SPEC" | "SURFACE_ROUGHNESS";

export function generalDeviation(kind: DimensionKind | null, nominal: number | null): number | null {
  if (nominal === null || !Number.isFinite(nominal)) return null;
  if (kind === "LINEAR_DIMENSION" || kind === "DIAMETER") return lookup(LINEAR_M, nominal);
  if (kind === "CHAMFER_SIZE" || kind === "RADIUS") return lookup(EDGE_M, nominal);
  return null;
}

const NUM = String.raw`\d+(?:\.\d+)?`;
const THREAD_RE = new RegExp(String.raw`^M\s*(${NUM})(?:\s*[x×]\s*(${NUM}))?$`);
// 표면 거칠기: Ra 0.8 (OCR이 앞자리 0을 뺀 .8 포함). 백엔드 ocr_metadata.parse_dimension 과 같은 규칙.
const ROUGHNESS_RE = new RegExp(String.raw`^Ra\s*(\d+(?:\.\d+)?|\.\d+)$`);
// 공차 한쪽 값: 부호 있는 숫자(OCR이 앞자리 0을 뺀 +.08 포함) 또는 부호 없는 0.
// 부호 없는 0 이 아닌 값(0.07)은 상·하한 구분이 불가능해 읽지 않는다. (백엔드 ocr_metadata.DEVIATION 과 같은 규칙)
const DEV = String.raw`(?:[+-](?:\d+(?:\.\d+)?|\.\d+)|0(?:\.0+)?)`;
// 공차 표기: ±0.05 / +0.02/-0.01 / (+0.08/0) 괄호
const PLAIN_RE = new RegExp(
  String.raw`^([⌀Øø]|R|C)?\s*(${NUM})(?:\s*±\s*(${NUM})|\s*\(\s*(${DEV})\s*/\s*(${DEV})\s*\)|\s*(${DEV})\s*/\s*(${DEV}))?$`,
);

export interface ParsedDimension {
  valid: boolean;
  kind: DimensionKind | null;
  nominal: number | null;
  /** 도면에 적힌 공차 (없으면 null) */
  drawing: { upper: number; lower: number } | null;
  /** 개별 공차가 없을 때 적용할 일반공차 ± (적용 불가면 null) */
  general: number | null;
  /** 표면 거칠기 Ra 값 (µm). 표면 거칠기 표기일 때만 */
  roughness?: number;
}

export function parseDimension(text: string): ParsedDimension {
  const value = text.trim();
  const thread = value.match(THREAD_RE);
  if (thread) {
    return { valid: true, kind: "THREAD_SPEC", nominal: Number(thread[1]), drawing: null, general: null };
  }
  const rough = value.match(ROUGHNESS_RE);
  if (rough) {
    return { valid: true, kind: "SURFACE_ROUGHNESS", nominal: null, drawing: null, general: null, roughness: Number(rough[1]) };
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
  } else if (match[4] || match[6]) {
    // 괄호 표기(4·5번 그룹)와 괄호 없는 표기(6·7번 그룹) 중 하나
    const a = Number(match[4] ?? match[6]);
    const b = Number(match[5] ?? match[7]);
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

/**
 * 괄호 공차가 붙은 치수 표기를 기준치수와 공차로 나눈다: '⌀680(+.08/0)' → { base: '⌀680', upper: 0.08, lower: 0 }.
 * 괄호 공차가 없거나(±, 괄호 없는 +x/-y 포함) 해석할 수 없으면 null. 원문은 바꾸지 않고 화면 초기값에만 쓴다.
 */
export function splitParenTolerance(text: string): { base: string; upper: number; lower: number } | null {
  const value = text.trim();
  const match = value.match(PLAIN_RE);
  if (!match || !match[4]) return null;
  const parsed = parseDimension(value);
  if (!parsed.valid || !parsed.drawing) return null;
  return { base: value.slice(0, value.indexOf("(")).trim(), upper: parsed.drawing.upper, lower: parsed.drawing.lower };
}

/**
 * 숫자 입력칸(특별 공차 편차 등) 값 해석. OCR 원문 표기에는 쓰지 않는다.
 * '.3' → 0.3, '-.3' → -0.3, '+0.05' → 0.05. ',3'·'1e3'·'0x1'·빈 값처럼 소수 표기가 아니면 null (임의로 바꾸지 않는다).
 */
export function parseDecimal(text: string): number | null {
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 숫자 입력칸을 벗어날 때 보기 좋게 정규화한다 ('.3' → '0.3', '-.3' → '-0.3', '1.' → '1'). 형식이 틀리면 그대로 둔다. */
export function normalizeDecimalText(text: string): string {
  const value = text.trim();
  if (parseDecimal(value) === null) return text;
  return value.replace(/^([+-]?)\./, "$10.").replace(/\.$/, "");
}

/** 기하공차 공차값 입력칸: 지름 기호를 둔 채 숫자 부분만 정규화 ('⌀.2' → '⌀0.2'). */
export function normalizeGdtValueText(text: string): string {
  const match = text.trim().match(/^([Ø⌀∅]?)(.*)$/);
  if (!match) return text;
  const normalized = normalizeDecimalText(match[2]);
  return normalized === match[2] && parseDecimal(match[2]) === null ? text : `${match[1]}${normalized.replace(/^\+/, "")}`;
}

export const DIMENSION_EXAMPLES = "26, ⌀12±0.01, 26 +0.02/-0.01, ⌀680(+0.08/0), R5, C0.5, M16, Ra 0.8";

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

/** 상·하한 편차 입력칸에 채울 부호 포함 문자열 (+0.08 / 0 / -0.16) */
export function deviationText(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

export function formatDeviationPair(upper: number, lower: number): string {
  if (upper === -lower) return `±${formatNumber(upper)}`;
  const sign = (value: number) => (value >= 0 ? `+${formatNumber(value)}` : formatNumber(value));
  return `${sign(upper)} / ${sign(lower)}`;
}
