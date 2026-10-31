import { useEffect, useRef, useState } from "react";
import InstrumentSelect from "../review/InstrumentSelect";
import { recommendedInstruments } from "../../lib/inspection/instruments";
import { formatNumber } from "../../lib/inspection/tolerance";
import { measurementStatusClasses, measurementStatusLabels } from "../../lib/measurementAPI";
import { useReportUnsaved } from "../../lib/unsavedChanges";
import {
  STAGE_NAME,
  criteriaCenter,
  type MachiningRecord,
  type StageCriteria,
  type StageKey,
  type StageRecordBody,
} from "../../lib/machiningAPI";

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

interface Props {
  stage: StageKey;
  criteria: StageCriteria;
  /** 도면 표기 (예: Ø400) — 지름이면 직경·반경 보정량을 함께 보여준다 */
  rawText: string;
  unit: string;
  /** 관리자가 지정한 측정기 */
  defaultInstrument: string;
  featureType?: string | null;
  gdtSymbols?: string[];
  record: MachiningRecord | null;
  /** 잠긴 단계면 이유 문구 */
  locked?: string;
  zeroChecked: (instrument: string) => boolean;
  onZeroChecked: (instrument: string, checked: boolean) => void;
  save: (body: StageRecordBody) => Promise<MachiningRecord>;
}

/**
 * 부품제작 단계 측정 입력.
 * - 측정 전 기준봉·기준 시편으로 측정기 0점을 확인해야 저장할 수 있다 (OPL: 0점 셋팅 미실시로 측정 오류).
 * - 실측값을 넣으면 목표와의 차이와 공구 보정량(직경·반경 지정)을 바로 보여준다 (가공표준서: 편차만큼 보정).
 * - 범위 안이면 [합격], 밖이면 [불합격]만 눌린다. 서버도 같은 기준으로 다시 판정한다.
 */
export default function StageEntry({
  stage, criteria, rawText, unit, defaultInstrument, featureType, gdtSymbols = [], record, locked,
  zeroChecked, onZeroChecked, save,
}: Props) {
  const mode = criteria.mode;
  const [value, setValue] = useState(record?.measured_value ?? "");
  const [instrument, setInstrument] = useState(record?.instrument || defaultInstrument);
  const [note, setNote] = useState(record?.note ?? "");
  const [saved, setSaved] = useState<MachiningRecord | null>(record);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useReportUnsaved(dirty);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const changed = () => {
    setDirty(true);
    setError("");
  };

  const low = criteria.lower_limit;
  const high = criteria.upper_limit;
  const hasRange = mode === "numeric" && low !== null && high !== null;
  const trimmed = value.trim();
  const numeric = NUMBER_RE.test(trimmed) ? Number(trimmed) : null;
  const EPS = 1e-9;
  const inRange = hasRange && numeric !== null ? numeric >= low! - EPS && numeric <= high! + EPS : null;
  const zeroOk = instrument.trim() !== "" && zeroChecked(instrument);
  const stageName = STAGE_NAME[stage];

  // 보정값 안내: 보정량 = 목표 − 실측 (축·구멍 모두 같은 식). 지름이면 반경 지정 기계는 절반.
  const center = criteriaCenter(criteria);
  const diameter = /^[Ø⌀∅]/.test(rawText.trim());
  const correction = mode === "numeric" && numeric !== null && center !== null ? center - numeric : null;

  async function submit(result: "pass" | "fail" | "record") {
    if (savingRef.current || locked) return;
    if (!zeroOk) {
      setError("측정 전에 기준봉·기준 시편으로 측정기 0점을 확인하고 체크해주세요.");
      return;
    }
    if (mode === "numeric" && numeric === null) {
      setError("실측값을 숫자로 입력해주세요.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const next = await save({
        measured_value: mode === "numeric" ? trimmed : "",
        gauge_result: mode === "gauge" ? (result === "pass" ? "pass" : "fail") : null,
        confirmed: result === "pass",
        zero_checked: true,
        instrument: instrument.trim(),
        note: note.trim(),
      });
      if (!mounted.current) return;
      setSaved(next);
      setDirty(false);
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "측정 저장 실패");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const current = dirty ? null : saved;
  const passClass = "btn btn-lg w-full";

  return (
    <section aria-label={`${stageName} 측정 입력`} className="card">
      <header className="card-header">
        <h3 className="text-xs font-semibold text-slate-900">{stageName} 측정 입력</h3>
      </header>
      <div className="card-body">
        {locked && <p role="status" className="note note-warn mb-3">{locked}</p>}
        <fieldset disabled={saving || Boolean(locked)} className="space-y-3">
          {mode === "gauge" ? (
            <p className="note note-info whitespace-pre-wrap">
              <b className="mr-1 font-semibold">판정 기준</b>
              {criteria.text}
            </p>
          ) : hasRange ? (
            <div className="worker-range-summary">
              <span className="text-[11px] text-slate-500">
                {criteria.role === "allowance" ? `${stageName} 목표 범위` : "허용 범위"}
              </span>
              <b className="font-mono text-sm font-semibold text-slate-900">
                {formatNumber(low!)} ~ {formatNumber(high!)} {unit}
              </b>
              {criteria.target !== null && (
                <span className="text-[11px] text-slate-500">목표 {formatNumber(criteria.target)}</span>
              )}
            </div>
          ) : (
            <p className="note note-warn">판정 범위가 없어 관리자 확인이 필요합니다.</p>
          )}

          <label className="block space-y-1">
            <span className="field-label">사용 측정기 {defaultInstrument && <span className="font-normal text-slate-500">· 관리자 지정: {defaultInstrument}</span>}</span>
            <InstrumentSelect
              className="field"
              value={instrument}
              onChange={(next) => {
                setInstrument(next);
                changed();
              }}
              recommended={Array.from(
                new Set([
                  ...(defaultInstrument ? [defaultInstrument] : []),
                  ...recommendedInstruments({ feature: featureType ?? undefined, gdtSymbols }),
                ]),
              )}
            />
          </label>

          <label
            className={`flex items-start gap-2 rounded border px-2.5 py-2 text-xs ${
              zeroOk ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={zeroOk}
              disabled={!instrument.trim()}
              onChange={(event) => onZeroChecked(instrument, event.target.checked)}
            />
            <span>
              <b className="font-semibold">측정 전 0점 확인</b> — 기준봉·기준 시편으로 {instrument || "측정기"} 0점을 맞췄습니다.
              <span className="block text-[10px] opacity-80">같은 제품·단계에서 같은 측정기는 한 번만 체크하면 됩니다.</span>
            </span>
          </label>

          {mode === "numeric" && (
            <>
              <label className="block space-y-1">
                <span className="field-label">실측값 ({unit})</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={value}
                  placeholder="측정한 값을 입력하세요"
                  onChange={(event) => {
                    setValue(event.target.value);
                    changed();
                  }}
                  className={`field h-9 font-mono text-sm ${
                    inRange === true
                      ? "border-emerald-500 bg-emerald-50"
                      : inRange === false
                        ? "border-rose-500 bg-rose-50"
                        : ""
                  }`}
                />
              </label>
              {trimmed && numeric === null && <p className="text-[11px] text-rose-700">숫자로 입력해주세요.</p>}
              {inRange === true && <p className="text-[11px] font-medium text-emerald-700">범위 안입니다.</p>}
              {inRange === false && (
                <p className="text-[11px] font-medium text-rose-700">범위 밖입니다. 측정 위치·측정기를 확인하세요.</p>
              )}
              {correction !== null && Math.abs(correction) > EPS && (
                <p className="rounded bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700">
                  목표 대비 {numeric! > center! ? "+" : "−"}{formatNumber(Math.abs(numeric! - center!))} {unit}
                  {" → 공구 보정 "}
                  {diameter
                    ? `직경 지정 ${correction > 0 ? "+" : "−"}${formatNumber(Math.abs(correction))} / 반경 지정 ${correction > 0 ? "+" : "−"}${formatNumber(Math.abs(correction) / 2)}`
                    : `${correction > 0 ? "+" : "−"}${formatNumber(Math.abs(correction))}`}
                </p>
              )}
            </>
          )}

          <details className="worker-memo worker-disclosure">
            <summary>측정 메모 추가</summary>
            <label className="block space-y-1">
            <span className="field-label">측정 메모</span>
            <textarea
              className="field"
              rows={2}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                changed();
              }}
            />
          </label>
          </details>

          <div className="worker-entry-actions grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!zeroOk || (mode === "numeric" && inRange !== true)}
              onClick={() => void submit("pass")}
              className={`${passClass} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`}
            >
              {saving ? "저장 중…" : "합격"}
            </button>
            <button
              type="button"
              disabled={!zeroOk || (mode === "numeric" && inRange !== false)}
              onClick={() => void submit("fail")}
              className={`${passClass} border-rose-600 bg-white text-rose-700 hover:bg-rose-50`}
            >
              불합격
            </button>
          </div>
          {!zeroOk && <p className="text-[10px] text-amber-800">0점 확인을 체크해야 기록할 수 있습니다.</p>}

          {current ? (
            <div role="status" className={`space-y-1 rounded p-2.5 text-xs ${measurementStatusClasses[current.status]}`}>
              <p className="font-semibold">
                {current.judgement === "pass" ? "합격" : current.judgement === "fail" ? "불합격" : "판정 보류"}
                {" · "}
                {measurementStatusLabels[current.status]}
                {current.measured_value ? ` · ${current.measured_value} ${unit}` : ""}
              </p>
              <p>{current.judgement_reason}</p>
            </div>
          ) : (
            dirty && <p className="text-[11px] text-slate-500">입력값이 바뀌었습니다. 버튼을 누르면 저장됩니다.</p>
          )}
        </fieldset>
        {error && <p role="alert" className="note note-error mt-3 whitespace-pre-wrap">{error}</p>}
      </div>
    </section>
  );
}
