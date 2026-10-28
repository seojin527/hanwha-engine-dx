import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { OcrItem } from "../lib/ocr";
import {
  fetchMeasurements,
  saveMeasurement,
  measurementStatusLabels,
  type MeasurementRecord,
  type SavedMeasurement,
} from "../lib/measurementAPI";
import InstrumentSelect from "./review/InstrumentSelect";
import { recommendedInstruments } from "../lib/inspection/instruments";
import { formatNumber } from "../lib/inspection/tolerance";
import { useReportUnsaved } from "../lib/unsavedChanges";
import type { WorkPurpose } from "../lib/purpose";
import { RESULT_BOX, WorkFooter, saveErrorText } from "./work/WorkParts";

interface Props {
  /** 이 화면의 작업 목적. 조회·저장 모두 이 목적의 기록만 쓴다. */
  purpose: WorkPurpose;
  drawingId: string;
  revision: string;
  item: OcrItem;
  onSaved?: (record: SavedMeasurement) => void;
  /** 다른 업무 작업자가 보는 중이면 true: 저장된 값만 보여주고 입력·저장을 막는다. */
  readOnly?: boolean;
  /** 이전·다음 항목 (하단 고정 버튼). 합격 저장이 끝나면 다음 항목으로 넘어간다. */
  onNavigate?: (delta: number) => void;
  /** 입력 위에 보여줄 검사 기준 요약 */
  criteria?: ReactNode;
}

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * 작업자 측정 입력.
 * - 실측값: 관리자가 정한 허용 범위(기준치수 ± 공차) 안이면 [합격], 밖이면 [불합격]만 눌린다.
 * - 합격/불합격 기록: 판정 기준을 보고 [합격]/[불합격]을 바로 누른다.
 * 버튼을 누르면 바로 저장되고, 서버가 같은 기준으로 다시 판정한다.
 */
export default function OcrMeasurementEntry({ purpose, drawingId, revision, item, onSaved, readOnly = false, onNavigate, criteria }: Props) {
  const mode = item.measurement_mode ?? "numeric";

  const [value, setValue] = useState("");
  const [instrument, setInstrument] = useState(item.instrument ?? "");
  const [note, setNote] = useState("");
  const [record, setRecord] = useState<MeasurementRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  // 입력만 하고 저장하지 않은 값이 있으면 페이지 전환 전에 확인하도록 알린다.
  useReportUnsaved(dirty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRecord(null);
    setValue("");
    setInstrument(item.instrument ?? "");
    setNote("");
    setDirty(false);

    fetchMeasurements(purpose, drawingId, revision, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.drawing_id !== drawingId || response.revision !== revision || response.work_purpose !== purpose) {
          throw new Error("측정 결과의 버전이 일치하지 않습니다.");
        }
        const saved = response.records.find((entry) => entry.item_id === item.id) ?? null;
        setRecord(saved);
        if (saved) {
          setValue(saved.measured_value);
          setInstrument(saved.instrument);
          setNote(saved.note);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "측정 결과 조회 실패");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [purpose, drawingId, revision, item.id, item.instrument]);

  function markChanged() {
    setDirty(true);
    setError("");
  }

  // ------------------------------------------------ 허용 범위 (관리자가 정한 기준치수 ± 공차)
  const low = typeof item.lower_limit === "number" ? item.lower_limit : null;
  const high = typeof item.upper_limit === "number" ? item.upper_limit : null;
  const hasRange = mode === "numeric" && item.inspection_approved === true && low !== null && high !== null;
  const unit = item.unit || "mm";
  const trimmed = value.trim();
  const numeric = NUMBER_RE.test(trimmed) ? Number(trimmed) : null;
  const EPS = 1e-9;
  const inRange = hasRange && numeric !== null ? numeric >= low! - EPS && numeric <= high! + EPS : null;
  const offBy =
    hasRange && numeric !== null && inRange === false
      ? numeric > high!
        ? `상한보다 +${formatNumber(numeric - high!)} ${unit} 큼`
        : `하한보다 -${formatNumber(low! - numeric)} ${unit} 작음`
      : "";

  async function save(result: "pass" | "fail" | "record") {
    if (readOnly || loading || savingRef.current) return;
    if (mode === "numeric" && numeric === null) {
      setError("실측값을 숫자로 입력해주세요.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await saveMeasurement(purpose, drawingId, item.id, {
        revision,
        measurement_mode: mode,
        measured_value: mode === "numeric" ? trimmed : "",
        gauge_result: mode === "gauge" ? (result === "pass" ? "pass" : "fail") : null,
        // 합격이면 바로 측정 완료로 저장한다 (서버도 적합일 때만 완료로 받는다).
        confirmed: result === "pass",
        instrument: instrument.trim(),
        note: note.trim(),
      });
      if (!mounted.current) return;
      if (saved.drawing_id !== drawingId || saved.revision !== revision || saved.item_id !== item.id || saved.work_purpose !== purpose) {
        throw new Error("다른 항목의 측정 결과가 반환됐습니다.");
      }
      setRecord(saved);
      setDirty(false);
      onSaved?.(saved);
      // 합격(또는 기준 없이 기록)이면 다음 항목으로. 불합격은 결과를 보고 다시 재도록 이 항목에 남는다.
      if (result !== "fail") onNavigate?.(1);
    } catch (cause: unknown) {
      if (mounted.current) setError(saveErrorText(cause));
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const currentRecord = dirty ? null : record;
  const label = "block space-y-1 text-[11px] font-medium text-dx-muted";
  const canPass = mode === "gauge" || inRange === true;
  const canFail = mode === "gauge" || inRange === false;
  const recordOnly = mode === "numeric" && !hasRange;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {mode === "gauge" && criteria}
        {readOnly && <p className="rounded border border-dx-line bg-dx-raised/60 px-3 py-2 text-xs text-dx-muted">이 업무의 담당 작업자만 입력할 수 있습니다. 저장된 결과만 표시합니다.</p>}
        {loading && <p role="status" className="text-[11px] text-dx-muted">저장된 결과 불러오는 중…</p>}
        <fieldset disabled={readOnly || loading || saving} className="space-y-3">
          {mode === "numeric" ? (
            <label className={label}>
              <span className="flex items-baseline justify-between gap-2">
                <span>실측값 ({unit})</span>
                {hasRange && <span className="font-mono text-[12px] text-white">허용 {formatNumber(low!)} ~ {formatNumber(high!)}</span>}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                placeholder="측정한 값을 입력하세요"
                autoComplete="off"
                onChange={(event) => {
                  setValue(event.target.value);
                  markChanged();
                }}
                onKeyDown={(event) => {
                  // Enter: 범위 안이면 합격 저장 후 다음 (밖이면 저장하지 않는다)
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (recordOnly && numeric !== null) void save("record");
                  else if (inRange === true) void save("pass");
                }}
                className={`dx-input h-10 font-mono text-base ${
                  inRange === true ? "border-emerald-500 focus:border-emerald-400 focus:ring-emerald-400" : inRange === false ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400" : ""
                }`}
              />
            </label>
          ) : (
            <p className="text-xs text-dx-muted">판정 기준을 보고 아래 [합격] 또는 [불합격]을 누릅니다.</p>
          )}
          {mode === "numeric" && (
            <p aria-live="polite" className="min-h-4 text-xs font-medium">
              {trimmed && numeric === null && <span className="text-rose-300">숫자로 입력해주세요.</span>}
              {inRange === true && <span className="text-emerald-300">허용 범위 안 → 합격 가능</span>}
              {inRange === false && <span className="text-rose-300">허용 범위 밖 ({offBy}) → 측정 위치·측정기를 확인하세요</span>}
              {recordOnly && <span className="text-amber-200">허용 범위가 없어 자동 판정 없이 기록만 합니다.</span>}
            </p>
          )}

          {mode === "numeric" && criteria}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              사용 측정기
              <InstrumentSelect
                className="dx-input"
                value={instrument}
                onChange={(next) => {
                  setInstrument(next);
                  markChanged();
                }}
                recommended={Array.from(
                  new Set([
                    ...(item.instrument ? [item.instrument] : []),
                    ...recommendedInstruments({
                      feature: item.feature_type,
                      gdtSymbols:
                        item.category === "GDT" ? item.raw_text.split("\n").map((row) => row.split("|")[0]) : [],
                    }),
                  ]),
                )}
              />
            </label>
            <label className={label}>
              측정 메모
              <textarea
                className="dx-input"
                rows={1}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  markChanged();
                }}
              />
            </label>
          </div>

          {currentRecord ? (
            <div role="status" className={`space-y-0.5 rounded px-3 py-2 text-xs ${RESULT_BOX[currentRecord.status] ?? RESULT_BOX.pending}`}>
              <p className="font-semibold">
                저장된 판정: {currentRecord.judgement === "pass" ? "합격" : currentRecord.judgement === "fail" ? "불합격" : "판정 보류"}
                {" · "}
                {measurementStatusLabels[currentRecord.status]}
                {currentRecord.measured_value ? ` · ${currentRecord.measured_value} ${unit}` : ""}
              </p>
              <p>{currentRecord.judgement_reason}</p>
              {currentRecord.judgement === "fail" && <p>측정 위치와 측정기를 확인한 뒤 다시 측정해주세요. 이전 결과는 기록으로 남습니다.</p>}
            </div>
          ) : (
            dirty && <p className="text-[11px] text-dx-muted">아직 저장하지 않았습니다. 아래 버튼을 누르면 저장됩니다.</p>
          )}
        </fieldset>
      </div>

      <WorkFooter error={error}>
        <button type="button" className="dx-btn dx-btn-lg dx-icon-btn w-9" aria-label="이전 항목" title="이전 항목" onClick={() => onNavigate?.(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        {readOnly ? (
          <span className="flex-1 text-center text-xs text-dx-muted">조회 전용 · 이전/다음으로 항목을 넘겨 볼 수 있습니다</span>
        ) : recordOnly ? (
          <button type="button" disabled={loading || saving || numeric === null} onClick={() => void save("record")} className="dx-btn dx-btn-primary dx-btn-lg flex-1">
            {saving ? "저장 중…" : "기록 · 저장 후 다음"}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={loading || saving || !canPass}
              onClick={() => void save("pass")}
              className="dx-btn dx-btn-lg flex-1 border-emerald-600 bg-emerald-600 text-white hover:border-emerald-500 hover:bg-emerald-500"
              title={mode === "numeric" ? "허용 범위 안일 때만 누를 수 있습니다" : undefined}
            >
              {saving ? "저장 중…" : "합격 · 저장 후 다음"}
            </button>
            <button
              type="button"
              disabled={loading || saving || !canFail}
              onClick={() => void save("fail")}
              className="dx-btn dx-btn-lg border-rose-500/70 bg-transparent text-rose-300 hover:bg-rose-500/10"
              title={mode === "numeric" ? "허용 범위 밖일 때만 누를 수 있습니다" : undefined}
            >
              불합격 저장
            </button>
          </>
        )}
        <button type="button" className="dx-btn dx-btn-lg dx-icon-btn w-9" aria-label="다음 항목" title="다음 항목" onClick={() => onNavigate?.(1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </WorkFooter>
    </div>
  );
}
