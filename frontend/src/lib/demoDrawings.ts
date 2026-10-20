/**
 * 목업 화면용 도면 데이터.
 * 도면을 바꾸면 그 도면의 추출 결과(치수·기하공차)로 측정 항목을 새로 만든다.
 * 데이터: public/drawings/ (data/build_demo_drawings.py 가 생성)
 */
import type { LabelAnchor } from "./admin/ocrTypes";
import { resolveGeometry } from "./textBox";

export interface DemoDrawingEntry {
  id: string;
  label: string;
  part_name?: string | null;
  part_no?: string | null;
  scale?: string | null;
  data: string;
  /** 업로드한 도면: 메모리에 있는 도면 데이터 */
  doc?: DemoDrawingDoc;
  uploaded?: boolean;
}

export interface DemoItem {
  id: string;
  category: "DIMENSION" | "GDT" | string;
  raw_text: string;
  position: { x: number; y: number };
  label_anchor?: LabelAnchor;
  /** 치수·기하공차 글자 영역 [x1, y1, x2, y2] (이미지 px) */
  text_box?: [number, number, number, number];
  row_index?: number;
  /** 형상 유형 (예: CHAMFER, HOLE). 없거나 UNKNOWN 이면 미확정 */
  feature_type?: string;
  measurement_characteristic?: string;
  nominal_value?: number | null;
  tol_type?: string;
  upper_deviation?: number | null;
  lower_deviation?: number | null;
  lower_limit?: number | null;
  upper_limit?: number | null;
  gdt_symbol?: string;
  gdt_type?: string;
  gdt_name_ko?: string;
  tolerance_value?: number | null;
  datum_references?: string[];
  requires_review?: boolean;
  review_reasons?: string[];
}

export interface DemoDrawingDoc {
  demo_id: string;
  part_name?: string | null;
  part_no?: string | null;
  drawing_scale?: string | null;
  material_raw?: string | null;
  image: { file: string; width_px: number; height_px: number };
  /** 업로드한 도면 이미지 주소 (있으면 file 대신 사용) */
  imageUrl?: string;
  /** 업로드 도면이 연결된 추출 결과 도면 ID */
  linked_drawing_id?: string | null;
  items: DemoItem[];
}

export interface ErrorCase {
  case_id: string;
  data_origin?: string;
  part_family?: string;
  feature_type?: string;
  tol_type?: string;
  error_category?: string;
  case_title?: string;
  error_description?: string;
  cause?: string;
  precaution?: string;
  recommended_instrument?: string;
  priority?: number | string;
}

const BASE = "/drawings/";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(`${path} 를 불러오지 못했습니다 (${response.status})`);
  return response.json() as Promise<T>;
}

export const fetchDemoIndex = () => getJson<DemoDrawingEntry[]>("index.json");
export const fetchDemoDrawing = (entry: DemoDrawingEntry) => getJson<DemoDrawingDoc>(entry.data);
export const fetchErrorCases = () => getJson<ErrorCase[]>("error_cases.json");
export const demoImageUrl = (doc: DemoDrawingDoc) => doc.imageUrl || BASE + doc.image.file;

// ------------------------------------------------------------ 공차
// 개별 공차가 없는 치수: 일반공차 ISO 2768-m (기획서 기준)
function iso2768m(nominal: number, kind: "linear" | "edge"): number | null {
  if (kind === "edge") {
    if (nominal <= 0.5) return null;
    if (nominal <= 3) return 0.2;
    if (nominal <= 6) return 0.5;
    return 1;
  }
  const table: [number, number][] = [[3, 0.1], [6, 0.1], [30, 0.2], [120, 0.3], [400, 0.5], [1000, 0.8], [2000, 1.2]];
  if (nominal <= 0.5) return null;
  return table.find(([max]) => nominal <= max)?.[1] ?? null;
}

const fmt = (value: number) => Number(value.toFixed(4)).toString();

// ------------------------------------------------------------ 측정기
const GDT_TOOL: Record<string, string> = {
  FLATNESS: "다이얼 인디케이터 + 정반",
  STRAIGHTNESS: "다이얼 인디케이터 + V블록",
  PARALLELISM: "다이얼 인디케이터 + 정반",
  PERPENDICULARITY: "직각자 + 다이얼 인디케이터",
  CIRCULARITY: "진원도 측정기",
  CYLINDRICITY: "진원도 측정기 (원통도)",
  CIRCULAR_RUNOUT: "다이얼 인디케이터 + V블록/센터",
  TOTAL_RUNOUT: "다이얼 인디케이터 + V블록/센터",
  CONCENTRICITY: "CMM (3차원 측정기)",
  POSITION: "CMM (3차원 측정기)",
  SYMMETRY: "CMM (3차원 측정기)",
};

function micrometerRange(nominal: number) {
  const low = Math.floor(nominal / 25) * 25;
  return `외경 마이크로미터 (${low}-${low + 25}mm)`;
}

// ------------------------------------------------------------ 오류사례 연결
// 측정항목의 형상·공차유형 태그와 같은 사례를 고르고 중요도 순으로 상위 3건
const GDT_TAGS: Record<string, [string | null, string | null]> = {
  FLATNESS: ["PLANE", "FLATNESS"],
  PARALLELISM: ["PLANE", "PARALLELISM"],
  PERPENDICULARITY: ["PLANE", "PERPENDICULARITY"],
  CIRCULARITY: ["SHAFT", "ROUNDNESS"],
  CYLINDRICITY: ["SHAFT", "ROUNDNESS"],
  STRAIGHTNESS: ["SHAFT", null],
  CIRCULAR_RUNOUT: ["SHAFT", "RUNOUT"],
  TOTAL_RUNOUT: ["SHAFT", "RUNOUT"],
  CONCENTRICITY: ["SHAFT", "RUNOUT"],
  POSITION: [null, "POSITION"],
  SYMMETRY: ["SLOT", "POSITION"],
};
const DIM_TAGS: Record<string, [string | null, string | null]> = {
  DIAMETER: ["SHAFT", "DIMENSION"],
  LINEAR_DIMENSION: [null, "DIMENSION"],
  CHAMFER_SIZE: ["CHAMFER", "DIMENSION"],
  RADIUS: ["RADIUS", "DIMENSION"],
  THREAD_SPEC: ["THREAD", "THREAD_SPEC"],
};
const SEVERITY: Record<number, string> = { 5: "상", 4: "중", 3: "하" };

function matchCases(item: DemoItem, cases: ErrorCase[]) {
  const [feature, tol] =
    item.category === "GDT"
      ? GDT_TAGS[item.gdt_type || ""] || [null, null]
      : DIM_TAGS[item.measurement_characteristic || ""] || [null, null];
  return cases
    .map((c) => {
      const featureHit = !!feature && c.feature_type === feature;
      const tolHit = !!tol && c.tol_type === tol;
      const score = (featureHit ? 3 : 0) + (tolHit ? 3 : 0) + (c.part_family === "피스톤 로드" ? 1 : 0) + Number(c.priority || 0) * 0.2;
      return { c, featureHit, tolHit, score };
    })
    .filter((m) => m.featureHit || m.tolHit)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ------------------------------------------------------------ 측정 항목 만들기
const KIND: Record<string, { name: string; type: string }> = {
  DIAMETER: { name: "외경", type: "SHAFT" },
  LINEAR_DIMENSION: { name: "길이", type: "LENGTH" },
  CHAMFER_SIZE: { name: "모따기", type: "CHAMFER" },
  RADIUS: { name: "라운드", type: "RADIUS" },
  THREAD_SPEC: { name: "나사부", type: "THREAD" },
};

export function buildInspectionPoints(doc: DemoDrawingDoc, cases: ErrorCase[]) {
  const counters: Record<string, number> = {};
  return doc.items.map((item, index) => {
    const id = index + 1;
    const geometry = resolveGeometry(item as any, doc.image.width_px);
    const isGdt = item.category === "GDT";
    const kind = isGdt
      ? { name: item.gdt_name_ko || "기하공차", type: "GD&T" }
      : KIND[item.measurement_characteristic || ""] || { name: "치수", type: "DIM" };
    counters[kind.name] = (counters[kind.name] || 0) + 1;

    let formatted = item.raw_text;
    let tolerance = "";
    let lower: number | null = null;
    let upper: number | null = null;
    let rangeText = "";
    let gdgt = "";
    let measuringTool = "버니어 캘리퍼스";
    let description = "";
    const nominal = item.nominal_value ?? null;

    if (isGdt) {
      const value = item.tolerance_value ?? null;
      const datums = item.datum_references || [];
      formatted = `${item.gdt_symbol || ""} ${value ?? "?"}`.trim();
      tolerance = value != null ? `≤ ${value}` : "값 확인 필요";
      gdgt = datums.length ? datums.join(", ") : "";
      lower = value != null ? 0 : null;
      upper = value;
      rangeText = value != null ? `0 ~ ${value} mm 이내` : "공차 값 확인 필요";
      measuringTool = GDT_TOOL[item.gdt_type || ""] || "다이얼 인디케이터";
      description = `기하공차 ${kind.name}${datums.length ? ` · 데이텀 ${datums.join(", ")}` : " · 데이텀 없음"}`;
    } else if (item.measurement_characteristic === "THREAD_SPEC") {
      tolerance = "나사 규격";
      rangeText = "나사 게이지 통과/정지 판정";
      measuringTool = `나사 링 게이지 (${item.raw_text})`;
      description = `나사 ${item.raw_text} · 피치·등급은 규격 확인`;
    } else if (typeof item.lower_limit === "number" && typeof item.upper_limit === "number") {
      // 도면에 개별 공차가 적힌 치수
      lower = item.lower_limit;
      upper = item.upper_limit;
      tolerance =
        item.tol_type === "DEVIATION" && item.upper_deviation != null && item.lower_deviation != null
          ? `${item.upper_deviation >= 0 ? "+" : ""}${item.upper_deviation} / ${item.lower_deviation}`
          : nominal != null ? `±${fmt((upper - lower) / 2)}` : "개별 공차";
      rangeText = `${fmt(lower)} ~ ${fmt(upper)} mm`;
      description = `도면 표기 ${item.raw_text} · 개별 공차`;
    } else if (nominal != null) {
      // 개별 공차가 없는 치수 → 일반공차 ISO 2768-m 가정
      const edge = item.measurement_characteristic === "CHAMFER_SIZE" || item.measurement_characteristic === "RADIUS";
      const t = iso2768m(nominal, edge ? "edge" : "linear");
      if (t != null) {
        lower = nominal - t;
        upper = nominal + t;
        tolerance = `±${t} (일반공차)`;
        rangeText = `${fmt(lower)} ~ ${fmt(upper)} mm`;
      } else {
        tolerance = "일반공차 확인";
        rangeText = "허용 범위 확인 필요";
      }
      description = `도면 표기 ${item.raw_text} · 공차 미기입 → 일반공차 ISO 2768-m 적용`;
    }

    if (!isGdt) {
      if (item.measurement_characteristic === "DIAMETER" && nominal != null) measuringTool = micrometerRange(nominal);
      else if (item.measurement_characteristic === "CHAMFER_SIZE") measuringTool = "모따기 게이지";
      else if (item.measurement_characteristic === "RADIUS") measuringTool = "R 게이지";
      else if (item.measurement_characteristic === "LINEAR_DIMENSION" && nominal != null && nominal > 150) measuringTool = "버니어 캘리퍼스 (0-300mm)";
    }

    const matches = matchCases(item, cases);
    const errorCases = matches.map(({ c, featureHit, tolHit }) => ({
      title: c.case_title || c.case_id,
      meta: `${c.case_id}${c.data_origin === "SYNTHETIC" ? " · 가상 사례" : ""} · 중요도 ${SEVERITY[Number(c.priority)] || "-"} · 일치: ${[featureHit && "형상", tolHit && "공차유형"].filter(Boolean).join("·")}`,
      cause: [c.error_description, c.cause && `(${c.cause})`].filter(Boolean).join(" "),
      solution: c.precaution || "",
    }));
    const top = matches[0]?.c;

    return {
      id,
      displayNumber: id,
      sourceId: item.id,
      x: item.position.x,
      y: item.position.y,
      labelAnchor: geometry.labelAnchor,
      textBox: geometry.textBox,
      boxEstimated: geometry.estimated,
      featureType: item.feature_type,
      feature: { name: `${kind.name} ${counters[kind.name]}`, type: kind.type },
      dimension: { formatted, nominal, tolerance, lower, upper, rangeText },
      gdgt,
      measuringTool,
      description,
      ragGuide: top
        ? `[${top.error_category || "측정"}] ${top.precaution}${top.recommended_instrument ? ` (권장 측정기: ${top.recommended_instrument})` : ""}`
        : "연결된 오류 사례가 없습니다. 표준 측정 절차를 따르십시오.",
      errorCases,
      items: [{ id: `${item.id}-item`, name: kind.name, spec: formatted }],
    };
  });
}

export type InspectionPoint = ReturnType<typeof buildInspectionPoints>[number];
