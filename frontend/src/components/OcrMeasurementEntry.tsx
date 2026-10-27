import { useEffect, useRef, useState } from "react";
import type { OcrItem } from "../lib/ocr";
import {
  fetchMeasurements,
  saveMeasurement,
  measurementStatusClasses,
  measurementStatusLabels,
  type MeasurementRecord,
  type SavedMeasurement,
} from "../lib/measurementAPI";
import InstrumentSelect from "./review/InstrumentSelect";
import { recommendedInstruments } from "../lib/inspection/instruments";
import { formatNumber } from "../lib/inspection/tolerance";
import { useReportUnsaved } from "../lib/unsavedChanges";
import type { WorkPurpose } from "../lib/purpose";

interface Props {
  /** 이 화면의 작업 목적. 조회·저장 모두 이 목적의 기록만 쓴다. */
  purpose: WorkPurpose;
  drawingId: string;
  revision: string;
  item: OcrItem;
  onSaved?: (record: SavedMeasurement) => void;
}

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * 작업자 측정 입력.
 * - 실측값: 관리자가 정한 허용 범위(기준치수 ± 공차) 안이면 [합격], 밖이면 [불합격]만 눌린다.
 * - 합격/불합격 기록: 판정 기준을 보고 [합격]/[불합격]을 바로 누른다.
 * 버튼을 누르면 바로 저장되고, 서버가 같은 기준으로 다시 판정한다.
 */
export default function OcrMeasurementEntry({ purpose, drawingId, revision, item, onSaved }: Props) {
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
    if (loading || savingRef.current) return;
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
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "측정 저장 실패");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const currentRecord = dirty ? null : record;
  const inputClass = "field";
  const passClass = "btn btn-lg w-full";

  return (
    <section aria-label="측정 입력" className="card">
      <header className="card-header">
        <h3 className="text-xs font-semibold text-slate-900">측정 입력</h3>
        {loading && (
          <p role="status" className="text-[11px] text-slate-500">
            저장된 결과 불러오는 중…
          </p>
        )}
      </header>

      <div className="card-body">
      <fieldset disabled={loading || saving} className="space-y-3">
        {mode === "gauge" ? (
          <p className="note note-info whitespace-pre-wrap">
            <b className="mr-1 font-semibold">판정 기준</b>
            {item.gauge_criteria || "관리자 설정이 필요합니다."}
          </p>
        ) : (
          <>
            {hasRange ? (
              <div className="flex flex-wrap items-baseline gap-x-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="text-[11px] text-slate-500">허용 범위</span>
                <b className="font-mono text-sm font-semibold text-slate-900">
                  {formatNumber(low!)} ~ {formatNumber(high!)} {unit}
                </b>
                {typeof item.nominal_value === "number" && (
                  <span className="text-[11px] text-slate-500">기준 {formatNumber(item.nominal_value)}</span>
                )}
              </div>
            ) : (
              <p className="note note-warn">
                허용 범위가 지정되지 않아 자동 판정 없이 기록만 합니다.
              </p>
            )}
            <label className="block space-y-1">
              <span className="field-label">실측값 ({unit})</span>
              <input
                type="text"
                inputMode="decimal"
                value={value}
                placeholder="측정한 값을 입력하세요"
                onChange={(event) => {
                  setValue(event.target.value);
                  markChanged();
                }}
                className={`${inputClass} h-9 font-mono text-sm ${
                  inRange === true
                    ? "border-emerald-500 bg-emerald-50 focus:border-emerald-600 focus:ring-emerald-600"
                    : inRange === false
                      ? "border-rose-500 bg-rose-50 focus:border-rose-600 focus:ring-rose-600"
                      : ""
                }`}
              />
            </label>
            {trimmed && numeric === null && <p className="text-[11px] text-rose-700">숫자로 입력해주세요.</p>}
            {inRange === true && <p className="text-[11px] font-medium text-emerald-700">허용 범위 안입니다.</p>}
            {inRange === false && (
              <p className="text-[11px] font-medium text-rose-700">허용 범위 밖입니다 ({offBy}). 측정 위치·측정기를 확인하세요.</p>
            )}
          </>
        )}

        <label className="block space-y-1">
          <span className="field-label">
            사용 측정기 {item.instrument && <span className="font-normal text-slate-500">· 관리자 지정: {item.instrument}</span>}
          </span>
          <InstrumentSelect
            className={inputClass}
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

        <label className="block space-y-1">
          <span className="field-label">측정 메모</span>
          <textarea
            className={inputClass}
            rows={2}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              markChanged();
            }}
          />
        </label>

        {mode === "numeric" && !hasRange ? (
          <button
            type="button"
            disabled={numeric === null}
            onClick={() => void save("record")}
            className="btn btn-primary btn-lg w-full"
          >
            {saving ? "저장 중…" : "측정값 기록"}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={mode === "numeric" && inRange !== true}
              onClick={() => void save("pass")}
              className={`${passClass} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`}
            >
              {saving ? "저장 중…" : "합격"}
            </button>
            <button
              type="button"
              disabled={mode === "numeric" && inRange !== false}
              onClick={() => void save("fail")}
              className={`${passClass} border-rose-600 bg-white text-rose-700 hover:bg-rose-50`}
            >
              불합격
            </button>
          </div>
        )}
        {mode === "numeric" && hasRange && (
          <p className="text-[10px] text-slate-500">값이 허용 범위 안이면 [합격], 밖이면 [불합격]만 누를 수 있습니다.</p>
        )}

        {currentRecord ? (
          <div role="status" className={`space-y-1 rounded p-2.5 text-xs ${measurementStatusClasses[currentRecord.status]}`}>
            <p className="font-semibold">
              {currentRecord.judgement === "pass" ? "합격" : currentRecord.judgement === "fail" ? "불합격" : "판정 보류"}
              {" · "}
              {measurementStatusLabels[currentRecord.status]}
              {currentRecord.measured_value ? ` · ${currentRecord.measured_value} ${unit}` : ""}
            </p>
            <p>{currentRecord.judgement_reason}</p>
            {currentRecord.judgement === "fail" && (
              <p>측정 위치와 측정기를 확인한 뒤 다시 측정해주세요. 이전 결과는 기록으로 남습니다.</p>
            )}
          </div>
        ) : (
          dirty && <p className="text-[11px] text-slate-500">입력값이 바뀌었습니다. 버튼을 누르면 저장됩니다.</p>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="note note-error whitespace-pre-wrap">
          {error}
        </p>
      )}
      </div>
    </section>
  );
}
