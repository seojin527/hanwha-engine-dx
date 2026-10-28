import { useEffect, useMemo, useRef, useState } from "react";
import { useReportUnsaved } from "../lib/unsavedChanges";
import {
  saveDrawingReview,
  type DrawingReviewResponse,
  type DrawingReviewSource,
  type ReviewDimension,
  type ReviewGdtRow,
  type ReviewPreviewMarker,
  type InspectionSetting,
} from "../lib/admin/drawingReviewAPI";
import type { OcrItem } from "../lib/ocr";
import {
  DIMENSION_EXAMPLES,
  GENERAL_LABEL,
  droppedZeroCandidate,
  formatDeviationPair,
  formatNumber,
  formatRange,
  isValidGdtValue,
  normalizeDecimalText,
  normalizeGdtValueText,
  parseDecimal,
  parseDimension,
  type ParsedDimension,
  type ToleranceSource,
} from "../lib/inspection/tolerance";
import {
  FEATURE_LABEL,
  FORM_SYMBOLS,
  GDT_SYMBOLS,
  allowedFeatures,
  gdtSymbolName,
  recommendedInstruments,
  threadCriteria,
} from "../lib/inspection/instruments";
import ItemHeader, { Chip, ProgressBar } from "./review/ItemHeader";
import InstrumentSelect from "./review/InstrumentSelect";
import OcrCrop, { dimensionCropBox, gdtCropBox } from "./review/OcrCrop";

interface Props {
  source: DrawingReviewSource;
  onSaved: (result: DrawingReviewResponse) => void;
  onSelectItem?: (itemId: string) => void;
  onPickPosition?: () => Promise<{ x: number; y: number } | null>;
  onPreviewChange?: (markers: ReviewPreviewMarker[]) => void;
  selectedItemId?: string | null;
  /** OCR 결과 이미지 (항목 부분을 잘라서 보여줌) */
  imageUrl?: string | null;
  /** 검토자 칸의 처음 값 (시작 화면에서 입력한 이름. 인증된 사용자 아님, 수정 가능) */
  defaultReviewer?: string;
}

interface Draft {
  mode: "numeric" | "gauge";
  feature: string;
  /** "" = 정할 근거가 없어 관리자가 골라야 함 (설정 필요) */
  toleranceSource: ToleranceSource | "";
  upper: string;
  lower: string;
  unit: string;
  instrument: string;
  /** true면 추천 규칙으로 채운 측정기 (형상을 바꾸면 추천도 따라 바뀐다). 관리자가 고르면 false */
  instrumentAuto: boolean;
  /** 시스템 기본값이 그대로 들어 있는 설정 필드 (서버 이름). 관리자가 바꾸면 빠진다. */
  defaults: string[];
  criteria: string;
  /** false면 기하공차·나사 판정 기준 문구를 확정 값으로 자동 작성 */
  criteriaEdited: boolean;
}

interface AddedDimension {
  id: string;
  text: string;
  x: string;
  y: string;
}

type Filter = "all" | "DIMENSION" | "GDT" | "needs" | "unconfirmed" | "invalid" | "edited";

/**
 * 항목 상태. 기본값 적용과 사람의 검토 확정을 구분한다.
 * - needs: 저장을 막는 문제가 있음 (설정 필요·형식 오류)
 * - default: 인식값·추천 규칙으로 채운 기본값 그대로 (아직 사람이 확정하지 않음)
 * - edited: 관리자가 이번에 고침
 * - saved: 이전에 저장한 관리자 설정 그대로
 * 검토 확정은 「검토 완료 및 서버 저장」이 성공했을 때 전체 항목에 한 번에 일어난다.
 */
type ItemStatus = "needs" | "default" | "edited" | "saved" | "excluded";

const STATUS_LABEL: Record<ItemStatus, string> = {
  needs: "설정 필요",
  default: "기본값 적용",
  edited: "관리자 수정",
  saved: "저장된 설정",
  excluded: "오인식 제외",
};

const STATUS_TONE = { needs: "warn", default: "neutral", edited: "info", saved: "ok", excluded: "neutral" } as const;

const inputClass = "field text-[13px]";
/** 관리자가 고칠 수 있는 값: 왼쪽 강조선으로 편집 대상임을 구분한다. */
const editClass = "field text-[13px] border-l-2 border-l-cyan-600";
const cardClass = "card space-y-3 p-3";

function itemNumber(item: OcrItem) {
  return Number(item.id.match(/_(\d+)$/)?.[1]);
}

function characteristicName(item: OcrItem) {
  const names: Record<string, string> = {
    DIAMETER: "지름",
    THREAD_SPEC: "나사",
    CHAMFER_SIZE: "모따기",
    RADIUS: "반지름",
    LINEAR_DIMENSION: "길이",
    GEOMETRIC_TOLERANCE: "기하공차",
  };
  return names[item.measurement_characteristic ?? ""] ?? (item.category === "GDT" ? "기하공차" : "치수");
}

// ---------------------------------------------------------------- 프로젝트 기본값
// 새 도면을 열면 모든 항목을 바로 저장할 수 있게 채운다. 관리자는 언제든 바꿀 수 있고,
// 저장된 관리자 설정은 덮어쓰지 않는다. 기본값으로 채웠다고 승인되지는 않는다 (저장 버튼이 확정).

/** 표기로 형상을 하나로 정할 수 없을 때의 프로젝트 기본 형상 (숫자만 → 평면·길이, ⌀ → 축·외경) */
const PROJECT_FEATURE: Record<string, string> = { LINEAR_DIMENSION: "PLANE", DIAMETER: "SHAFT" };
/** 추천 규칙으로 측정기를 정할 수 없을 때의 프로젝트 기본 측정기 */
const PROJECT_INSTRUMENT = "CMM";
/** 일반공차 표 범위 밖이라 실측 판정 기준을 만들 수 없는 치수의 프로젝트 기본 판정 문구 */
function projectGaugeCriteria(text: string) {
  return `${text} — ${GENERAL_LABEL} 표 범위 밖이라 허용 범위를 계산할 수 없음: 도면 치수 기준으로 합격·불합격 기록 (프로젝트 기본값)`;
}

/** 형상 기본값. OCR이 읽은 형상·표기로 정해지는 형상이 우선이고, 아니면 프로젝트 기본 형상(isDefault). */
function defaultFeature(item: OcrItem, allowed: string[], kind: string | null): { feature: string; isDefault: boolean } {
  if (item.feature_type && item.feature_type !== "UNKNOWN" && allowed.includes(item.feature_type)) {
    return { feature: item.feature_type, isDefault: false };
  }
  if (allowed.length === 1) return { feature: allowed[0], isDefault: false };
  const fallback = PROJECT_FEATURE[kind ?? ""];
  return { feature: fallback && allowed.includes(fallback) ? fallback : allowed[0] ?? "", isDefault: true };
}

/**
 * 공차 종류 기본값: 도면에 적힌 공차가 우선. 없으면 프로젝트 기본 정책인 일반공차 ISO 2768-m.
 * 일반공차 표 범위 밖이면 "" (실측 판정 불가 → 합격·불합격 기록으로 기본 설정한다).
 */
function defaultToleranceSource(parsed: ParsedDimension): ToleranceSource | "" {
  if (parsed.drawing) return "drawing";
  if (parsed.general !== null) return "general";
  return "";
}

/** 측정기 기본값: 기존 추천 규칙의 첫 번째, 추천이 없으면 프로젝트 기본 측정기. */
function defaultInstrument(feature: string, gdtSymbols: string[]): string {
  return recommendedInstruments({ feature, gdtSymbols })[0] ?? PROJECT_INSTRUMENT;
}

/** 관리자가 바꾼 Draft 필드 → 기본값 목록에서 뺄 서버 필드 */
const DRAFT_FIELD: Partial<Record<keyof Draft, string>> = {
  mode: "measurement_mode",
  feature: "feature_type",
  toleranceSource: "tolerance_source",
  upper: "tolerance_source",
  lower: "tolerance_source",
  instrument: "instrument",
  criteria: "gauge_criteria",
};

function formatReviewedAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function DrawingReviewPanel({
  source,
  selectedItemId,
  onSaved,
  onSelectItem,
  onPickPosition,
  onPreviewChange,
  imageUrl,
  defaultReviewer = "",
}: Props) {
  const points = source.result.items;
  const documentUnit = source.result.unit || "mm";

  const [dimensions, setDimensions] = useState<Record<string, string>>({});
  const [gdtValues, setGdtValues] = useState<Record<string, string>>({});
  const [gdtSymbols, setGdtSymbols] = useState<Record<string, string>>({});
  // 이번 검토에서 관리자가 손댄 항목 (기본값 그대로인 항목과 구분)
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // 관리자가 항목별로 확인한 상태 (화면 안에서만. 서버 확정은 「검토 완료 및 서버 저장」 때 전체를 한 번에)
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  // 측정 항목이 아닌 OCR 오인식(데이텀 기호·단면 표기 등). 지우지 않고 표시만 해 작업자 화면에서 뺀다.
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const initialExcluded = useRef<Record<string, boolean>>({});
  // 「확인 후 다음」을 눌렀는데 입력 오류가 있어 확인하지 못한 항목의 안내
  const [confirmBlocked, setConfirmBlocked] = useState<{ itemId: string; issues: string[] } | null>(null);
  const initialConfirmed = useRef<Record<string, boolean>>({});
  // 저장을 눌렀는데 문제가 있으면 문제 목록을 보여준다 (그 뒤로는 고칠 때마다 목록이 갱신된다)
  const [showProblems, setShowProblems] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [added, setAdded] = useState<AddedDimension[]>([]);
  // 저장하지 않은 검토 내용: 값·기준 수정, 항목 확인 변경, 추가 치수. 화면 이동·새로 고침 때 확인한다.
  useReportUnsaved(
    Object.keys(touched).length > 0 ||
      added.length > 0 ||
      Object.keys(excluded).some((id) => excluded[id] !== (initialExcluded.current[id] ?? false)) ||
      Object.keys(confirmed).some((id) => confirmed[id] !== (initialConfirmed.current[id] ?? false)),
  );
  const [reviewer, setReviewer] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

  const selectedId = selectedItemId ?? localSelectedId ?? points[0]?.id ?? null;

  // 항목 ↔ 검수 원본(치수 D번호, 기하공차 틀 번호) 연결
  const dimByItem = useMemo(() => {
    const map: Record<string, ReviewDimension | undefined> = {};
    for (const item of points) {
      if (item.category !== "DIMENSION") continue;
      map[item.id] = source.review.dimensions.find((entry) => entry.no === itemNumber(item));
    }
    return map;
  }, [points, source.review.dimensions]);

  const rowsByItem = useMemo(() => {
    const map: Record<string, ReviewGdtRow[]> = {};
    for (const item of points) {
      map[item.id] =
        item.category === "GDT"
          ? source.review.gdt.filter((entry) => entry.entry_no === itemNumber(item))
          : [];
    }
    return map;
  }, [points, source.review.gdt]);

  const reviewedInfo = useMemo(() => {
    if (source.result.review_status !== "reviewed") return null;
    const last = source.result.review_history?.[source.result.review_history.length - 1];
    return {
      reviewer: source.result.reviewer || last?.log.reviewer || "",
      at: formatReviewedAt(last?.log.reviewed_at),
    };
  }, [source.result]);

  const generalEvidence = source.general_tolerance;

  // 도면·OCR 버전이 바뀌면 편집 상태를 새로 만든다. 저장된 검토가 있으면 그 상태를 이어서 보여준다.
  // 저장된 관리자 설정(inspection_approved)은 기본값으로 덮어쓰지 않는다.
  useEffect(() => {
    const reviewed = source.result.review_status === "reviewed";
    setDimensions(Object.fromEntries(source.review.dimensions.map((item) => [item.item_id, item.text])));
    setGdtValues(Object.fromEntries(source.review.gdt.map((row) => [row.item_id, row.value])));
    setGdtSymbols(Object.fromEntries(source.review.gdt.map((row) => [row.item_id, row.symbol])));

    const nextDrafts: Record<string, Draft> = {};
    for (const item of source.result.items) {
      const approved = reviewed && item.inspection_approved === true;
      const parsed = parseDimension(item.raw_text);
      const isGauge = item.category === "GDT" || parsed.kind === "THREAD_SPEC";
      const savedSource = item.tolerance_source?.toLowerCase() as ToleranceSource | undefined;
      const rowSymbols = source.review.gdt
        .filter((entry) => item.category === "GDT" && entry.entry_no === itemNumber(item))
        .map((entry) => entry.symbol);
      const allowed = allowedFeatures({ dimensionKind: parsed.kind, gdtSymbols: rowSymbols });
      const savedInstrument = item.instrument ?? "";
      const unit = item.unit || source.result.unit || "mm";
      if (approved) {
        // 저장된 관리자 설정은 그대로 이어서 보여준다 (기본값으로 덮어쓰지 않음).
        nextDrafts[item.id] = {
          mode: item.measurement_mode ?? (isGauge ? "gauge" : "numeric"),
          feature: defaultFeature(item, allowed, parsed.kind).feature,
          toleranceSource: savedSource ?? "",
          upper: item.tolerance_source === "SPECIAL" && typeof item.upper_deviation === "number" ? String(item.upper_deviation) : "",
          lower: item.tolerance_source === "SPECIAL" && typeof item.lower_deviation === "number" ? String(item.lower_deviation) : "",
          unit,
          instrument: savedInstrument,
          instrumentAuto: false,
          defaults: item.defaults_applied ?? [],
          criteria: item.gauge_criteria ?? "",
          criteriaEdited: !!item.gauge_criteria,
        };
        continue;
      }
      // 새 항목: 바로 저장할 수 있게 기본값을 채우고, 어떤 필드가 시스템 기본값인지 기록한다.
      const defaults: string[] = [];
      const { feature, isDefault } = defaultFeature(item, allowed, parsed.kind);
      if (isDefault) defaults.push("feature_type");
      const toleranceSource = isGauge ? "" : defaultToleranceSource(parsed);
      if (toleranceSource === "general") defaults.push("tolerance_source");
      // 해석은 됐지만 일반공차 표 범위 밖인 치수: 실측 판정 기준이 없으므로 합격·불합격 기록으로 기본 설정
      const gaugeFallback = !isGauge && parsed.valid && toleranceSource === "";
      if (gaugeFallback) defaults.push("measurement_mode", "gauge_criteria");
      if (!savedInstrument) defaults.push("instrument");
      nextDrafts[item.id] = {
        mode: isGauge || gaugeFallback ? "gauge" : "numeric",
        feature,
        toleranceSource,
        upper: "",
        lower: "",
        unit,
        instrument: savedInstrument || defaultInstrument(feature, rowSymbols),
        instrumentAuto: !savedInstrument,
        defaults,
        criteria: gaugeFallback ? projectGaugeCriteria(item.raw_text) : item.gauge_criteria ?? "",
        criteriaEdited: gaugeFallback,
      };
    }
    setDrafts(nextDrafts);
    setTouched({});
    // 저장된 검토의 승인 항목은 확인된 상태로 이어서 보여준다. 새 항목은 미확인.
    const initialOut = Object.fromEntries(
      source.result.items.map((item) => [item.id, reviewed && item.excluded === true]),
    );
    initialExcluded.current = initialOut;
    setExcluded(initialOut);
    const initial = Object.fromEntries(
      source.result.items.map((item) => [item.id, reviewed && (item.inspection_approved === true || item.excluded === true)]),
    );
    initialConfirmed.current = initial;
    setConfirmed(initial);
    setConfirmBlocked(null);
    setShowProblems(false);
    setReviewer(source.result.reviewer || defaultReviewer);
    setAdded([]);
    setError("");
  }, [source]);

  useEffect(() => {
    const markers: ReviewPreviewMarker[] = [];
    added.forEach((item, index) => {
      if (!item.x.trim() || !item.y.trim()) return;
      const x = Number(item.x);
      const y = Number(item.y);
      if (
        !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 ||
        x >= source.result.image.width_px || y >= source.result.image.height_px
      ) {
        return;
      }
      markers.push({ id: item.id, number: points.length + index + 1, text: item.text, x, y });
    });
    onPreviewChange?.(markers);
  }, [added, source, points.length, onPreviewChange]);

  useEffect(() => () => onPreviewChange?.([]), [onPreviewChange]);

  // ---------------------------------------------------------------- 항목별 계산
  function dimensionText(item: OcrItem) {
    const dim = dimByItem[item.id];
    return dim ? dimensions[dim.item_id] ?? dim.text : item.raw_text;
  }

  function gdtValue(row: ReviewGdtRow) {
    return gdtValues[row.item_id] ?? row.value;
  }

  function gdtSymbol(row: ReviewGdtRow) {
    return gdtSymbols[row.item_id] ?? row.symbol;
  }

  /** 지금 확정된 기호·값으로 다시 쓴 기하공차 표기 (머리글·목록 표시용) */
  function gdtText(item: OcrItem) {
    const rows = rowsByItem[item.id];
    if (!rows.length) return item.raw_text;
    return rows.map((row) => [gdtSymbol(row), gdtValue(row), ...row.datums].join("|")).join("\n");
  }

  function featuresFor(item: OcrItem) {
    return allowedFeatures({
      dimensionKind: item.category === "GDT" ? null : parseDimension(dimensionText(item)).kind,
      gdtSymbols: rowsByItem[item.id].map((row) => gdtSymbol(row)),
    });
  }

  function effectiveCriteria(item: OcrItem, draft: Draft) {
    if (draft.criteriaEdited) return draft.criteria;
    const rows = rowsByItem[item.id];
    if (rows.length) {
      const parts = rows.map((row) => {
        const datums = row.datums.length ? ` (데이텀 ${row.datums.join("-")})` : "";
        return `${gdtSymbol(row)} ${gdtSymbolName(gdtSymbol(row))} ${gdtValue(row).trim() || "?"} 이하${datums}`;
      });
      return `${parts.join(" / ")} — 측정 편차가 공차값 이하이면 합격`;
    }
    if (parseDimension(dimensionText(item)).kind === "THREAD_SPEC") {
      return threadCriteria(dimensionText(item));
    }
    return draft.criteria;
  }

  function isEdited(item: OcrItem) {
    const dim = dimByItem[item.id];
    if (dim && (dimensions[dim.item_id] ?? dim.text) !== dim.text) return true;
    return rowsByItem[item.id].some((row) => gdtValue(row) !== row.value || gdtSymbol(row) !== row.symbol);
  }

  function hasInvalidValue(item: OcrItem) {
    if (excluded[item.id]) return false;
    if (item.category === "GDT") return rowsByItem[item.id].some((row) => !isValidGdtValue(gdtValue(row)));
    return !parseDimension(dimensionText(item)).valid;
  }

  /** 저장을 막는 문제 목록 (실제로 검증할 수 있는 것만). 비어 있으면 저장할 수 있다. */
  function issuesFor(item: OcrItem): string[] {
    const issues: string[] = [];
    if (excluded[item.id]) return [];
    const draft = drafts[item.id];
    if (!draft) return ["검토 정보를 준비하는 중입니다."];

    const parsed = parseDimension(dimensionText(item));
    if (item.category === "GDT") {
      for (const row of rowsByItem[item.id]) {
        if (!isValidGdtValue(gdtValue(row))) {
          issues.push(`${row.item_id}: 공차값이 숫자가 아닙니다. 도면을 보고 직접 입력해주세요.`);
        }
      }
    } else if (!parsed.valid) {
      issues.push(`치수 표기 형식이 아닙니다. 예: ${DIMENSION_EXAMPLES}`);
    }

    if (!draft.feature) issues.push("측정 형상을 선택해주세요.");
    else if (!featuresFor(item).includes(draft.feature)) {
      issues.push(`${FEATURE_LABEL[draft.feature] ?? draft.feature}은(는) 이 ${item.category === "GDT" ? "기호" : "표기"}에 맞지 않는 형상입니다. 다시 골라주세요.`);
    }
    if (!draft.instrument.trim()) issues.push("측정기를 선택해주세요.");

    if (draft.mode === "numeric") {
      if (item.category === "GDT") {
        issues.push("기하공차는 합격·불합격 기록 방식만 지원합니다.");
      } else if (parsed.valid) {
        if (parsed.kind === "THREAD_SPEC") {
          issues.push("나사는 합격·불합격 기록 방식(게이지)으로 지정해주세요.");
        } else if (draft.toleranceSource === "") {
          issues.push(`허용 공차를 정해주세요. 도면에 개별 공차가 없고 ${GENERAL_LABEL} 표 범위 밖입니다 (특별 공차 또는 합격·불합격 기록).`);
        } else if (draft.toleranceSource === "drawing" && !parsed.drawing) {
          issues.push("도면 표기에 공차가 없습니다. 일반공차나 특별 공차를 선택해주세요.");
        } else if (draft.toleranceSource === "general" && parsed.general === null) {
          issues.push(`${GENERAL_LABEL} 적용 범위 밖입니다. 특별 공차를 입력해주세요.`);
        } else if (draft.toleranceSource === "special") {
          const upper = parseDecimal(draft.upper);
          const lower = parseDecimal(draft.lower);
          if (!draft.upper.trim() || !draft.lower.trim()) {
            issues.push("특별 공차의 상한·하한 편차를 입력해주세요.");
          } else if (upper === null || lower === null) {
            const bad = [upper === null ? `상한 ${draft.upper.trim()}` : "", lower === null ? `하한 ${draft.lower.trim()}` : ""];
            issues.push(`특별 공차 편차가 숫자 형식이 아닙니다 (${bad.filter(Boolean).join(", ")}). 예: +0.05, -.02`);
          } else if (lower > upper) {
            issues.push("하한 편차가 상한 편차보다 큽니다 (허용 범위 역전).");
          }
        }
      }
    } else if (!effectiveCriteria(item, draft).trim()) {
      issues.push("합격·불합격 판정 기준을 입력해주세요.");
    }
    return issues;
  }

  function statusOf(item: OcrItem): ItemStatus {
    if (excluded[item.id]) return "excluded";
    if (issuesFor(item).length) return "needs";
    if (touched[item.id]) return "edited";
    const approved = source.result.review_status === "reviewed" && item.inspection_approved === true;
    return approved ? "saved" : "default";
  }

  const invalidItems = points.filter((item) => hasInvalidValue(item));
  const needsItems = points.filter((item) => issuesFor(item).length > 0);
  const confirmedCount = points.filter((item) => confirmed[item.id]).length;
  const unconfirmedItems = points.filter((item) => !confirmed[item.id]);
  const allConfirmed = points.length > 0 && unconfirmedItems.length === 0;

  /** 저장 전 자동 검증 결과: 항목·추가 치수·검토자. 항목 문제는 눌러서 그 항목으로 이동한다. */
  function collectProblems() {
    const problems: { key: string; label: string; message: string; itemId?: string }[] = [];
    points.forEach((item, index) => {
      const issues = issuesFor(item);
      if (issues.length) {
        const text = item.category === "GDT" ? gdtText(item).replace(/\n/g, "  ") : dimensionText(item);
        problems.push({ key: item.id, itemId: item.id, label: `${index + 1}. ${text || item.id}`, message: issues.join(" · ") });
      } else if (!confirmed[item.id]) {
        const text = item.category === "GDT" ? gdtText(item).replace(/\n/g, "  ") : dimensionText(item);
        problems.push({ key: item.id, itemId: item.id, label: `${index + 1}. ${text || item.id}`, message: "아직 확인하지 않았습니다 (「확인 후 다음」)." });
      }
    });
    added.forEach((item, index) => {
      const issue = addedIssue(item);
      if (issue) {
        problems.push({ key: item.id, label: `추가 치수 ${index + 1}${item.text.trim() ? ` (${item.text.trim()})` : ""}`, message: issue });
      }
    });
    if (!reviewer.trim()) problems.push({ key: "reviewer", label: "검토자", message: "검토자 이름을 입력해주세요." });
    return problems;
  }

  const problems = showProblems ? collectProblems() : [];

  // ---------------------------------------------------------------- 상태 변경
  function selectItem(itemId: string) {
    setLocalSelectedId(itemId);
    onSelectItem?.(itemId);
  }

  function navigate(delta: number) {
    if (!points.length) return;
    const index = Math.max(0, points.findIndex((item) => item.id === selectedId));
    selectItem(points[(index + delta + points.length) % points.length].id);
  }

  /** 관리자가 이 항목의 값·기준을 고쳤다고 표시한다. 확인한 항목이었다면 미확인으로 되돌린다. */
  function markTouched(itemId: string) {
    setTouched((previous) => (previous[itemId] ? previous : { ...previous, [itemId]: true }));
    setConfirmed((previous) => (previous[itemId] ? { ...previous, [itemId]: false } : previous));
    setConfirmBlocked((previous) => (previous?.itemId === itemId ? null : previous));
    setError("");
  }

  /**
   * 「확인 후 다음」: 오류가 없으면 이 항목을 확인하고 다음 미확인 항목으로 이동한다.
   * 오류가 있으면 확인하지 않고 오류를 안내한다. 서버에는 아무것도 저장하지 않는다.
   * (이전/다음 버튼으로 단순 이동하는 것은 확인이 아니다.)
   */
  function confirmAndNext(item: OcrItem) {
    const issues = issuesFor(item);
    if (issues.length) {
      setConfirmBlocked({ itemId: item.id, issues });
      return;
    }
    setConfirmBlocked(null);
    const next = { ...confirmed, [item.id]: true };
    setConfirmed(next);
    const index = points.findIndex((entry) => entry.id === item.id);
    for (let step = 1; step < points.length; step += 1) {
      const candidate = points[(index + step) % points.length];
      if (!next[candidate.id]) {
        selectItem(candidate.id);
        return;
      }
    }
  }

  /** 「오인식 제외」: 측정 항목이 아닌 인식 결과를 제외(확인 처리)하고 다음으로 넘어간다. 다시 누르면 되살린다. */
  function toggleExcluded(item: OcrItem) {
    const out = !excluded[item.id];
    setExcluded((previous) => ({ ...previous, [item.id]: out }));
    setConfirmBlocked(null);
    setError("");
    const next = { ...confirmed, [item.id]: out };
    setConfirmed(next);
    if (!out) return;
    const index = points.findIndex((entry) => entry.id === item.id);
    for (let step = 1; step < points.length; step += 1) {
      const candidate = points[(index + step) % points.length];
      if (!next[candidate.id]) {
        selectItem(candidate.id);
        return;
      }
    }
  }

  function itemSymbols(itemId: string) {
    return rowsByItem[itemId].map((row) => gdtSymbol(row));
  }

  /** 형상을 바꿀 때, 측정기가 추천 기본값이면 새 형상의 추천으로 함께 바꾼다. */
  function withFeature(draft: Draft, feature: string, symbols: string[]): Draft {
    return {
      ...draft,
      feature,
      instrument: draft.instrumentAuto ? defaultInstrument(feature, symbols) : draft.instrument,
    };
  }

  function updateDraft(itemId: string, patch: Partial<Draft>) {
    setDrafts((previous) => {
      let next = { ...previous[itemId], ...patch };
      // 관리자가 바꾼 필드는 더 이상 시스템 기본값이 아니다.
      const changed = new Set(
        (Object.keys(patch) as (keyof Draft)[]).map((key) => DRAFT_FIELD[key]).filter(Boolean) as string[],
      );
      next.defaults = next.defaults.filter((field) => !changed.has(field));
      if (patch.instrument !== undefined) next.instrumentAuto = false;
      if (patch.feature !== undefined && previous[itemId]?.feature !== patch.feature) {
        next = withFeature(next, patch.feature, itemSymbols(itemId));
      }
      return { ...previous, [itemId]: next };
    });
    markTouched(itemId);
  }

  function updateDimension(item: OcrItem, dim: ReviewDimension, text: string) {
    setDimensions((previous) => ({ ...previous, [dim.item_id]: text }));
    // 고친 표기가 유효한데 기존 공차 종류를 쓸 수 없게 되면 기본값으로 되돌린다.
    // (입력 중 잠깐 형식이 깨진 동안에는 바꾸지 않는다)
    const parsed = parseDimension(text);
    const draft = drafts[item.id];
    if (parsed.valid) {
      syncFeature(item.id, allowedFeatures({ dimensionKind: parsed.kind }));
      if (parsed.kind === "THREAD_SPEC" && draft?.mode === "numeric") {
        setDrafts((previous) => ({ ...previous, [item.id]: { ...previous[item.id], mode: "gauge" } }));
      }
    }
    if (parsed.valid && draft && draft.toleranceSource !== "special") {
      const available = draft.toleranceSource === "drawing" ? !!parsed.drawing : parsed.general !== null;
      if (!available) {
        setDrafts((previous) => ({
          ...previous,
          [item.id]: { ...previous[item.id], toleranceSource: defaultToleranceSource(parsed) },
        }));
      }
    }
    markTouched(item.id);
  }

  function updateGdtValue(itemId: string, rowId: string, value: string) {
    setGdtValues((previous) => ({ ...previous, [rowId]: value }));
    markTouched(itemId);
  }

  /** 기호·표기가 바뀌어 지금 형상을 고를 수 없게 되면 형상을 다시 맞춘다. */
  function syncFeature(itemId: string, allowed: string[], symbols: string[] = itemSymbols(itemId)) {
    setDrafts((previous) => {
      const draft = previous[itemId];
      if (!draft || allowed.includes(draft.feature)) return previous;
      return { ...previous, [itemId]: withFeature(draft, allowed.length === 1 ? allowed[0] : "", symbols) };
    });
  }

  function updateGdtSymbol(item: OcrItem, rowId: string, symbol: string) {
    setGdtSymbols((previous) => ({ ...previous, [rowId]: symbol }));
    const symbols = rowsByItem[item.id].map((row) => (row.item_id === rowId ? symbol : gdtSymbol(row)));
    syncFeature(item.id, allowedFeatures({ gdtSymbols: symbols }), symbols);
    markTouched(item.id);
  }

  function updateAdded(id: string, patch: Partial<AddedDimension>) {
    setAdded((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setError("");
  }

  function addedIssue(item: AddedDimension) {
    if (!item.text.trim()) return "치수 표기를 입력해주세요.";
    if (!parseDimension(item.text).valid) return `치수 표기 형식이 아닙니다. 예: ${DIMENSION_EXAMPLES}`;
    const x = Number(item.x);
    const y = Number(item.y);
    if (
      !item.x.trim() || !item.y.trim() || !Number.isFinite(x) || !Number.isFinite(y) ||
      x < 0 || y < 0 || x >= source.result.image.width_px || y >= source.result.image.height_px
    ) {
      return "도면에서 위치를 선택해주세요.";
    }
    return "";
  }

  async function pickPosition(id: string) {
    if (!onPickPosition) return;
    setPicking(true);
    setError("");
    try {
      const position = await onPickPosition();
      if (position) {
        updateAdded(id, { x: String(Math.round(position.x)), y: String(Math.round(position.y)) });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "위치 선택 실패");
    } finally {
      setPicking(false);
    }
  }

  /**
   * 「검토 완료 및 서버 저장」: 전체 항목을 한 번에 검토 확정한다.
   * 저장 전에 실제로 검증할 수 있는 문제(형식 오류·필수값 누락·허용 범위 역전 등)를 모두 확인하고,
   * 문제가 있으면 저장하지 않고 목록을 보여준다. 문제가 없으면 추가 확인 없이 바로 저장한다.
   * 서버도 같은 내용을 다시 검증하며, 저장이 성공해야 검토 완료가 된다.
   */
  async function save() {
    setError("");
    if (saving) return;
    if (picking) {
      setError("도면 위치 선택을 완료하거나 취소해주세요.");
      return;
    }
    // 모든 항목을 확인해야 저장한다 (확인 자체는 서버에 저장되지 않는다).
    const found = collectProblems();
    if (found.length) {
      setShowProblems(true);
      const first = found.find((problem) => problem.itemId);
      if (first?.itemId) selectItem(first.itemId);
      return;
    }
    setShowProblems(false);

    const inspectionSettings: Record<string, InspectionSetting> = {};
    for (const item of points) {
      if (excluded[item.id]) continue;
      const draft = drafts[item.id];
      const setting: InspectionSetting = {
        measurement_mode: draft.mode,
        feature_type: draft.feature,
        unit: draft.unit.trim() || documentUnit,
        instrument: draft.instrument.trim(),
        gauge_criteria: draft.mode === "gauge" ? effectiveCriteria(item, draft).trim() : "",
        position_confirmed: true,
      };
      setting.defaults_applied = draft.defaults;
      if (draft.mode === "numeric" && draft.toleranceSource) {
        setting.tolerance_source = draft.toleranceSource;
        // 도면에서 확인한 공차와 시스템 기본 정책으로 적용한 공차를 구분해 저장한다.
        setting.tolerance_basis =
          draft.toleranceSource === "drawing"
            ? "drawing"
            : draft.toleranceSource === "general" && draft.defaults.includes("tolerance_source")
              ? generalEvidence?.applies ? "drawing_note" : "project_default"
              : "admin";
        if (draft.toleranceSource === "special") {
          // 검증을 통과한 값만 온다 ('.3' → 0.3).
          setting.upper_deviation = parseDecimal(draft.upper)!;
          setting.lower_deviation = parseDecimal(draft.lower)!;
        }
      }
      inspectionSettings[item.id] = setting;
    }

    setSaving(true);
    try {
      const result = await saveDrawingReview(source.drawing_id, {
        revision: source.revision,
        reviewer: reviewer.trim(),
        // 모두 확인한 뒤에만 여기까지 온다. 서버는 이 저장 요청으로 검토를 확정한다.
        confirmed_item_ids: points.filter((item) => confirmed[item.id]).map((item) => item.id),
        excluded_item_ids: points.filter((item) => excluded[item.id]).map((item) => item.id),
        inspection_settings: inspectionSettings,
        edits: {
          // 데이텀은 OCR 그대로 둔다. 기호·값은 관리자가 확정한 것.
          gdt: source.review.gdt.map((row) => ({
            item_id: row.item_id,
            symbol: gdtSymbol(row),
            value: gdtValue(row).trim(),
          })),
          dimensions: source.review.dimensions
            .filter((item) => (dimensions[item.item_id] ?? item.text) !== item.text)
            .map((item) => ({ item_id: item.item_id, text: (dimensions[item.item_id] ?? item.text).trim() })),
          added_dimensions: added.map((item) => ({
            text: item.text.trim(),
            x: Number(item.x),
            y: Number(item.y),
            coord: "image" as const,
          })),
        },
      });
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "검수 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------- 화면
  const selectedIndex = points.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex >= 0 ? points[selectedIndex] : null;
  const selectedIssues = selected ? issuesFor(selected) : [];
  const blocked = selected && confirmBlocked?.itemId === selected.id ? selectedIssues : [];

  return (
    <section className="flex min-h-full flex-col bg-slate-50 text-slate-900">
      <div className="sticky top-0 z-10 shadow-sm">
        {selected && (
          <ItemHeader
            number={selectedIndex + 1}
            total={points.length}
            title={characteristicName(selected)}
            rawText={selected.category === "GDT" ? gdtText(selected) : dimensionText(selected)}
            itemId={selected.id}
            onNavigate={navigate}
            chips={
              <>
                {confirmed[selected.id] ? <Chip tone="ok">✓ 확인 완료</Chip> : <Chip tone="warn">미확인</Chip>}
                {hasInvalidValue(selected) ? (
                  <Chip tone="error">형식 오류</Chip>
                ) : (
                  <Chip tone={STATUS_TONE[statusOf(selected)]}>{STATUS_LABEL[statusOf(selected)]}</Chip>
                )}
                {isEdited(selected) && <Chip tone="neutral">OCR 값 수정됨</Chip>}
              </>
            }
          />
        )}
        {/* 확인 동작: 스크롤 없이 「확인 후 다음」을 반복할 수 있게 상단에 고정 */}
        {selected && (
          <div className="border-b border-slate-200 bg-white px-3 pb-2">
            {allConfirmed ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs font-semibold text-emerald-700">✓ 전체 {points.length}개 항목 확인 완료</span>
                <button type="button" disabled={saving || picking} onClick={() => void save()} className="btn btn-primary btn-lg">
                  {saving ? "저장 중…" : "검토 완료 및 서버 저장"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] text-slate-500">
                  {confirmed[selected.id] ? "이 항목은 확인했습니다. 값을 바꾸면 다시 확인해야 합니다." : "값이 맞으면 확인하고 다음 미확인 항목으로 넘어갑니다."}
                </span>
                <button
                  type="button"
                  disabled={saving || picking}
                  onClick={() => confirmAndNext(selected)}
                  className="btn btn-primary btn-lg"
                >
                  {confirmed[selected.id] ? "다음 미확인으로" : "확인 후 다음"}
                </button>
              </div>
            )}
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <span className="text-[11px] text-slate-500">
                {excluded[selected.id] ? "측정 항목에서 제외했습니다. 작업자 화면에 나오지 않습니다." : "치수가 아닌 기호·글자를 잘못 읽었다면"}
              </span>
              <button type="button" disabled={saving || picking} onClick={() => toggleExcluded(selected)} className="btn btn-secondary">
                {excluded[selected.id] ? "제외 취소" : "오인식 제외"}
              </button>
            </div>
            {blocked.length > 0 && (
              <ul role="alert" className="note note-error mt-2 space-y-0.5 text-[11px]">
                <li className="font-semibold">입력 오류가 있어 확인하지 않았습니다. 고친 뒤 다시 눌러주세요.</li>
                {blocked.map((issue) => <li key={issue}>• {issue}</li>)}
              </ul>
            )}
          </div>
        )}
        <ProgressBar
          label="확인"
          done={confirmedCount}
          total={points.length}
          chips={
            <>
              {invalidItems.length > 0 && (
                <Chip tone="error" onClick={() => selectItem(invalidItems[0].id)}>
                  형식 오류 {invalidItems.length} → 이동
                </Chip>
              )}
              {needsItems.length > 0 && (
                <Chip tone="warn" onClick={() => selectItem(needsItems[0].id)}>
                  설정 필요 {needsItems.length} → 이동
                </Chip>
              )}
              {unconfirmedItems.length > 0 && (
                <Chip tone="neutral" onClick={() => selectItem(unconfirmedItems[0].id)}>
                  미확인 {unconfirmedItems.length} → 이동
                </Chip>
              )}
            </>
          }
        />
        {reviewedInfo && (
          <p className="border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800">
            저장된 검토 · {reviewedInfo.reviewer || "검토자 미기록"}
            {reviewedInfo.at ? ` · ${reviewedInfo.at}` : ""} — 값이나 기준을 바꾼 항목은 다시 확인해야 합니다.
          </p>
        )}
      </div>

      <fieldset disabled={saving || picking} className="flex-1 space-y-3 p-3">
        {source.review.warnings.map((warning, index) => (
          <p key={index} className="note note-warn">
            {warning}
          </p>
        ))}

        <p className="note note-info">
          {generalEvidence?.applies ? (
            <>
              개별 공차가 없는 치수: 도면 주석 <span className="font-mono">{generalEvidence.text}</span>에 따라 {GENERAL_LABEL}를 기본 적용했습니다.
            </>
          ) : (
            <>
              개별 공차가 없는 치수: <b>프로젝트 기본 정책</b>으로 {GENERAL_LABEL}를 적용했습니다 (도면 표기 아님).
              {generalEvidence?.found && (
                <> 도면 표기 <span className="font-mono">{generalEvidence.text}</span> — {generalEvidence.reason}</>
              )}
            </>
          )}{" "}
          측정 방식·형상·측정기도 추천 규칙으로 채웠으며, 모두 바꿀 수 있습니다. 항목마다 「확인 후 다음」으로 확인한 뒤 「검토 완료 및 서버 저장」을 눌러야 확정됩니다.
        </p>

        {selected && (
          <SelectedItem
            key={selected.id}
            item={selected}
            dim={dimByItem[selected.id]}
            rows={rowsByItem[selected.id]}
            draft={drafts[selected.id]}
            dimText={dimensionText(selected)}
            gdtValue={gdtValue}
            gdtSymbol={gdtSymbol}
            features={featuresFor(selected)}
            criteria={drafts[selected.id] ? effectiveCriteria(selected, drafts[selected.id]) : ""}
            issues={issuesFor(selected)}
            status={statusOf(selected)}
            confirmed={!!confirmed[selected.id]}
            generalBasis={generalEvidence?.applies ? "도면 주석 근거" : "프로젝트 기본 정책 · 도면 표기 아님"}
            imageUrl={imageUrl ?? null}
            imageWidth={source.result.image.width_px}
            imageHeight={source.result.image.height_px}
            onDimension={(text) => {
              const dim = dimByItem[selected.id];
              if (dim) updateDimension(selected, dim, text);
            }}
            onGdtValue={(rowId, value) => updateGdtValue(selected.id, rowId, value)}
            onGdtSymbol={(rowId, symbol) => updateGdtSymbol(selected, rowId, symbol)}
            onDraft={(patch) => updateDraft(selected.id, patch)}
          />
        )}

        <details className="card">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
            전체 항목 목록 ({points.length}) · 확인 {confirmedCount} · 설정 필요 {needsItems.length}
          </summary>
          <div className="space-y-2 border-t border-slate-100 p-3">
            <div role="group" aria-label="검토 항목 필터" className="flex flex-wrap gap-1.5">
              {([
                ["all", "전체"],
                ["DIMENSION", "치수"],
                ["GDT", "기하공차"],
                ["needs", "설정 필요"],
                ["unconfirmed", "미확인"],
                ["invalid", "형식 오류"],
                ["edited", "수정됨"],
              ] as Array<[Filter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={`h-6 rounded-sm border px-2 text-[11px] font-medium ${
                    filter === value
                      ? "border-slate-800 bg-slate-800 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ul aria-label="검토 항목 목록" className="max-h-64 overflow-y-auto rounded border border-slate-200">
              {points.map((item, index) => {
                const invalid = hasInvalidValue(item);
                const edited = isEdited(item);
                const status = statusOf(item);
                if (filter === "DIMENSION" || filter === "GDT") {
                  if (item.category !== filter) return null;
                }
                if (filter === "needs" && status !== "needs") return null;
                if (filter === "unconfirmed" && confirmed[item.id]) return null;
                if (filter === "invalid" && !invalid) return null;
                if (filter === "edited" && !edited) return null;
                return (
                  <li key={item.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => selectItem(item.id)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                        item.id === selectedId ? "bg-cyan-50 shadow-[inset_3px_0_0_var(--color-cyan-700)]" : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-4 text-center font-bold ${
                          invalid ? "text-rose-600" : confirmed[item.id] ? "text-emerald-600" : "text-amber-500"
                        }`}
                      >
                        {invalid ? "!" : excluded[item.id] ? "×" : confirmed[item.id] ? "✓" : "•"}
                      </span>
                      <span className="w-6 text-slate-500">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-mono font-semibold">
                        {item.category === "GDT" ? gdtText(item).replace(/\n/g, "  ") : dimensionText(item)}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {item.category === "GDT" ? "기하공차" : "치수"} · {STATUS_LABEL[status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>

        <details className="card">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
            + 놓친 치수 추가{" "}
            <span className="font-normal text-slate-500">OCR이 아예 못 읽은 치수 {added.length ? `· ${added.length}개 추가 중` : ""}</span>
          </summary>
          <div className="space-y-3 border-t border-slate-100 p-3">
            <p className="text-[11px] text-slate-600">
              표기를 입력하고 도면에서 위치를 골라주세요. 저장할 때 함께 검증합니다. 추가한 치수의 검사 기준은 저장 후 다시 열어 지정합니다.
            </p>
            {added.map((item) => {
              const issue = addedIssue(item);
              return (
                <div key={item.id} className="space-y-2 rounded border border-slate-200 p-2.5">
                  <input
                    aria-label="추가 치수 표기"
                    className={editClass}
                    placeholder={`예: ${DIMENSION_EXAMPLES}`}
                    value={item.text}
                    onChange={(event) => updateAdded(item.id, { text: event.target.value })}
                  />
                  <p className="text-[11px] text-slate-600">
                    {item.x.trim() && item.y.trim() ? `선택 위치: X ${item.x} · Y ${item.y}` : "아직 위치를 선택하지 않았습니다."}
                  </p>
                  {issue && item.text.trim() && <p className="text-[11px] text-rose-700">{issue}</p>}
                  <div className="flex flex-wrap gap-2">
                    {onPickPosition && (
                      <button
                        type="button"
                        onClick={() => void pickPosition(item.id)}
                        className="btn btn-secondary"
                      >
                        도면에서 위치 선택
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setAdded((previous) => previous.filter((entry) => entry.id !== item.id))}
                      className="btn btn-ghost hover:bg-rose-50 hover:text-rose-700"
                    >
                      추가 취소
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setAdded((previous) => [...previous, { id: crypto.randomUUID(), text: "", x: "", y: "" }])
              }
            >
              + 치수 추가
            </button>
          </div>
        </details>
      </fieldset>

      <footer className="sticky bottom-0 z-10 space-y-2 border-t border-slate-300 bg-white px-3 py-2.5">
        {problems.length > 0 && (
          <div role="alert" className="note note-error space-y-1">
            <p className="font-semibold">저장하지 않았습니다 — 아래 {problems.length}건을 고쳐주세요. 항목을 누르면 이동합니다.</p>
            <ul aria-label="저장 전 검증 문제" className="max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
              {problems.map((problem) => (
                <li key={problem.key}>
                  {problem.itemId ? (
                    <button type="button" onClick={() => selectItem(problem.itemId!)} className="text-left underline-offset-2 hover:underline">
                      <b className="font-mono">{problem.label}</b> — {problem.message}
                    </button>
                  ) : (
                    <span><b>{problem.label}</b> — {problem.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="note note-error whitespace-pre-wrap font-medium">
            {error}
          </p>
        )}
        {picking && (
          <p role="status" className="text-xs text-cyan-800">
            도면에서 위치를 선택해주세요.
          </p>
        )}
        <div className="flex gap-2">
          <input
            aria-label="검토자"
            className={`${inputClass} h-9 min-w-0 flex-1`}
            value={reviewer}
            disabled={saving}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="검토자 이름"
          />
          <button
            type="button"
            disabled={saving || picking}
            onClick={() => void save()}
            className="btn btn-primary btn-lg"
          >
            {saving ? "저장 중…" : "검토 완료 및 서버 저장"}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          {allConfirmed
            ? `전체 ${points.length}개 항목을 확인했습니다. 저장해야 검토 완료가 되고 작업자에게 공개됩니다.`
            : `모든 항목을 확인해야 저장할 수 있습니다 · 미확인 ${unconfirmedItems.length}개 (확인은 서버에 저장되지 않습니다)`}
        </p>
      </footer>
    </section>
  );
}

// ==================================================================== 선택한 항목
interface SelectedProps {
  item: OcrItem;
  dim?: ReviewDimension;
  rows: ReviewGdtRow[];
  draft?: Draft;
  dimText: string;
  gdtValue: (row: ReviewGdtRow) => string;
  gdtSymbol: (row: ReviewGdtRow) => string;
  /** 이 항목에 고를 수 있는 측정 형상 */
  features: string[];
  criteria: string;
  issues: string[];
  status: ItemStatus;
  confirmed: boolean;
  /** 기본 적용한 일반공차의 근거 표시 */
  generalBasis: string;
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  onDimension: (text: string) => void;
  onGdtValue: (rowId: string, value: string) => void;
  onGdtSymbol: (rowId: string, symbol: string) => void;
  onDraft: (patch: Partial<Draft>) => void;
}

function SelectedItem({
  item, dim, rows, draft, dimText, gdtValue, gdtSymbol, features, criteria, issues, status, confirmed, generalBasis,
  imageUrl, imageWidth, imageHeight, onDimension, onGdtValue, onGdtSymbol, onDraft,
}: SelectedProps) {
  const parsed = parseDimension(dimText);
  const isGdt = item.category === "GDT";
  const unit = draft?.unit || "mm";

  return (
    <div className="space-y-3">
      {/* ① OCR 값 확인 */}
      {isGdt ? (
        <div className={`${cardClass} ${rows.some((row) => !isValidGdtValue(gdtValue(row))) ? "border-rose-300 bg-rose-50/40" : ""}`}>
          <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            기하공차 확인 <span className="tag bg-slate-100 font-normal text-slate-600">기호·공차값 수정</span>
          </h3>
          <OcrCrop
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            box={gdtCropBox(item.position, rows.length)}
            label="도면 원본 (이 부분과 기호·값을 대조하세요)"
          />
          {rows.map((row) => {
            const value = gdtValue(row);
            const symbol = gdtSymbol(row);
            const valid = isValidGdtValue(value);
            const candidate = valid ? droppedZeroCandidate(value) : null;
            const formWithDatum = FORM_SYMBOLS.has(symbol) && row.datums.length > 0;
            const symbolOptions = GDT_SYMBOLS.some((entry) => entry.symbol === symbol)
              ? GDT_SYMBOLS
              : [{ symbol, name: gdtSymbolName(symbol) }, ...GDT_SYMBOLS];
            return (
              <div key={row.item_id} className="space-y-1.5 rounded border border-slate-200 bg-white p-2.5">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{row.item_id}</span>
                  {row.datums.length > 0 && (
                    <span className="text-xs text-slate-500" title="데이텀은 OCR 그대로 사용">
                      데이텀 <b className="font-mono text-slate-800">{row.datums.join(" · ")}</b>
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-[1.25fr_1fr] gap-2">
                  <label className="text-xs">
                    <span className="text-slate-600">기호</span>
                    <select
                      aria-label={`${row.item_id} 기호`}
                      className={editClass}
                      value={symbol}
                      onChange={(event) => onGdtSymbol(row.item_id, event.target.value)}
                    >
                      {symbolOptions.map((entry) => (
                        <option key={entry.symbol} value={entry.symbol}>
                          {entry.symbol}  {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="text-slate-600">공차값</span>
                    <input
                      aria-label={`${row.item_id} 공차값`}
                      inputMode="decimal"
                      className={`${editClass} font-mono ${valid ? "" : "border-rose-400 bg-rose-50"}`}
                      value={value}
                      onChange={(event) => onGdtValue(row.item_id, event.target.value)}
                      onBlur={(event) => {
                        const normalized = normalizeGdtValueText(event.target.value);
                        if (normalized !== event.target.value) onGdtValue(row.item_id, normalized);
                      }}
                    />
                  </label>
                </div>
                {formWithDatum && (
                  <p className="text-[11px] text-slate-500">
                    참고: {gdtSymbolName(symbol)}는 모양 공차라 보통 데이텀이 없습니다. 도면에 그대로 적힌 건지, 기호를 잘못 읽은 건지 확인하세요.
                  </p>
                )}
                {!valid && (
                  <p className="text-[11px] font-semibold text-rose-700">
                    공차값이 숫자가 아닙니다 (OCR: <span className="font-mono">{row.value || "빈 값"}</span>). 도면을 보고 직접 입력해주세요. 자동으로 고치지 않습니다.
                  </p>
                )}
                {(symbol !== row.symbol || (valid && value !== row.value)) && (
                  <p className="text-[11px] text-slate-500">
                    OCR: <span className="font-mono">{row.symbol} {row.value}</span>{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        onGdtSymbol(row.item_id, row.symbol);
                        onGdtValue(row.item_id, row.value);
                      }}
                    >
                      되돌리기
                    </button>
                  </p>
                )}
                {candidate && value === row.value && (
                  <p className="text-[11px] text-slate-500">
                    0 빠짐 후보{" "}
                    <button
                      type="button"
                      title="eDOCr2가 가장 자주 틀린 모양: 소수점 뒤 0을 빠뜨림. 도면과 같을 때만 누르세요."
                      onClick={() => onGdtValue(row.item_id, candidate)}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono font-bold text-slate-700 hover:border-amber-400 hover:bg-amber-50"
                    >
                      {candidate}
                    </button>
                    <span className="ml-1 text-[10px]">도면과 같을 때만</span>
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-slate-400">데이텀은 OCR 그대로 사용합니다.</p>
        </div>
      ) : (
        <div className={`${cardClass} ${parsed.valid ? "" : "border-rose-300 bg-rose-50/40"}`}>
          <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            치수 확인 <span className="tag bg-slate-100 font-normal text-slate-600">잘못 읽었으면 수정</span>
          </h3>
          <OcrCrop
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            box={dimensionCropBox(item.position)}
            label="도면 원본 (이 부분과 표기를 대조하세요)"
          />
          {dim ? (
            <>
              <label className="block space-y-1 text-xs">
                <span className="text-slate-600">확정 표기 · 예: {DIMENSION_EXAMPLES}</span>
                <input
                  aria-label="치수 표기"
                  className={`${editClass} font-mono ${parsed.valid ? "" : "border-rose-400 bg-rose-50"}`}
                  value={dimText}
                  onChange={(event) => onDimension(event.target.value)}
                />
              </label>
              {!parsed.valid && (
                <p className="text-[11px] font-semibold text-rose-700">치수 표기 형식이 아닙니다. 도면을 보고 직접 입력해주세요.</p>
              )}
              {dimText !== dim.text && (
                <p className="text-[11px] text-slate-500">
                  OCR 원문: <span className="font-mono">{dim.text}</span>{" "}
                  <button type="button" className="underline" onClick={() => onDimension(dim.text)}>
                    되돌리기
                  </button>
                </p>
              )}
              {parsed.valid && parsed.nominal !== null && (
                <p className="text-[11px] text-slate-600">
                  기준치수 <b>{formatNumber(parsed.nominal)}</b>
                  {parsed.drawing
                    ? ` · 도면 공차 ${formatDeviationPair(parsed.drawing.upper, parsed.drawing.lower)}`
                    : " · 도면에 개별 공차 없음"}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-amber-800">OCR 원본에서 이 치수를 찾지 못했습니다.</p>
          )}
        </div>
      )}

      {/* ② 작업자 검사 기준 (작업자 화면에 그대로 보임) */}
      {draft && (
        <div className={cardClass}>
          <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            작업자 검사 기준
            <span className="tag bg-slate-100 font-normal text-slate-600">편집</span>
            <span className="flex-1" />
            <span className="text-[10px] font-normal text-slate-500">작업자 화면에 그대로 보입니다</span>
          </h3>

          <div className="seg flex w-full" role="group" aria-label="측정 방식">
            {([
              ["numeric", "실측값 입력 · 자동 판정"],
              ["gauge", "합격 / 불합격 기록"],
            ] as const).map(([mode, label]) => {
              const disabled = mode === "numeric" && (isGdt || parsed.kind === "THREAD_SPEC");
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={disabled}
                  aria-pressed={draft.mode === mode}
                  onClick={() => onDraft({ mode })}
                  className="seg-item h-auto min-h-6 whitespace-normal px-2 py-1 text-center leading-tight"
                >
                  {label}
                </button>
              );
            })}
          </div>
          {draft.defaults.includes("measurement_mode") && (
            <p className="text-[10px] text-amber-700">
              {GENERAL_LABEL} 표 범위 밖이라 실측 허용 범위를 계산할 수 없어 합격·불합격 기록으로 기본 설정했습니다. 특별 공차를 입력하면 실측값 방식으로 바꿀 수 있습니다.
            </p>
          )}
          {(isGdt || parsed.kind === "THREAD_SPEC") && (
            <p className="text-[10px] text-slate-500">
              {isGdt ? "기하공차" : "나사"}는 게이지·CMM 결과를 합격/불합격으로 기록합니다.
            </p>
          )}

          <label className="block space-y-1 text-xs">
            <span className="text-slate-600">
              측정 형상{" "}
              {draft.defaults.includes("feature_type") && <span className="tag bg-slate-100 text-slate-600">프로젝트 기본값</span>}{" "}
              <span className="text-[10px] text-slate-400">
                {features.length === 1
                  ? "· 표기·기호로 정해짐"
                  : `· ${isGdt ? "이 기호" : "이 표기"}에 맞는 형상만 표시`}
              </span>
            </span>
            <select
              className={editClass}
              value={draft.feature}
              disabled={features.length === 1}
              onChange={(event) => onDraft({ feature: event.target.value })}
            >
              {features.length > 1 && <option value="">선택해주세요</option>}
              {features.map((feature) => (
                <option key={feature} value={feature}>
                  {FEATURE_LABEL[feature]}
                </option>
              ))}
            </select>
          </label>

          {draft.mode === "numeric" && !isGdt ? (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs text-slate-600">허용 공차</legend>
              {([
                [
                  "drawing",
                  "도면 공차",
                  parsed.drawing ? formatDeviationPair(parsed.drawing.upper, parsed.drawing.lower) : "도면에 없음",
                  !!parsed.drawing,
                ],
                [
                  "general",
                  GENERAL_LABEL,
                  parsed.general !== null ? `±${formatNumber(parsed.general)}` : "적용 범위 밖",
                  parsed.general !== null,
                ],
                ["special", "특별 공차", "직접 입력", true],
              ] as Array<[ToleranceSource, string, string, boolean]>).map(([value, label, detail, available]) => (
                <label
                  key={value}
                  className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
                    draft.toleranceSource === value ? "border-cyan-600 bg-cyan-50" : "border-slate-200 hover:bg-slate-50"
                  } ${available ? "cursor-pointer" : "opacity-40"}`}
                >
                  <input
                    type="radio"
                    name={`tolerance-${item.id}`}
                    disabled={!available}
                    checked={draft.toleranceSource === value}
                    onChange={() => onDraft({ toleranceSource: value })}
                  />
                  <span className="font-semibold">{label}</span>
                  {value === "general" && draft.toleranceSource === "general" && draft.defaults.includes("tolerance_source") && (
                    <span className="tag bg-amber-50 text-amber-800">{generalBasis}</span>
                  )}
                  {value === "drawing" && <span className="text-[10px] text-slate-400">도면 표기에서 읽음</span>}
                  <span className="flex-1 text-right font-mono text-slate-600">{detail}</span>
                </label>
              ))}
              {draft.toleranceSource === "special" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="space-y-1 text-xs">
                    <span className="text-slate-600">상한 편차 (부호 포함)</span>
                    <input
                      className={`${editClass} font-mono`}
                      inputMode="decimal"
                      placeholder="예: +0.05"
                      value={draft.upper}
                      aria-invalid={!!draft.upper.trim() && parseDecimal(draft.upper) === null}
                      onChange={(event) => onDraft({ upper: event.target.value })}
                      onBlur={(event) => {
                        const normalized = normalizeDecimalText(event.target.value);
                        if (normalized !== event.target.value) onDraft({ upper: normalized });
                      }}
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-slate-600">하한 편차 (부호 포함)</span>
                    <input
                      className={`${editClass} font-mono`}
                      inputMode="decimal"
                      placeholder="예: -0.02"
                      value={draft.lower}
                      aria-invalid={!!draft.lower.trim() && parseDecimal(draft.lower) === null}
                      onChange={(event) => onDraft({ lower: event.target.value })}
                      onBlur={(event) => {
                        const normalized = normalizeDecimalText(event.target.value);
                        if (normalized !== event.target.value) onDraft({ lower: normalized });
                      }}
                    />
                  </label>
                </div>
              )}
              <RangePreview parsed={parsed} draft={draft} unit={unit} />
            </fieldset>
          ) : (
            <label className="block space-y-1 text-xs">
              <span className="text-slate-600">
                합격·불합격 판정 기준{" "}
                {!draft.criteriaEdited && (isGdt || parsed.kind === "THREAD_SPEC") && (
                  <span className="text-[10px] text-cyan-700">· 확정 값으로 자동 작성됨 (수정 가능)</span>
                )}
              </span>
              <textarea
                className={editClass}
                rows={3}
                placeholder="사용할 게이지 규격과 합격·불합격 조건을 입력하세요."
                value={criteria}
                onChange={(event) => onDraft({ criteria: event.target.value, criteriaEdited: true })}
              />
            </label>
          )}

          <label className="block space-y-1 text-xs">
            <span className="text-slate-600">
              측정기{" "}
              {draft.defaults.includes("instrument") && <span className="tag bg-slate-100 text-slate-600">추천 기본값</span>}
            </span>
            <InstrumentSelect
              className={editClass}
              value={draft.instrument}
              onChange={(instrument) => onDraft({ instrument })}
              recommended={recommendedInstruments({
                feature: draft.feature,
                gdtSymbols: rows.map((row) => gdtSymbol(row)),
                candidateFeatures: features,
              })}
            />
          </label>
        </div>
      )}

      {/* ③ 저장 전 검증 결과 (항목별 확인 버튼은 없다. 저장할 때 전체를 한 번에 확정한다) */}
      {issues.length > 0 ? (
        <ul className="note note-warn space-y-0.5 text-[11px]">
          {issues.map((issue) => (
            <li key={issue}>• {issue}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-500">
          {confirmed
            ? "확인한 항목입니다. 값·기준을 바꾸면 미확인으로 돌아갑니다."
            : status === "default"
              ? "인식값과 추천 규칙으로 채운 기본값입니다. 맞으면 위의 「확인 후 다음」을, 틀리면 고친 뒤 확인해주세요."
              : status === "saved"
                ? "이전에 저장한 관리자 설정입니다. 위의 「확인 후 다음」으로 확인해주세요."
                : "수정한 내용을 위의 「확인 후 다음」으로 확인해주세요."}
        </p>
      )}
    </div>
  );
}

function RangePreview({ parsed, draft, unit }: { parsed: ParsedDimension; draft: Draft; unit: string }) {
  if (!parsed.valid || parsed.nominal === null || parsed.kind === "THREAD_SPEC") return null;
  let deviation: { upper: number; lower: number } | null = null;
  if (draft.toleranceSource === "drawing" && parsed.drawing) deviation = parsed.drawing;
  if (draft.toleranceSource === "general" && parsed.general !== null) {
    deviation = { upper: parsed.general, lower: -parsed.general };
  }
  if (draft.toleranceSource === "special") {
    const upper = parseDecimal(draft.upper);
    const lower = parseDecimal(draft.lower);
    if (upper !== null && lower !== null && lower <= upper) {
      deviation = { upper, lower };
    }
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <span className="text-[11px] text-slate-500">허용 범위</span>
      <b className="font-mono text-sm font-semibold text-slate-900">
        {deviation ? formatRange(parsed.nominal, deviation.upper, deviation.lower, unit) : "—"}
      </b>
    </p>
  );
}
