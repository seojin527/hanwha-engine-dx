import { useEffect, useMemo, useState } from "react";
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
}

interface Draft {
  mode: "numeric" | "gauge";
  feature: string;
  toleranceSource: ToleranceSource;
  upper: string;
  lower: string;
  unit: string;
  instrument: string;
  criteria: string;
  /** false면 기하공차·나사 판정 기준 문구를 확정 값으로 자동 작성 */
  criteriaEdited: boolean;
}

interface AddedDimension {
  id: string;
  text: string;
  x: string;
  y: string;
  positionConfirmed?: boolean;
}

type Filter = "all" | "DIMENSION" | "GDT" | "unconfirmed" | "invalid" | "edited";

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100";
const editClass =
  "w-full rounded-md border border-cyan-300 bg-cyan-50/50 px-2.5 py-1.5 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100";
const cardClass = "space-y-3 rounded-xl border border-slate-200 bg-white p-3.5";

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

/** 고를 수 있는 형상이 하나뿐이면 그것으로 채운다 (C·R·M 치수, 평면도). 저장된 형상이 맞으면 유지. */
function defaultFeature(item: OcrItem, allowed: string[]): string {
  if (item.feature_type && item.feature_type !== "UNKNOWN" && allowed.includes(item.feature_type)) {
    return item.feature_type;
  }
  return allowed.length === 1 ? allowed[0] : "";
}

function defaultToleranceSource(parsed: ParsedDimension): ToleranceSource {
  if (parsed.drawing) return "drawing";
  if (parsed.general !== null) return "general";
  return "special";
}

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
}: Props) {
  const points = source.result.items;
  const documentUnit = source.result.unit || "mm";

  const [dimensions, setDimensions] = useState<Record<string, string>>({});
  const [gdtValues, setGdtValues] = useState<Record<string, string>>({});
  const [gdtSymbols, setGdtSymbols] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [added, setAdded] = useState<AddedDimension[]>([]);
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

  // 도면·OCR 버전이 바뀌면 편집 상태를 새로 만든다. 저장된 검토가 있으면 그 상태를 이어서 보여준다.
  useEffect(() => {
    const reviewed = source.result.review_status === "reviewed";
    setDimensions(Object.fromEntries(source.review.dimensions.map((item) => [item.item_id, item.text])));
    setGdtValues(Object.fromEntries(source.review.gdt.map((row) => [row.item_id, row.value])));
    setGdtSymbols(Object.fromEntries(source.review.gdt.map((row) => [row.item_id, row.symbol])));

    const nextDrafts: Record<string, Draft> = {};
    const nextConfirmed: Record<string, boolean> = {};
    for (const item of source.result.items) {
      const approved = reviewed && item.inspection_approved === true;
      const parsed = parseDimension(item.raw_text);
      const isGauge = item.category === "GDT" || parsed.kind === "THREAD_SPEC";
      const savedSource = item.tolerance_source?.toLowerCase() as ToleranceSource | undefined;
      const rowSymbols = source.review.gdt
        .filter((entry) => item.category === "GDT" && entry.entry_no === itemNumber(item))
        .map((entry) => entry.symbol);
      const allowed = allowedFeatures({ dimensionKind: parsed.kind, gdtSymbols: rowSymbols });
      nextDrafts[item.id] = {
        mode: approved && item.measurement_mode ? item.measurement_mode : isGauge ? "gauge" : "numeric",
        feature: defaultFeature(item, allowed),
        toleranceSource: approved && savedSource ? savedSource : defaultToleranceSource(parsed),
        upper:
          approved && item.tolerance_source === "SPECIAL" && typeof item.upper_deviation === "number"
            ? String(item.upper_deviation)
            : "",
        lower:
          approved && item.tolerance_source === "SPECIAL" && typeof item.lower_deviation === "number"
            ? String(item.lower_deviation)
            : "",
        unit: item.unit || source.result.unit || "mm",
        instrument: item.instrument ?? "",
        criteria: item.gauge_criteria ?? "",
        criteriaEdited: approved && !!item.gauge_criteria,
      };
      nextConfirmed[item.id] = approved;
    }
    setDrafts(nextDrafts);
    setConfirmed(nextConfirmed);
    setReviewer(source.result.reviewer ?? "");
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
    if (item.category === "GDT") return rowsByItem[item.id].some((row) => !isValidGdtValue(gdtValue(row)));
    return !parseDimension(dimensionText(item)).valid;
  }

  /** 확인 버튼을 막는 이유 목록. 비어 있으면 확인 가능. */
  function issuesFor(item: OcrItem): string[] {
    const issues: string[] = [];
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
        } else if (draft.toleranceSource === "drawing" && !parsed.drawing) {
          issues.push("도면 표기에 공차가 없습니다. 일반공차나 특별 공차를 선택해주세요.");
        } else if (draft.toleranceSource === "general" && parsed.general === null) {
          issues.push(`${GENERAL_LABEL} 적용 범위 밖입니다. 특별 공차를 입력해주세요.`);
        } else if (draft.toleranceSource === "special") {
          const upper = Number(draft.upper);
          const lower = Number(draft.lower);
          if (!draft.upper.trim() || !draft.lower.trim() || !Number.isFinite(upper) || !Number.isFinite(lower)) {
            issues.push("특별 공차의 상한·하한 편차를 숫자로 입력해주세요.");
          } else if (lower > upper) {
            issues.push("하한 편차가 상한 편차보다 큽니다.");
          }
        }
      }
    } else if (!effectiveCriteria(item, draft).trim()) {
      issues.push("합격·불합격 판정 기준을 입력해주세요.");
    }
    return issues;
  }

  const confirmedCount = points.filter((item) => confirmed[item.id]).length;
  const invalidItems = points.filter((item) => hasInvalidValue(item));
  const unconfirmedItems = points.filter((item) => !confirmed[item.id]);

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

  function unconfirm(itemId: string) {
    setConfirmed((previous) => ({ ...previous, [itemId]: false }));
    setError("");
  }

  function updateDraft(itemId: string, patch: Partial<Draft>) {
    setDrafts((previous) => ({ ...previous, [itemId]: { ...previous[itemId], ...patch } }));
    unconfirm(itemId);
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
    unconfirm(item.id);
  }

  function updateGdtValue(itemId: string, rowId: string, value: string) {
    setGdtValues((previous) => ({ ...previous, [rowId]: value }));
    unconfirm(itemId);
  }

  /** 기호·표기가 바뀌어 지금 형상을 고를 수 없게 되면 형상을 다시 맞춘다. */
  function syncFeature(itemId: string, allowed: string[]) {
    setDrafts((previous) => {
      const draft = previous[itemId];
      if (!draft || allowed.includes(draft.feature)) return previous;
      return { ...previous, [itemId]: { ...draft, feature: allowed.length === 1 ? allowed[0] : "" } };
    });
  }

  function updateGdtSymbol(item: OcrItem, rowId: string, symbol: string) {
    setGdtSymbols((previous) => ({ ...previous, [rowId]: symbol }));
    const symbols = rowsByItem[item.id].map((row) => (row.item_id === rowId ? symbol : gdtSymbol(row)));
    syncFeature(item.id, allowedFeatures({ gdtSymbols: symbols }));
    unconfirm(item.id);
  }

  function confirmAndNext(item: OcrItem) {
    if (issuesFor(item).length) return;
    const next = { ...confirmed, [item.id]: true };
    setConfirmed(next);
    setError("");
    const index = points.findIndex((entry) => entry.id === item.id);
    for (let step = 1; step <= points.length; step += 1) {
      const candidate = points[(index + step) % points.length];
      if (!next[candidate.id]) {
        selectItem(candidate.id);
        return;
      }
    }
  }

  function updateAdded(id: string, patch: Partial<AddedDimension>) {
    setAdded((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              positionConfirmed:
                patch.x !== undefined || patch.y !== undefined || patch.text !== undefined
                  ? false
                  : patch.positionConfirmed ?? item.positionConfirmed,
            }
          : item,
      ),
    );
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

  async function save() {
    setError("");
    if (saving) return;
    if (picking) {
      setError("도면 위치 선택을 완료하거나 취소해주세요.");
      return;
    }
    if (unconfirmedItems.length) {
      setError(`미확인 항목이 ${unconfirmedItems.length}개 있습니다. 모든 항목을 확인해주세요.`);
      selectItem(unconfirmedItems[0].id);
      return;
    }
    if (!reviewer.trim()) {
      setError("검토자 이름을 입력해주세요.");
      return;
    }
    const pendingAdded = added.find((item) => !item.positionConfirmed || addedIssue(item));
    if (pendingAdded) {
      setError(addedIssue(pendingAdded) || "추가한 치수의 「측정 위치 확정」을 먼저 눌러주세요.");
      return;
    }

    const inspectionSettings: Record<string, InspectionSetting> = {};
    for (const item of points) {
      const draft = drafts[item.id];
      const setting: InspectionSetting = {
        measurement_mode: draft.mode,
        feature_type: draft.feature,
        unit: draft.unit.trim() || documentUnit,
        instrument: draft.instrument.trim(),
        gauge_criteria: draft.mode === "gauge" ? effectiveCriteria(item, draft).trim() : "",
        position_confirmed: true,
      };
      if (draft.mode === "numeric") {
        setting.tolerance_source = draft.toleranceSource;
        if (draft.toleranceSource === "special") {
          setting.upper_deviation = Number(draft.upper);
          setting.lower_deviation = Number(draft.lower);
        }
      }
      inspectionSettings[item.id] = setting;
    }

    setSaving(true);
    try {
      const result = await saveDrawingReview(source.drawing_id, {
        revision: source.revision,
        reviewer: reviewer.trim(),
        confirmed_item_ids: points.map((item) => item.id),
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
                <Chip tone="info">관리자 검토</Chip>
                {confirmed[selected.id] ? (
                  <Chip tone="ok">검토: 확인 완료</Chip>
                ) : hasInvalidValue(selected) ? (
                  <Chip tone="error">검토: 형식 오류</Chip>
                ) : (
                  <Chip tone="warn">검토: 미확인</Chip>
                )}
                {isEdited(selected) && <Chip tone="neutral">수정됨</Chip>}
              </>
            }
          />
        )}
        <ProgressBar
          label="검토 확인"
          done={confirmedCount}
          total={points.length}
          chips={
            <>
              {invalidItems.length > 0 && (
                <Chip tone="error" onClick={() => selectItem(invalidItems[0].id)}>
                  형식 오류 {invalidItems.length} → 이동
                </Chip>
              )}
              {unconfirmedItems.length > 0 && (
                <Chip tone="warn" onClick={() => selectItem(unconfirmedItems[0].id)}>
                  미확인 {unconfirmedItems.length}
                </Chip>
              )}
            </>
          }
        />
        {reviewedInfo && (
          <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-[11px] text-emerald-800">
            저장된 검토 · {reviewedInfo.reviewer || "검토자 미기록"}
            {reviewedInfo.at ? ` · ${reviewedInfo.at}` : ""} — 값이나 기준을 바꾸면 그 항목은 다시 확인해야 합니다.
          </p>
        )}
      </div>

      <fieldset disabled={saving || picking} className="flex-1 space-y-3 p-3.5">
        {source.review.warnings.map((warning, index) => (
          <p key={index} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {warning}
          </p>
        ))}

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
            confirmed={!!confirmed[selected.id]}
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
            onConfirm={() => confirmAndNext(selected)}
            onUnconfirm={() => unconfirm(selected.id)}
          />
        )}

        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-bold text-slate-700">
            ☰ 전체 항목 목록 ({points.length}) · 확인 {confirmedCount}
          </summary>
          <div className="space-y-2 border-t border-slate-100 p-3">
            <div role="group" aria-label="검토 항목 필터" className="flex flex-wrap gap-1.5">
              {([
                ["all", "전체"],
                ["DIMENSION", "치수"],
                ["GDT", "기하공차"],
                ["unconfirmed", "미확인"],
                ["invalid", "형식 오류"],
                ["edited", "수정됨"],
              ] as Array<[Filter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                    filter === value
                      ? "border-cyan-600 bg-cyan-600 text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:border-cyan-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <ul aria-label="검토 항목 목록" className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {points.map((item, index) => {
                const invalid = hasInvalidValue(item);
                const edited = isEdited(item);
                if (filter === "DIMENSION" || filter === "GDT") {
                  if (item.category !== filter) return null;
                }
                if (filter === "unconfirmed" && confirmed[item.id]) return null;
                if (filter === "invalid" && !invalid) return null;
                if (filter === "edited" && !edited) return null;
                return (
                  <li key={item.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => selectItem(item.id)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                        item.id === selectedId ? "bg-cyan-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-4 text-center font-bold ${
                          confirmed[item.id] ? "text-emerald-600" : invalid ? "text-rose-600" : "text-amber-500"
                        }`}
                      >
                        {confirmed[item.id] ? "✓" : invalid ? "!" : "•"}
                      </span>
                      <span className="w-6 text-slate-500">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-mono font-semibold">
                        {item.category === "GDT" ? gdtText(item).replace(/\n/g, "  ") : dimensionText(item)}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {item.category === "GDT" ? "기하공차" : "치수"}
                        {edited ? " · 수정" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-bold text-slate-700">
            + 놓친 치수 추가{" "}
            <span className="font-normal text-slate-500">OCR이 아예 못 읽은 치수 {added.length ? `· ${added.length}개 추가 중` : ""}</span>
          </summary>
          <div className="space-y-3 border-t border-slate-100 p-3">
            <p className="text-[11px] text-slate-600">
              표기를 입력하고 도면에서 위치를 고른 뒤 확정해주세요. 추가한 치수의 검사 기준은 저장 후 다시 열어 지정합니다.
            </p>
            {added.map((item) => {
              const issue = addedIssue(item);
              return (
                <div key={item.id} className="space-y-2 rounded-lg border border-slate-200 p-2.5">
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
                        className="rounded-lg border border-cyan-600 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800 hover:bg-cyan-100"
                      >
                        ① 도면에서 위치 선택
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!!issue}
                      onClick={() => updateAdded(item.id, { positionConfirmed: true })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${
                        item.positionConfirmed ? "bg-emerald-100 text-emerald-800" : "bg-cyan-700 text-white hover:bg-cyan-800"
                      }`}
                    >
                      {item.positionConfirmed ? "✓ 위치 확정됨" : "② 위치 확정"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdded((previous) => previous.filter((entry) => entry.id !== item.id))}
                      className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                    >
                      추가 취소
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
              onClick={() =>
                setAdded((previous) => [...previous, { id: crypto.randomUUID(), text: "", x: "", y: "" }])
              }
            >
              + 치수 추가
            </button>
          </div>
        </details>
      </fieldset>

      <footer className="sticky bottom-0 z-10 space-y-2 border-t border-slate-200 bg-white px-3.5 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        {error && (
          <p role="alert" className="whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-bold text-rose-700">
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
            className={`${inputClass} flex-1`}
            value={reviewer}
            disabled={saving}
            onChange={(event) => setReviewer(event.target.value)}
            placeholder="검토자 이름"
          />
          <button
            type="button"
            disabled={saving || picking}
            onClick={() => void save()}
            className="shrink-0 rounded-lg bg-cyan-700 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-40"
          >
            {saving ? "저장 중…" : "검토 완료 및 서버 저장"}
          </button>
        </div>
        {unconfirmedItems.length > 0 && (
          <p className="text-[11px] text-slate-500">모든 항목을 확인해야 저장할 수 있습니다 · 남은 항목 {unconfirmedItems.length}개</p>
        )}
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
  confirmed: boolean;
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  onDimension: (text: string) => void;
  onGdtValue: (rowId: string, value: string) => void;
  onGdtSymbol: (rowId: string, symbol: string) => void;
  onDraft: (patch: Partial<Draft>) => void;
  onConfirm: () => void;
  onUnconfirm: () => void;
}

function SelectedItem({
  item, dim, rows, draft, dimText, gdtValue, gdtSymbol, features, criteria, issues, confirmed,
  imageUrl, imageWidth, imageHeight, onDimension, onGdtValue, onGdtSymbol, onDraft, onConfirm, onUnconfirm,
}: SelectedProps) {
  const parsed = parseDimension(dimText);
  const isGdt = item.category === "GDT";
  const unit = draft?.unit || "mm";

  return (
    <div className="space-y-3">
      {/* ① OCR 값 확인 */}
      {isGdt ? (
        <div className={`${cardClass} ${rows.some((row) => !isValidGdtValue(gdtValue(row))) ? "border-rose-300 bg-rose-50/40" : ""}`}>
          <h3 className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
            기하공차 확인 <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-800">기호·공차값 수정</span>
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
              <div key={row.item_id} className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5">
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
          <h3 className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
            치수 확인 <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-800">잘못 읽었으면 수정</span>
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
          <h3 className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
            작업자 검사 기준
            <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-800">편집</span>
            <span className="flex-1" />
            <span className="text-[10px] font-normal text-slate-500">작업자 화면에 그대로 보입니다</span>
          </h3>

          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="측정 방식">
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
                  className={`rounded-lg border px-2 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-35 ${
                    draft.mode === mode ? "border-cyan-600 bg-cyan-600 text-white" : "border-slate-300 bg-white text-slate-600"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {(isGdt || parsed.kind === "THREAD_SPEC") && (
            <p className="text-[10px] text-slate-500">
              {isGdt ? "기하공차" : "나사"}는 게이지·CMM 결과를 합격/불합격으로 기록합니다.
            </p>
          )}

          <label className="block space-y-1 text-xs">
            <span className="text-slate-600">
              측정 형상{" "}
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
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                    draft.toleranceSource === value ? "border-cyan-500 bg-cyan-50" : "border-slate-200"
                  } ${available ? "" : "opacity-40"}`}
                >
                  <input
                    type="radio"
                    name={`tolerance-${item.id}`}
                    disabled={!available}
                    checked={draft.toleranceSource === value}
                    onChange={() => onDraft({ toleranceSource: value })}
                  />
                  <span className="font-semibold">{label}</span>
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
                      onChange={(event) => onDraft({ upper: event.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="text-slate-600">하한 편차 (부호 포함)</span>
                    <input
                      className={`${editClass} font-mono`}
                      inputMode="decimal"
                      placeholder="예: -0.02"
                      value={draft.lower}
                      onChange={(event) => onDraft({ lower: event.target.value })}
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
            <span className="text-slate-600">측정기</span>
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

      {/* ③ 확인 */}
      {confirmed ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
          <span className="font-bold">✓ 확인 완료</span>
          <span className="flex-1">값이나 기준을 바꾸면 다시 확인해야 합니다.</span>
          <button type="button" onClick={onUnconfirm} className="rounded border border-emerald-300 bg-white px-2 py-1 font-semibold hover:bg-emerald-100">
            확인 취소
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.length > 0 && (
            <ul className="space-y-0.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              {issues.map((issue) => (
                <li key={issue}>• {issue}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={issues.length > 0}
            onClick={onConfirm}
            className="w-full rounded-xl bg-cyan-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            ✓ 이 항목 확인하고 다음 미확인으로
          </button>
        </div>
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
    const upper = Number(draft.upper);
    const lower = Number(draft.lower);
    if (draft.upper.trim() && draft.lower.trim() && Number.isFinite(upper) && Number.isFinite(lower) && lower <= upper) {
      deviation = { upper, lower };
    }
  }
  return (
    <p className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-200">
      허용 범위{" "}
      <b className="font-mono text-sm text-cyan-300">
        {deviation ? formatRange(parsed.nominal, deviation.upper, deviation.lower, unit) : "—"}
      </b>
    </p>
  );
}
