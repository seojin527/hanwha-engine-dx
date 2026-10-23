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

interface Props {
  drawingId: string;
  revision: string;
  item: OcrItem;
  onSaved?: (record: SavedMeasurement) => void;
}

export default function OcrMeasurementEntry({
  drawingId,
  revision,
  item,
  onSaved,
}: Props) {
  const mode = item.measurement_mode ?? "numeric";

  const [value, setValue] = useState("");
  const [gauge, setGauge] = useState<"pass" | "fail" | null>(null);
  const [instrument, setInstrument] = useState(item.instrument ?? "");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [record, setRecord] = useState<MeasurementRecord | null>(null);
  const [dirty, setDirty] = useState(false);
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
    setConfirmed(false);
    setValue("");
    setGauge(null);
    setInstrument(item.instrument ?? "");
    setNote("");
    setDirty(false);

    fetchMeasurements(drawingId, revision, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;

        if (
          response.drawing_id !== drawingId ||
          response.revision !== revision
        ) {
          throw new Error("측정 결과의 버전이 일치하지 않습니다.");
        }

        const saved =
          response.records.find((entry) => entry.item_id === item.id) ?? null;

        setRecord(saved);

        if (saved) {
          setValue(saved.measured_value);
          setGauge(saved.gauge_result);
          setInstrument(saved.instrument);
          setNote(saved.note);
          setConfirmed(saved.confirmed);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "측정 결과 조회 실패",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [drawingId, revision, item.id, item.instrument]);

  function markChanged() {
    setDirty(true);
    setConfirmed(false);
    setError("");
  }

  async function save() {
    if (loading || savingRef.current) return;

    if (mode === "numeric" && !value.trim()) {
      setError("실측값을 입력해주세요.");
      return;
    }

    if (mode === "gauge" && !gauge) {
      setError("게이지 검사 결과를 선택해주세요.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");

    try {
      const saved = await saveMeasurement(drawingId, item.id, {
        revision,
        measurement_mode: mode,
        measured_value: mode === "numeric" ? value.trim() : "",
        gauge_result: mode === "gauge" ? gauge : null,
        confirmed: !dirty && record?.judgement === "pass" && confirmed,
        instrument: instrument.trim(),
        note: note.trim(),
      });

      if (!mounted.current) return;

      if (
        saved.drawing_id !== drawingId ||
        saved.revision !== revision ||
        saved.item_id !== item.id
      ) {
        throw new Error("다른 항목의 측정 결과가 반환됐습니다.");
      }

      setRecord(saved);
      setConfirmed(saved.confirmed);
      setDirty(false);
      onSaved?.(saved);
    } catch (cause: unknown) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : "측정 저장 실패");
      }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const currentRecord = dirty ? null : record;
  const canConfirm = currentRecord?.judgement === "pass";
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-bold">측정 결과 및 판정</h3>

      {loading && (
        <p role="status" className="text-xs text-slate-500">
          저장된 측정 결과를 불러오는 중…
        </p>
      )}

      <fieldset disabled={loading || saving} className="space-y-3">
        {mode === "gauge" ? (
          <>
            <p className="rounded-lg bg-white p-3 text-xs text-slate-600">
              검사 기준: {item.gauge_criteria || "관리자 설정이 필요합니다."}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={gauge === "pass"}
                onClick={() => {
                  setGauge("pass");
                  markChanged();
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                  gauge === "pass"
                    ? "border-emerald-600 bg-emerald-100 text-emerald-800"
                    : "border-slate-300 bg-white text-slate-600"
                }`}
              >
                검사 적합
              </button>

              <button
                type="button"
                aria-pressed={gauge === "fail"}
                onClick={() => {
                  setGauge("fail");
                  markChanged();
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                  gauge === "fail"
                    ? "border-red-600 bg-red-100 text-red-700"
                    : "border-slate-300 bg-white text-slate-600"
                }`}
              >
                검사 부적합
              </button>
            </div>
          </>
        ) : (
          <label className="block space-y-1 text-xs font-semibold">
            <span>실측값 ({item.unit || "단위 확인 필요"})</span>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              placeholder="실제 측정한 값을 입력하세요"
              onChange={(event) => {
                setValue(event.target.value);
                markChanged();
              }}
              className={`${inputClass} ${
                currentRecord?.judgement === "fail"
                  ? "border-red-500 bg-red-50"
                  : currentRecord?.judgement === "pass"
                    ? "border-emerald-500 bg-emerald-50"
                    : ""
              }`}
            />
          </label>
        )}

        <label className="block space-y-1 text-xs">
          <span>사용 측정기</span>
          <input
            className={inputClass}
            value={instrument}
            onChange={(event) => {
              setInstrument(event.target.value);
              markChanged();
            }}
            placeholder="예: 외경 마이크로미터"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span>측정 메모</span>
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

        {currentRecord ? (
          <div
            role="status"
            className={`space-y-1 rounded-lg p-3 text-xs ${
              measurementStatusClasses[currentRecord.status]
            }`}
          >
            <p className="font-bold">
              {currentRecord.judgement === "pass"
                ? "적합"
                : currentRecord.judgement === "fail"
                  ? "부적합"
                  : "판정 보류"}
              {" · "}
              {measurementStatusLabels[currentRecord.status]}
            </p>
            <p>{currentRecord.judgement_reason}</p>

            {currentRecord.judgement === "fail" && (
              <p>
                측정 위치와 측정기를 확인한 뒤 다시 측정해주세요.
                이전에 저장한 결과는 기록으로 남습니다.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {dirty
              ? "입력값이 변경됐습니다. 결과를 저장하면 서버에서 판정합니다."
              : "측정 대기 중입니다."}
          </p>
        )}

        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!canConfirm}
            onChange={(event) => {
              setConfirmed(event.currentTarget.checked);
              setError("");
            }}
          />
          측정 결과를 확인했습니다
        </label>

        {!canConfirm && (
          <p className="text-[11px] text-slate-500">
            결과를 저장하여 적합 판정을 받은 후 확인할 수 있습니다.
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          className="w-full rounded-lg bg-cyan-700 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-40"
        >
          {saving
            ? "저장 중…"
            : confirmed && canConfirm
              ? "측정 확인 및 완료 저장"
              : "측정 결과 저장·판정"}
        </button>
      </fieldset>

      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-700"
        >
          {error}
        </p>
      )}
    </section>
  );
}