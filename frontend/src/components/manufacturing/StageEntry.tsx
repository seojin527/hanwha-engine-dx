import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import InstrumentSelect from "../review/InstrumentSelect";
import { recommendedInstruments } from "../../lib/inspection/instruments";
import { formatNumber } from "../../lib/inspection/tolerance";
import { measurementStatusLabels } from "../../lib/measurementAPI";
import { RESULT_BOX, WorkFooter, saveErrorText } from "../work/WorkParts";
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
  /** 이전·다음 항목 (하단 고정 버튼). 합격 저장이 끝나면 다음 항목으로 넘어간다. */
  onNavigate?: (delta: number) => void;
  /** 입력 위에 보여줄 단계 기준·검사 기준 요약 */
  criteriaView?: ReactNode;
  /** 다른 업무 작업자의 조회 (잠금 문구 대신 '조회 전용' 표시) */
  readOnlyView?: boolean;
}

/**
 * 부품제작 단계 측정 입력.
 * - 측정 전 기준봉·기준 시편으로 측정기 0점을 확인해야 저장할 수 있다 (OPL: 0점 셋팅 미실시로 측정 오류).
 * - 실측값을 넣으면 목표와의 차이와 공구 보정량(직경·반경 지정)을 바로 보여준다 (가공표준서: 편차만큼 보정).
 * - 범위 안이면 [합격], 밖이면 [불합격]만 눌린다. 서버도 같은 기준으로 다시 판정한다.
 */
export default function StageEntry({
  stage, criteria, rawText, unit, defaultInstrument, featureType, gdtSymbols = [], record, locked,
  zeroChecked, onZeroChecked, save, onNavigate, criteriaView, readOnlyView = false,
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
      // 합격이면 다음 항목으로. 불합격은 결과를 보고 다시 재도록 이 항목에 남는다.
      if (result === "pass") onNavigate?.(1);
    } catch (cause: unknown) {
      if (mounted.current) setError(saveErrorText(cause));
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const current = dirty ? null : saved;
  const label = "block space-y-1 text-[11px] font-medium text-dx-muted";
  const canPass = zeroOk && (mode === "gauge" || inRange === true);
  const canFail = zeroOk && (mode === "gauge" || inRange === false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {locked && <p role="status" className="rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{locked}</p>}
        <fieldset disabled={saving || Boolean(locked)} className="space-y-3">
          {mode === "gauge" ? (
            <p className="rounded border border-dx-line bg-dx-raised/60 px-3 py-2 text-xs text-white">
              <span className="mr-1 text-dx-muted">판정 기준</span>
              {criteria.text}
            </p>
          ) : !hasRange ? (
            <p className="rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">판정 범위가 없어 관리자 확인이 필요합니다.</p>
          ) : null}

          <label
            className={`flex items-start gap-2 rounded border px-2.5 py-1.5 text-xs ${
              zeroOk ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-amber-400/50 bg-amber-400/10 text-amber-100"
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
              <b className="font-semibold">측정 전 0점 확인</b> — {instrument || "측정기"}
              {!zeroOk && <span className="block text-[11px] opacity-90">기준봉·기준 시편으로 0점을 맞춘 뒤 체크해야 기록할 수 있습니다 (같은 제품·단계·측정기는 한 번).</span>}
            </span>
          </label>

          {mode === "numeric" && (
            <>
              <label className={label}>
                <span className="flex items-baseline justify-between gap-2">
                  <span>실측값 ({unit})</span>
                  {hasRange && <span className="font-mono text-[12px] text-white">{criteria.role === "allowance" ? `${stageName} 목표` : "허용"} {formatNumber(low!)} ~ {formatNumber(high!)}</span>}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={value}
                  placeholder="측정한 값을 입력하세요"
                  autoComplete="off"
                  onChange={(event) => {
                    setValue(event.target.value);
                    changed();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (canPass) void submit("pass");
                  }}
                  className={`dx-input h-10 font-mono text-base ${
                    inRange === true ? "border-emerald-500 focus:border-emerald-400 focus:ring-emerald-400" : inRange === false ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400" : ""
                  }`}
                />
              </label>
              <p aria-live="polite" className="min-h-4 text-xs font-medium">
                {trimmed && numeric === null && <span className="text-rose-300">숫자로 입력해주세요.</span>}
                {inRange === true && <span className="text-emerald-300">범위 안 → 합격 가능</span>}
                {inRange === false && <span className="text-rose-300">범위 밖 → 측정 위치·측정기를 확인하세요</span>}
              </p>
              {correction !== null && Math.abs(correction) > EPS && (
                <p className="rounded bg-dx-raised px-2.5 py-1.5 font-mono text-[11px] text-dx-text">
                  목표 대비 {numeric! > center! ? "+" : "−"}{formatNumber(Math.abs(numeric! - center!))} {unit}
                  {" → 공구 보정 "}
                  {diameter
                    ? `직경 지정 ${correction > 0 ? "+" : "−"}${formatNumber(Math.abs(correction))} / 반경 지정 ${correction > 0 ? "+" : "−"}${formatNumber(Math.abs(correction) / 2)}`
                    : `${correction > 0 ? "+" : "−"}${formatNumber(Math.abs(correction))}`}
                </p>
              )}
            </>
          )}

          {criteriaView}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              사용 측정기
              <InstrumentSelect
                className="dx-input"
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
            <label className={label}>
              측정 메모
              <textarea
                className="dx-input"
                rows={1}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  changed();
                }}
              />
            </label>
          </div>

          {current ? (
            <div role="status" className={`space-y-0.5 rounded px-3 py-2 text-xs ${RESULT_BOX[current.status] ?? RESULT_BOX.pending}`}>
              <p className="font-semibold">
                저장된 판정: {current.judgement === "pass" ? "합격" : current.judgement === "fail" ? "불합격" : "판정 보류"}
                {" · "}
                {measurementStatusLabels[current.status]}
                {current.measured_value ? ` · ${current.measured_value} ${unit}` : ""}
              </p>
              <p>{current.judgement_reason}</p>
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
        {locked ? (
          <span className="flex-1 text-center text-xs text-amber-200">{readOnlyView ? "조회 전용" : `${stageName} 잠김 · 위 안내 참고`}</span>
        ) : (
          <>
            <button
              type="button"
              disabled={saving || !canPass}
              onClick={() => void submit("pass")}
              className="dx-btn dx-btn-lg flex-1 border-emerald-600 bg-emerald-600 text-white hover:border-emerald-500 hover:bg-emerald-500"
              title={!zeroOk ? "0점 확인을 먼저 체크해주세요" : mode === "numeric" ? "범위 안일 때만 누를 수 있습니다" : undefined}
            >
              {saving ? "저장 중…" : "합격 · 저장 후 다음"}
            </button>
            <button
              type="button"
              disabled={saving || !canFail}
              onClick={() => void submit("fail")}
              className="dx-btn dx-btn-lg border-rose-500/70 bg-transparent text-rose-300 hover:bg-rose-500/10"
              title={!zeroOk ? "0점 확인을 먼저 체크해주세요" : mode === "numeric" ? "범위 밖일 때만 누를 수 있습니다" : undefined}
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
