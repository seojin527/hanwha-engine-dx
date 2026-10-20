// 관리자 수정값을 팀원이 만든 측정 항목 위에 덮어쓰는 층.
//
// 흐름: 도면 추출 결과(DemoDrawingDoc) + 관리자 수정값(ItemEdit)
//        → applyEditsToDoc 로 항목 값을 바꾼 사본을 만들고
//        → 팀원의 buildInspectionPoints 로 측정 항목(허용 범위·측정기·표시 문구)을 다시 만든다.
// 그래서 판정(judgeMeasurement)과 화면은 팀원 코드 그대로 두고, 값만 바뀐 결과를 쓴다.
// 추출 결과(public/drawings/*.json)와 팀원 코드는 수정하지 않는다.

import {
  buildInspectionPoints,
  type DemoDrawingDoc,
  type DemoItem,
  type ErrorCase,
  type InspectionPoint,
} from "../demoDrawings";
import { judgeMeasurement } from "./inspection";
import { hasValueEdit, type AddedDimension, type AddKind, type ItemEdit } from "./adminStore";
import { findHighlight, type Point } from "./highlights";

/** 팀원 측정 항목 + 관리자 수정 표시 */
export type AdminPoint = InspectionPoint & {
  /** 값(기준 치수·공차·데이텀·측정기)을 관리자가 바꿨는가 */
  adminEdited: boolean;
  /** 관리자가 확인을 마쳤는가 */
  confirmed: boolean;
  /** 값이 깨졌거나 읽지 못한 항목이면 그 이유, 아니면 null (수정값을 반영한 현재 값 기준) */
  warning: string | null;
  /** 관리자가 직접 추가한 항목인가 (OCR 누락 보충) */
  added: boolean;
  /** 이 항목을 눌렀을 때 도면에서 강조할 선들. 알 수 없으면 undefined */
  highlight: Point[][] | undefined;
};

const ADD_CHARACTERISTIC: Record<AddKind, string> = {
  LINEAR: "LINEAR_DIMENSION",
  DIAMETER: "DIAMETER",
  RADIUS: "RADIUS",
  CHAMFER: "CHAMFER_SIZE",
  THREAD: "THREAD_SPEC",
};

export const ADD_KIND_LABEL: Record<AddKind, string> = {
  LINEAR: "길이",
  DIAMETER: "지름 ⌀",
  RADIUS: "반경 R",
  CHAMFER: "모따기 C",
  THREAD: "나사 M",
};

/** 관리자가 추가한 치수를 도면 항목 목록 끝에 붙인 사본 (공차는 도면에 없으므로 일반공차 처리) */
export function withAddedItems(doc: DemoDrawingDoc, added: AddedDimension[] | undefined): DemoDrawingDoc {
  if (!added || added.length === 0) return doc;
  const items: DemoItem[] = added.map((entry) => {
    const characteristic = ADD_CHARACTERISTIC[entry.kind];
    return {
      id: entry.id,
      category: "DIMENSION",
      raw_text: dimensionText(characteristic, entry.nominal),
      position: { x: entry.x, y: entry.y },
      measurement_characteristic: characteristic,
      nominal_value: entry.nominal,
      tol_type: "UNSPECIFIED",
    };
  });
  return { ...doc, items: [...doc.items, ...items] };
}

/** 이 도면은 항목 위치가 HDH_63 도면 형식(2339×1654)이라 선 강조 자료를 쓸 수 있는가 */
function supportsHighlight(doc: DemoDrawingDoc): boolean {
  return doc.image.width_px === 2339 && doc.image.height_px === 1654;
}

/** 깨진 값으로 보이는 문구: 쉼표·콜론, 소수점이 앞이나 끝에 홀로 있는 경우 등 (예: ",.2", "5.") */
const BROKEN_VALUE = /[,;:]|^[⌀Øø]?[RCM]?\s*\.|\.\.|\.\s*$/;

/**
 * 추출 값이 믿기 어려운 항목에 이유를 돌려준다. (화면 규칙. 검수 서버가 켜져 있으면 기하공차는 서버 /review 판단을 쓴다: App.tsx)
 * item 은 관리자 수정값이 이미 반영된 항목이어야 한다.
 */
export function reviewWarning(item: DemoItem): string | null {
  if (BROKEN_VALUE.test(item.raw_text)) return `깨진 값으로 보입니다 ("${item.raw_text}")`;
  if (item.category === "GDT") {
    if (item.tolerance_value === null || item.tolerance_value === undefined) return "공차값을 읽지 못했습니다";
  } else if (item.nominal_value === null || item.nominal_value === undefined) {
    return "기준 치수를 읽지 못했습니다";
  }
  return null;
}

export interface Readiness {
  ready: boolean;
  total: number;
  /** 확인 완료한 전체 항목 수 */
  confirmedTotal: number;
  /** 기하공차 개수와 확인 완료 개수 */
  gdtTotal: number;
  gdtConfirmed: number;
  /** ⚠ 항목 개수와 그중 확인 완료 개수 */
  warnTotal: number;
  warnConfirmed: number;
  /** 검토를 완료하려면 아직 확인해야 하는 항목의 화면 번호 */
  pendingNumbers: number[];
}

/**
 * 검토 완료 조건: 치수·기하공차·⚠ 항목을 포함해 모든 항목을 관리자가 확인해야 한다.
 */
export function computeReadiness(points: AdminPoint[]): Readiness {
  const gdt = points.filter((point) => point.feature.type === "GD&T");
  const warn = points.filter((point) => point.warning);
  const pending = points.filter((point) => !point.confirmed);
  return {
    ready: points.length > 0 && pending.length === 0,
    total: points.length,
    confirmedTotal: points.filter((point) => point.confirmed).length,
    gdtTotal: gdt.length,
    gdtConfirmed: gdt.filter((point) => point.confirmed).length,
    warnTotal: warn.length,
    warnConfirmed: warn.filter((point) => point.confirmed).length,
    pendingNumbers: pending.map((point) => point.displayNumber),
  };
}

const round = (value: number) => Number(value.toFixed(4));

export type ItemKind = "DIM" | "THREAD" | "GDT";

export function itemKind(item: DemoItem): ItemKind {
  if (item.category === "GDT") return "GDT";
  return item.measurement_characteristic === "THREAD_SPEC" ? "THREAD" : "DIM";
}

/** 도면에 쓰는 치수 문구. (추출 결과와 같은 표기: ⌀36, R8, C2, M12) */
function dimensionText(characteristic: string | undefined, nominal: number): string {
  const prefix =
    characteristic === "DIAMETER" ? "⌀" : characteristic === "RADIUS" ? "R" : characteristic === "CHAMFER_SIZE" ? "C" : characteristic === "THREAD_SPEC" ? "M" : "";
  return `${prefix}${nominal}`;
}

/** 데이텀 입력 문자열 → 배열. 예: "A, B" → ["A","B"] */
export function parseDatums(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

/** 항목 하나에 수정값을 적용한 사본. 수정이 없으면 원래 항목을 그대로 돌려준다. */
export function applyEditToItem(item: DemoItem, edit: ItemEdit | undefined): DemoItem {
  if (!hasValueEdit(edit) || !edit) return item;
  const next: DemoItem = { ...item };
  if (edit.featureType !== undefined) next.feature_type = edit.featureType;

  if (item.category === "GDT") {
    if (edit.toleranceValue !== undefined) next.tolerance_value = edit.toleranceValue;
    if (edit.datum !== undefined) next.datum_references = parseDatums(edit.datum);
    if (edit.toleranceValue !== undefined || edit.datum !== undefined) {
      const datums = next.datum_references || [];
      next.raw_text = [item.gdt_symbol || "", next.tolerance_value ?? "", datums.join(",")]
        .filter((part, index) => index < 2 || part !== "")
        .join("|");
    }
    return next;
  }

  // 치수: 기준 치수가 바뀌어도 도면에 적힌 공차(상·하한 편차)는 그대로 유지한다.
  const nominal0 = item.nominal_value;
  const hasLimits =
    typeof nominal0 === "number" && typeof item.lower_limit === "number" && typeof item.upper_limit === "number";
  const curPlus = hasLimits ? item.upper_limit! - nominal0! : undefined;
  const curMinus = hasLimits ? nominal0! - item.lower_limit! : undefined;
  const nominal = edit.nominal ?? nominal0 ?? null;

  if (edit.nominal !== undefined) {
    next.nominal_value = edit.nominal;
    next.raw_text = dimensionText(item.measurement_characteristic, edit.nominal);
  }

  const plus = edit.plus ?? curPlus;
  const minus = edit.minus ?? curMinus;
  if (itemKind(item) === "DIM" && typeof nominal === "number" && plus !== undefined && minus !== undefined) {
    next.upper_limit = round(nominal + plus);
    next.lower_limit = round(nominal - minus);
    next.upper_deviation = round(plus);
    next.lower_deviation = round(-minus);
    next.tol_type = plus === minus ? "SYMMETRIC" : "DEVIATION";
  }
  return next;
}

/** 도면 전체에 수정값을 적용한 사본 (항목 id → 수정값) */
export function applyEditsToDoc(doc: DemoDrawingDoc, edits: Record<string, ItemEdit> | undefined): DemoDrawingDoc {
  if (!edits || !Object.values(edits).some(hasValueEdit)) return doc;
  return { ...doc, items: doc.items.map((item) => applyEditToItem(item, edits[item.id])) };
}

/** 관리자 수정이 반영된 측정 항목 목록 */
export function buildPointsWithEdits(
  doc: DemoDrawingDoc,
  cases: ErrorCase[],
  edits: Record<string, ItemEdit> | undefined,
  added?: AddedDimension[],
): AdminPoint[] {
  const applied = applyEditsToDoc(doc, edits);
  const addedById = new Map((added || []).map((entry) => [entry.id, entry]));
  const canHighlight = supportsHighlight(doc);
  const points = buildInspectionPoints(applied, cases);
  return points.map((point, index) => {
    const edit = edits?.[point.sourceId];
    const edited = hasValueEdit(edit);
    return {
      ...point,
      measuringTool: edit?.equipment ?? point.measuringTool,
      description: edited ? `${point.description} · 관리자 수정` : point.description,
      adminEdited: edited && !addedById.has(point.sourceId),
      confirmed: !!edit?.confirmed,
      warning: reviewWarning(applied.items[index]),
      added: addedById.has(point.sourceId),
      highlight: addedById.has(point.sourceId)
        ? addedById.get(point.sourceId)!.lines
        : canHighlight
          ? findHighlight(doc.items[index])
          : undefined,
    };
  });
}

/**
 * 수정값이 바뀐 뒤에도 작업자가 입력한 실측값은 그대로 두고, 판정만 새 허용 범위로 다시 계산한다.
 * (게이지 판정 기록은 숫자 판정이 아니므로 그대로 둔다.)
 */
export function reevaluateRecords(
  points: AdminPoint[],
  records: Record<number, any>,
): Record<number, any> {
  const next: Record<number, any> = { ...records };
  for (const point of points) {
    const record = records[point.id];
    if (!record || typeof record.measuredValue !== "string" || record.measuredValue.trim() === "") continue;
    if (/^(NO-)?GO/.test(record.measuredValue)) continue;
    const isGdt = point.feature?.type === "GD&T";
    next[point.id] = { ...record, ...judgeMeasurement(record.measuredValue, point.dimension || {}, isGdt) };
  }
  return next;
}

/** 관리자 모드에서 마커 색을 보여주기 위한 기록: 확인 완료한 항목만 "완료"로 표시한다. */
export function buildConfirmRecords(points: AdminPoint[]): Record<number, any> {
  const records: Record<number, any> = {};
  for (const point of points) {
    if (point.confirmed) records[point.id] = { pointId: point.id, status: "completed", measuredValue: "" };
  }
  return records;
}

// ---------------------------------------------------------------------------
// 항목의 "현재 값"
// ---------------------------------------------------------------------------

export interface ItemValues {
  kind: ItemKind;
  nominal: number | null;
  /** 상한 = 기준 치수 + plus */
  plus: number | null;
  /** 하한 = 기준 치수 − minus */
  minus: number | null;
  tolerance: number | null;
  datum: string;
  equipment: string;
  /** 도면에 공차가 없어 일반공차(ISO 2768-m)를 쓰는가 */
  generalTolerance: boolean;
}

/** 수정값을 반영한 항목의 현재 값. edit 를 비우면 도면 추출 값(원래 값)이다. */
export function readValues(doc: DemoDrawingDoc, item: DemoItem, edit: ItemEdit | undefined): ItemValues {
  const applied = applyEditToItem(item, edit);
  const point = buildInspectionPoints({ ...doc, items: [applied] }, [])[0];
  const kind = itemKind(item);
  const nominal = applied.nominal_value ?? null;
  const { lower, upper } = point.dimension;
  const hasRange = kind === "DIM" && typeof lower === "number" && typeof upper === "number" && nominal !== null;
  return {
    kind,
    nominal,
    plus: hasRange ? round(upper! - nominal!) : null,
    minus: hasRange ? round(nominal! - lower!) : null,
    tolerance: kind === "GDT" ? applied.tolerance_value ?? null : null,
    datum: (applied.datum_references || []).join(", "),
    equipment: edit?.equipment ?? point.measuringTool,
    generalTolerance: String(point.dimension.tolerance || "").includes("일반공차"),
  };
}

const NONE = "(없음)";
const num = (value: number | null) => (value === null ? NONE : String(value));

export interface FieldValue {
  key: keyof ItemEdit;
  label: string;
  value: string;
}

/** 화면과 수정 내역에 쓰는 필드 목록 */
export function describeFields(values: ItemValues): FieldValue[] {
  if (values.kind === "GDT") {
    return [
      { key: "toleranceValue", label: "공차값", value: num(values.tolerance) },
      { key: "datum", label: "데이텀", value: values.datum || NONE },
      { key: "equipment", label: "측정기", value: values.equipment },
    ];
  }
  if (values.kind === "THREAD") {
    return [
      { key: "nominal", label: "기준 치수", value: num(values.nominal) },
      { key: "equipment", label: "측정기", value: values.equipment },
    ];
  }
  return [
    { key: "nominal", label: "기준 치수", value: num(values.nominal) },
    { key: "plus", label: "상한 공차(+)", value: num(values.plus) },
    { key: "minus", label: "하한 공차(-)", value: num(values.minus) },
    { key: "equipment", label: "측정기", value: values.equipment },
  ];
}

/** prev → next 로 바뀐 필드 목록 (수정 내역에 한 줄씩 남긴다) */
export function diffEdit(
  doc: DemoDrawingDoc,
  item: DemoItem,
  prev: ItemEdit | undefined,
  next: ItemEdit | undefined,
): Array<{ field: string; from: string; to: string }> {
  const before = describeFields(readValues(doc, item, prev));
  const after = describeFields(readValues(doc, item, next));
  const changes: Array<{ field: string; from: string; to: string }> = [];
  after.forEach((field, index) => {
    if (field.value !== before[index].value) changes.push({ field: field.label, from: before[index].value, to: field.value });
  });
  if (!!prev?.confirmed !== !!next?.confirmed) {
    changes.push({
      field: "확인 상태",
      from: prev?.confirmed ? "확인 완료" : "미확인",
      to: next?.confirmed ? "확인 완료" : "미확인",
    });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// 입력 → 수정값
// ---------------------------------------------------------------------------

export interface EditInput {
  nominal: string;
  plus: string;
  minus: string;
  tolerance: string;
  datum: string;
  equipment: string;
}

export function inputFromValues(values: ItemValues): EditInput {
  const text = (value: number | null) => (value === null ? "" : String(value));
  return {
    nominal: text(values.nominal),
    plus: text(values.plus),
    minus: text(values.minus),
    tolerance: text(values.tolerance),
    datum: values.datum,
    equipment: values.equipment,
  };
}

function parseNumber(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value);
}

/**
 * 입력값을 수정값으로 바꾼다. 도면 원래 값과 같은 필드는 수정값으로 저장하지 않는다.
 * 값이 올바르지 않으면 error 를 돌려준다.
 */
export function buildEditFromInput(
  doc: DemoDrawingDoc,
  item: DemoItem,
  prevEdit: ItemEdit | undefined,
  input: EditInput,
): { edit: ItemEdit | undefined; error?: string } {
  const base = readValues(doc, item, undefined);
  const edit: ItemEdit = {};
  if (prevEdit?.confirmed) edit.confirmed = true;
  if (prevEdit?.featureType !== undefined) edit.featureType = prevEdit.featureType;

  if (base.kind === "GDT") {
    const tolerance = parseNumber(input.tolerance);
    if (tolerance === null || tolerance <= 0) return { edit: prevEdit, error: "공차값은 0보다 큰 숫자로 입력하세요." };
    if (tolerance !== base.tolerance) edit.toleranceValue = tolerance;
    const datum = parseDatums(input.datum).join(", ");
    if (datum !== base.datum) edit.datum = datum;
  } else {
    const nominal = parseNumber(input.nominal);
    if (nominal === null || nominal <= 0) return { edit: prevEdit, error: "기준 치수는 0보다 큰 숫자로 입력하세요." };
    if (nominal !== base.nominal) edit.nominal = nominal;

    if (base.kind === "DIM") {
      const plus = parseNumber(input.plus);
      const minus = parseNumber(input.minus);
      const bothEmpty = input.plus.trim() === "" && input.minus.trim() === "";
      const changedPlus = input.plus.trim() !== (base.plus === null ? "" : String(base.plus));
      const changedMinus = input.minus.trim() !== (base.minus === null ? "" : String(base.minus));
      if (!bothEmpty && (changedPlus || changedMinus)) {
        if (plus === null || minus === null) {
          return { edit: prevEdit, error: "상한·하한 공차를 둘 다 숫자로 입력하세요. (예: ±0.1 → 0.1 / 0.1)" };
        }
        if (plus + minus <= 0) return { edit: prevEdit, error: "상한이 하한보다 커야 합니다." };
        edit.plus = plus;
        edit.minus = minus;
      }
    }
  }

  const equipment = input.equipment.trim();
  if (equipment !== "" && equipment !== base.equipment) edit.equipment = equipment;

  return { edit: Object.keys(edit).length > 0 ? edit : undefined };
}


/** 점 하나를 눌렀을 때의 추가 항목 만들기 (id 는 호출하는 쪽의 nextOrder 로 정한다) */
export function makeAddedDimension(
  order: number,
  kind: AddKind,
  nominal: number,
  x: number,
  y: number,
  lines: Point[][] | undefined,
): AddedDimension {
  return { id: `ADM${order}`, order, kind, nominal, x, y, ...(lines && lines.length ? { lines } : {}) };
}
