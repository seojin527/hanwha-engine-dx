/**
 * 휴대폰 작업 화면: '현재 항목 하나' 중심.
 *   상단 바(업무·부품, 진행) → 모드·다음 행동 → 도면(선택 항목 강조) → 항목 기준 → 입력 → 관련 오류사례
 *   하단 고정: 이전 · [저장 후 다음 | 체험값 적용 후 다음] · 다음
 * 저장: 성공해야 다음 항목으로 이동하고, 실패하면 입력과 위치를 그대로 둔다.
 * 체험(관람객 주소): 서버로 보내지 않고 이 화면의 메모리에만 둔다.
 * 조회 전용(다른 업무의 실제 작업자): 저장된 결과만 보여준다 (기존 규칙).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, FileDown, List, Lock } from "lucide-react";
import { MobileDrawingView, type MarkerTone } from "./MobileDrawingView";
import { MobileOverlay, MobileTopBar, MenuButton, ModeBadge, type WorkMode } from "./ui";
import { ROLE_GUIDE } from "../../lib/roleGuide";
import type { WorkPurpose } from "../../lib/purpose";
import type { OcrDocument, OcrPoint } from "../../lib/ocr";
import { toleranceText } from "../../lib/ocr";
import { fetchItemErrors, type Drawing, type ErrorCandidate } from "../../lib/drawingAPI";
import { saveMeasurement, type MeasurementRecord, type SavedMeasurement } from "../../lib/measurementAPI";
import {
  STAGE_KEYS,
  STAGE_NAME,
  fetchStageErrors,
  saveStageRecord,
  useMachining,
  type StageCriteria,
  type StageKey,
} from "../../lib/machiningAPI";
import { formatNumber } from "../../lib/inspection/tolerance";

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const EPS = 1e-9;

export type TrialResult = "pass" | "fail" | "review";
export interface TrialEntry {
  value: string;
  result: TrialResult;
  instrument: string;
}
export type TrialStore = Record<string, TrialEntry>;

export interface TaskProps {
  purpose: WorkPurpose;
  mode: WorkMode;
  /** 조회 전용일 때 이유 (예: 조립 작업자는 부품제작을 조회만) */
  viewReason?: string;
  partName: string;
  drawing: Drawing;
  document: OcrDocument;
  revision: string;
  resultUrl: string | null;
  points: OcrPoint[];
  activePoint?: OcrPoint;
  onSelectPoint: (id: number) => void;
  measurementRecords: Record<string, MeasurementRecord>;
  onMeasurementSaved: (record: SavedMeasurement) => void;
  trial: TrialStore;
  onTrial: (key: string, entry: TrialEntry) => void;
  onBack: () => void;
  onExports: () => void;
}

/** 실측값 → 판정. 범위가 있으면 자동 판정, 없으면 판정 보류. */
function judge(value: string, low: number | null, high: number | null): TrialResult | null {
  const text = value.trim();
  if (!NUMBER_RE.test(text)) return null;
  if (low === null || high === null) return "review";
  const number = Number(text);
  return number >= low - EPS && number <= high + EPS ? "pass" : "fail";
}

const RESULT_TEXT: Record<TrialResult, string> = { pass: "합격", fail: "불합격", review: "판정 보류 (기준 범위 없음)" };
const RESULT_STYLE: Record<TrialResult, string> = {
  pass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  fail: "bg-red-100 text-red-900 border-red-300",
  review: "bg-amber-100 text-amber-900 border-amber-300",
};

// ====================================================================== 공통 틀

function TaskFrame({
  title,
  subtitle,
  mode,
  doNow,
  strip,
  drawing,
  children,
  footer,
  onBack,
  onList,
  onExports,
}: {
  title: string;
  subtitle: string;
  mode: WorkMode;
  doNow: string;
  strip?: ReactNode;
  drawing: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onBack: () => void;
  onList: () => void;
  onExports: () => void;
}) {
  // 입력칸에 커서가 있으면(가상 키보드) 도면을 접어 입력과 버튼이 보이게 한다.
  const [editing, setEditing] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);
  // 키보드는 커서가 들어간 뒤에 올라와 화면이 줄어든다. 줄어들 때마다 입력칸을 다시 가운데로.
  useEffect(() => {
    if (!editing) return;
    const keepVisible = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.matches("input, textarea")) active.scrollIntoView({ block: "center" });
    };
    const viewport = window.visualViewport;
    window.addEventListener("resize", keepVisible);
    viewport?.addEventListener("resize", keepVisible);
    return () => {
      window.removeEventListener("resize", keepVisible);
      viewport?.removeEventListener("resize", keepVisible);
    };
  }, [editing]);
  return (
    <div className="fixed inset-0 flex flex-col bg-dx-bg">
      <MobileTopBar
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        backLabel="도면으로"
        right={
          <>
            <MenuButton label="항목 목록" onClick={onList} icon={<List aria-hidden="true" className="h-5 w-5" />} />
            <MenuButton label="기록 및 내보내기" onClick={onExports} icon={<FileDown aria-hidden="true" className="h-5 w-5" />} />
          </>
        }
      />
      {/* 세로: 도면 → 모드·안내 → 항목 내용 → 하단 버튼. 가로(높이 500px 이하): 왼쪽 도면, 오른쪽 나머지 */}
      <div className="flex min-h-0 flex-1 flex-col [@media(max-height:500px)]:flex-row">
        <div
          className={editing ? "hidden" : "relative h-[34dvh] min-h-[150px] max-h-[380px] shrink-0 border-b border-dx-line [@media(max-height:500px)]:h-auto [@media(max-height:500px)]:max-h-none [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:flex-1 [@media(max-height:500px)]:border-b-0 [@media(max-height:500px)]:border-r"}
        >
          {!editing && drawing}
        </div>
        <div className={`flex min-h-0 flex-1 flex-col ${editing ? "" : "[@media(max-height:500px)]:w-[52%] [@media(max-height:500px)]:flex-none"}`}>
          <div className="shrink-0 space-y-1.5 border-b border-dx-line bg-dx-panel px-3 py-2">
            <div className="flex items-center gap-2">
              <ModeBadge mode={mode} />
              <p className="min-w-0 flex-1 truncate text-[12px] text-dx-text">{doNow}</p>
            </div>
            {strip}
          </div>
          {editing && (
            <p className="shrink-0 bg-dx-panel px-3 py-1 text-center text-[11px] text-dx-muted">입력 중에는 도면을 잠시 접습니다</p>
          )}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 text-slate-900"
            onFocus={(event) => {
              if ((event.target as HTMLElement).matches("input, textarea")) {
                window.clearTimeout(blurTimer.current);
                setEditing(true);
                const target = event.target as HTMLElement;
                window.setTimeout(() => target.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
              }
            }}
            onBlur={() => {
              blurTimer.current = window.setTimeout(() => setEditing(false), 120);
            }}
          >
            <div className="space-y-3 p-3">{children}</div>
          </div>
          <div className="shrink-0 border-t border-dx-line bg-dx-panel px-3 pt-2" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

function Footer({
  onPrev,
  onNext,
  primary,
  message,
}: {
  onPrev: () => void;
  onNext: () => void;
  primary?: { label: string; disabled: boolean; busy: boolean; onClick: () => void };
  message?: { tone: "error" | "info"; text: string } | null;
}) {
  return (
    <>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mb-2 text-[12px] leading-snug ${message.tone === "error" ? "text-rose-300" : "text-cyan-200"}`}>
          {message.text}
        </p>
      )}
      <div className="flex items-stretch gap-2">
        <button type="button" onClick={onPrev} aria-label="이전 항목" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dx-line-strong text-white active:bg-white/10">
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </button>
        {primary ? (
          <button
            type="button"
            disabled={primary.disabled || primary.busy}
            onClick={primary.onClick}
            className="h-12 min-w-0 flex-1 rounded-lg bg-[#22c3dc] px-3 text-[15px] font-semibold text-[#04212b] disabled:bg-[#22c3dc]/30 disabled:text-[#04212b]/60"
          >
            {primary.busy ? "저장 중…" : primary.label}
          </button>
        ) : (
          <span className="flex h-12 min-w-0 flex-1 items-center justify-center rounded-lg border border-dx-line text-[13px] text-dx-muted">조회 전용</span>
        )}
        <button type="button" onClick={onNext} aria-label="다음 항목" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dx-line-strong text-white active:bg-white/10">
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
    </>
  );
}

function ItemCard({ point, title, criteria, extra }: { point: OcrPoint; title: string; criteria: ReactNode; extra?: ReactNode }) {
  const item = point.source;
  return (
    <section aria-label="현재 항목" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-slate-900 px-1.5 font-mono text-[15px] font-bold text-white">{point.displayNumber}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug text-slate-900">{title}</h2>
          <p className="mt-0.5 break-all font-mono text-[14px] text-slate-700">도면 표기 {item.raw_text.replace(/\n/g, " ")}</p>
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-[14px] leading-relaxed text-slate-800">{criteria}</div>
      {extra}
    </section>
  );
}

function ResultChip({ result, label }: { result: TrialResult; label?: string }) {
  return (
    <p className={`rounded-lg border px-3 py-2 text-[14px] font-semibold ${RESULT_STYLE[result]}`}>
      {label ? `${label} · ` : ""}
      {RESULT_TEXT[result]}
    </p>
  );
}

function Cautions({ label, errors, loading, error }: { label: string; errors: ErrorCandidate[]; loading: boolean; error: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-3 text-left">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-700" />
        <span className="min-w-0 flex-1 text-[14px] font-semibold text-amber-950">측정 전 확인 · {label}</span>
        <span className="shrink-0 text-[13px] text-amber-900">{loading ? "검색 중" : error ? "조회 실패" : `${errors.length}건`}</span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-amber-800 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="divide-y divide-amber-200 border-t border-amber-200">
          {error ? (
            <p className="p-3 text-[13px] text-rose-700">{error}</p>
          ) : !errors.length ? (
            <p className="p-3 text-[13px] text-slate-700">조건에 맞는 등록 사례가 없습니다. 안전함을 의미하지는 않습니다.</p>
          ) : (
            errors.map((entry) => (
              <article key={entry.case_id} className="space-y-1 p-3 text-[13px] leading-relaxed">
                <h3 className="font-semibold text-slate-900">{entry.case_title || entry.case_id}</h3>
                <p className="text-slate-800">{entry.error_description}</p>
                {entry.precaution && <p className="text-emerald-900"><b>주의</b> {entry.precaution}</p>}
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function useErrors(loader: ((signal: AbortSignal) => Promise<ErrorCandidate[]>) | null, key: string) {
  const [state, setState] = useState<{ key: string; errors: ErrorCandidate[]; loading: boolean; error: string }>({ key: "", errors: [], loading: true, error: "" });
  useEffect(() => {
    if (!loader) return;
    const controller = new AbortController();
    setState({ key, errors: [], loading: true, error: "" });
    loader(controller.signal)
      .then((errors) => !controller.signal.aborted && setState({ key, errors, loading: false, error: "" }))
      .catch((cause) => !controller.signal.aborted && setState({ key, errors: [], loading: false, error: cause instanceof Error ? cause.message : "검색 실패" }));
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state : { errors: [], loading: true, error: "" };
}

function ItemList({
  title,
  points,
  activeId,
  statusOf,
  onPick,
  onClose,
}: {
  title: string;
  points: OcrPoint[];
  activeId?: number;
  statusOf: (point: OcrPoint) => { text: string; tone: MarkerTone };
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const dot: Record<MarkerTone, string> = { todo: "bg-cyan-600", stage: "bg-orange-500", done: "bg-emerald-600", fail: "bg-red-600", muted: "bg-slate-400" };
  return (
    <MobileOverlay title={title} onClose={onClose}>
      <ul className="divide-y divide-dx-line">
        {points.map((point) => {
          const status = statusOf(point);
          return (
            <li key={point.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(point.id);
                  onClose();
                }}
                aria-current={point.id === activeId}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left ${point.id === activeId ? "bg-dx-accent/10" : "active:bg-white/5"}`}
              >
                <span className="w-8 shrink-0 text-right font-mono text-[15px] font-semibold text-white">{point.displayNumber}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-white">{point.feature.name}</span>
                  <span className="block truncate font-mono text-[13px] text-dx-muted">{point.source.raw_text.replace(/\n/g, " ")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-dx-text">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dot[status.tone]}`} />
                  {status.text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </MobileOverlay>
  );
}

/** 목록 안에서 앞뒤 이동 (끝에서 처음으로 돌아가지 않는다) */
function step(list: OcrPoint[], activeId: number | undefined, delta: number) {
  if (!list.length) return undefined;
  const index = list.findIndex((point) => point.id === activeId);
  if (index < 0) return list[0];
  const next = index + delta;
  return next >= 0 && next < list.length ? list[next] : undefined;
}

// ====================================================================== 조립 · 검증

export function MeasureTask(props: TaskProps) {
  const { purpose, mode, document, drawing, revision, points, activePoint, onSelectPoint, measurementRecords, trial, onTrial } = props;
  const guide = ROLE_GUIDE[purpose];
  const point = activePoint ?? points[0];
  const item = point?.source;
  const trialKey = (id: string) => `${drawing.drawing_id}:${revision}:${purpose}:${id}`;
  const [listOpen, setListOpen] = useState(false);
  const [value, setValue] = useState("");
  const [instrument, setInstrument] = useState("");
  const [gauge, setGauge] = useState<"pass" | "fail" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const saved = item ? measurementRecords[item.id] : undefined;
  const tried = item ? trial[trialKey(item.id)] : undefined;

  // 항목이 바뀌면 그 항목의 저장값(또는 체험값)으로 입력을 채운다.
  useEffect(() => {
    if (!item) return;
    setValue(tried?.value ?? saved?.measured_value ?? "");
    setInstrument(tried?.instrument ?? saved?.instrument ?? item.instrument ?? "");
    setGauge(saved?.gauge_result ?? null);
    setMessage(null);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useErrors(
    item ? (signal) => fetchItemErrors(purpose, drawing.drawing_id, item.id, signal).then((r) => r.errors) : null,
    `${purpose}:${drawing.drawing_id}:${item?.id}`,
  );

  if (!point || !item) return null;
  const gaugeMode = item.measurement_mode === "gauge";
  const approved = item.inspection_approved === true;
  const low = approved && typeof item.lower_limit === "number" ? item.lower_limit : null;
  const high = approved && typeof item.upper_limit === "number" ? item.upper_limit : null;
  const result: TrialResult | null = gaugeMode ? gauge : judge(value, low, high);
  const statusOf = (p: OcrPoint): { text: string; tone: MarkerTone } => {
    const t = trial[trialKey(p.source.id)];
    const r = measurementRecords[p.source.id];
    if (t) return t.result === "fail" ? { text: "체험 불합격", tone: "fail" } : { text: t.result === "pass" ? "체험 합격" : "체험 보류", tone: "done" };
    if (r) return r.judgement === "fail" ? { text: "불합격", tone: "fail" } : { text: r.judgement === "pass" ? "합격" : "보류", tone: "done" };
    return { text: "대기", tone: "todo" };
  };
  const done = points.filter((p) => statusOf(p).tone !== "todo").length;
  const go = (delta: number) => {
    const next = step(points, point.id, delta);
    if (next) onSelectPoint(next.id);
    else setMessage({ tone: "info", text: delta > 0 ? "마지막 항목입니다. 목록에서 남은 항목을 확인하세요." : "첫 항목입니다." });
  };

  async function submit() {
    if (!result || !item) return;
    setMessage(null);
    if (mode === "trial") {
      onTrial(trialKey(item.id), { value: gaugeMode ? "" : value.trim(), result, instrument: instrument.trim() });
      go(1);
      return;
    }
    setBusy(true);
    try {
      const record = await saveMeasurement(purpose, drawing.drawing_id, item.id, {
        revision,
        measurement_mode: gaugeMode ? "gauge" : "numeric",
        measured_value: gaugeMode ? "" : value.trim(),
        gauge_result: gaugeMode ? gauge : null,
        confirmed: result === "pass",
        instrument: instrument.trim(),
        note: "",
      });
      props.onMeasurementSaved(record);
      go(1);
    } catch (cause) {
      // 실패하면 입력값과 현재 항목을 그대로 둔다.
      setMessage({ tone: "error", text: `저장하지 못했습니다: ${cause instanceof Error ? cause.message : "알 수 없는 오류"}. 입력은 그대로입니다.` });
    } finally {
      setBusy(false);
    }
  }

  const criteria = (
    <>
      <p>
        <b className="font-semibold">허용 범위</b> {toleranceText(item)}
      </p>
      {!approved && <p className="text-[13px] text-amber-800">관리자가 검사 기준을 확정하지 않은 항목이라 판정 보류로 기록됩니다.</p>}
      {gaugeMode && item.gauge_criteria && <p className="mt-1 whitespace-pre-wrap text-[13px]"><b>판정 기준</b> {item.gauge_criteria}</p>}
    </>
  );

  return (
    <>
      <TaskFrame
        title={`${guide.title} · ${props.partName}`}
        subtitle={`${point.displayNumber}번 · 진행 ${done}/${points.length}`}
        mode={mode}
        doNow={mode === "view" ? props.viewReason ?? "저장된 결과만 볼 수 있습니다" : guide.doNow}
        onBack={props.onBack}
        onList={() => setListOpen(true)}
        onExports={props.onExports}
        drawing={
          <MobileDrawingView
            className="h-full"
            url={props.resultUrl}
            coordinateSize={{ width: document.image.width_px, height: document.image.height_px }}
            points={points}
            selectedId={point.id}
            onSelect={onSelectPoint}
            toneOf={(p) => statusOf(p).tone}
            focusOnStart
          />
        }
        footer={
          <Footer
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            message={message}
            primary={
              mode === "view"
                ? undefined
                : { label: mode === "trial" ? "체험값 적용 후 다음" : "저장 후 다음", disabled: !result, busy, onClick: () => void submit() }
            }
          />
        }
      >
        <ItemCard point={point} title={point.feature.name} criteria={criteria} />

        {mode === "view" ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3 text-[14px]">
            <h3 className="font-semibold text-slate-900">저장된 {guide.title} 결과</h3>
            {saved ? (
              <p className="mt-1 text-slate-800">
                {saved.measured_value ? `${saved.measured_value} ${item.unit || "mm"} · ` : ""}
                {saved.judgement === "pass" ? "합격" : saved.judgement === "fail" ? "불합격" : "판정 보류"}
                {saved.instrument ? ` · ${saved.instrument}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-slate-600">아직 기록이 없습니다.</p>
            )}
          </section>
        ) : (
          <section aria-label="측정 입력" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
            {gaugeMode ? (
              <div className="grid grid-cols-2 gap-2">
                {(["pass", "fail"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={gauge === key}
                    onClick={() => setGauge(key)}
                    className={`h-12 rounded-lg border text-[15px] font-semibold ${gauge === key ? (key === "pass" ? "border-emerald-600 bg-emerald-600 text-white" : "border-red-600 bg-red-600 text-white") : "border-slate-300 bg-white text-slate-800"}`}
                  >
                    {key === "pass" ? "합격" : "불합격"}
                  </button>
                ))}
              </div>
            ) : (
              <label className="block">
                <span className="text-[13px] font-medium text-slate-700">실측값 ({item.unit || "mm"})</span>
                <input
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={typeof item.nominal_value === "number" ? `예: ${formatNumber(item.nominal_value)}` : "숫자"}
                  className="mt-1 h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-[18px] text-slate-900 focus:border-cyan-600 focus:outline-none"
                />
              </label>
            )}
            <label className="block">
              <span className="text-[13px] font-medium text-slate-700">측정기</span>
              <input
                value={instrument}
                onChange={(event) => setInstrument(event.target.value)}
                placeholder="예: 외경 마이크로미터"
                className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-slate-900 focus:border-cyan-600 focus:outline-none"
              />
            </label>
            {result && <ResultChip result={result} label={mode === "trial" ? "체험 판정" : "예상 판정"} />}
            {mode === "trial" && tried && <p className="text-[12px] text-amber-800">이 항목에 적용한 체험값: {tried.value || "-"} · {RESULT_TEXT[tried.result]} (서버에 저장되지 않음)</p>}
            {mode === "save" && saved && <p className="text-[12px] text-slate-600">서버 저장값: {saved.measured_value || "-"} · {saved.judgement === "pass" ? "합격" : saved.judgement === "fail" ? "불합격" : "판정 보류"}</p>}
          </section>
        )}

        <Cautions label={guide.caution} {...errors} />
      </TaskFrame>
      {listOpen && <ItemList title={`${guide.title} 항목 ${points.length}개`} points={points} activeId={point.id} statusOf={statusOf} onPick={onSelectPoint} onClose={() => setListOpen(false)} />}
    </>
  );
}

// ====================================================================== 부품제작

export function ManufacturingTask(props: TaskProps) {
  const { mode, document, drawing, revision, points, activePoint, onSelectPoint, trial, onTrial } = props;
  const guide = ROLE_GUIDE.manufacturing;
  const machining = useMachining(drawing.drawing_id, revision);
  const { plan, stage } = machining;
  const trialKey = (id: string, s: StageKey = stage) => `${drawing.drawing_id}:${revision}:manufacturing:${machining.serial}:${s}:${id}`;

  // 단계별 잴 항목과 잠금. 서버(machining_api.stage_status)와 같은 규칙: 앞의 모든 단계가 전부 합격해야 열린다
  // (잴 항목이 없는 단계는 완료로 본다). 체험 모드에서는 체험 합격도 합격으로 센다.
  const stageItems = (s: StageKey) => new Set(plan?.items.filter((entry) => entry.stages[s]).map((entry) => entry.item_id) ?? []);
  const passedIn = (s: StageKey, id: string) =>
    plan?.records.some((r) => r.stage === s && r.item_id === id && r.status === "completed") || trial[trialKey(id, s)]?.result === "pass";
  const stageState = (s: StageKey) => {
    const ids = [...stageItems(s)];
    const passed = ids.filter((id) => passedIn(s, id)).length;
    const before = STAGE_KEYS.slice(0, STAGE_KEYS.indexOf(s));
    const trialUnlocked = before.every((p) => [...stageItems(p)].every((id) => passedIn(p, id)));
    return { required: ids.length, passed, unlocked: mode === "trial" ? trialUnlocked : plan?.status[s]?.unlocked ?? false };
  };

  const ids = stageItems(stage);
  const list = useMemo(() => points.filter((point) => ids.has(point.source.id)), [points, plan, stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const point = activePoint && ids.has(activePoint.source.id) ? activePoint : list[0];
  const item = point?.source;
  const criteria: StageCriteria | null = item ? machining.itemPlan(item.id)?.stages[stage] ?? null : null;

  // 단계를 바꾸면 그 단계의 첫 항목으로
  useEffect(() => {
    if (list.length && !(activePoint && ids.has(activePoint.source.id))) onSelectPoint(list[0].id);
  }, [stage, plan?.revision, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [listOpen, setListOpen] = useState(false);
  const [value, setValue] = useState("");
  const [instrument, setInstrument] = useState("");
  const [gauge, setGauge] = useState<"pass" | "fail" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const saved = item ? machining.stageRecords[item.id] : undefined;
  const tried = item ? trial[trialKey(item.id)] : undefined;

  useEffect(() => {
    if (!item) return;
    setValue(tried?.value ?? saved?.measured_value ?? "");
    setInstrument(tried?.instrument ?? saved?.instrument ?? item.instrument ?? "");
    setGauge(saved?.gauge_result ?? null);
    setMessage(null);
  }, [item?.id, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useErrors(
    item ? (signal) => fetchStageErrors(drawing.drawing_id, item.id, stage, signal).then((r) => r.errors) : null,
    `mfg:${drawing.drawing_id}:${item?.id}:${stage}`,
  );

  const current = stageState(stage);
  const locked = !current.unlocked;
  const zeroOk = instrument.trim() !== "" && machining.zeroChecked(instrument);
  const gaugeMode = criteria?.mode === "gauge";
  const result: TrialResult | null = !criteria ? null : gaugeMode ? gauge : judge(value, criteria.lower_limit, criteria.upper_limit);

  const statusOf = (p: OcrPoint): { text: string; tone: MarkerTone } => {
    if (!ids.has(p.source.id)) return { text: "다른 단계", tone: "muted" };
    const t = trial[trialKey(p.source.id)];
    const r = machining.stageRecords[p.source.id];
    const judgement = t?.result ?? r?.judgement;
    if (judgement === "fail") return { text: t ? "체험 불합격" : "불합격", tone: "fail" };
    if (judgement) return { text: t ? "체험 합격" : "합격", tone: "done" };
    return { text: "측정 대상", tone: "stage" };
  };
  const go = (delta: number) => {
    const next = step(list, point?.id, delta);
    if (next) onSelectPoint(next.id);
    else setMessage({ tone: "info", text: delta > 0 ? `${STAGE_NAME[stage]} 마지막 항목입니다. 목록에서 남은 항목을 확인하세요.` : "첫 항목입니다." });
  };

  async function submit() {
    if (!item || !result || locked) return;
    setMessage(null);
    if (!zeroOk) {
      setMessage({ tone: "error", text: "측정 전에 측정기 0점 확인에 체크해주세요." });
      return;
    }
    if (mode === "trial") {
      onTrial(trialKey(item.id), { value: gaugeMode ? "" : value.trim(), result, instrument: instrument.trim() });
      go(1);
      return;
    }
    setBusy(true);
    try {
      await saveStageRecord(drawing.drawing_id, item.id, {
        measured_value: gaugeMode ? "" : value.trim(),
        gauge_result: gaugeMode ? gauge : null,
        confirmed: result === "pass",
        zero_checked: true,
        instrument: instrument.trim(),
        note: "",
        revision,
        serial: machining.serial,
        stage,
      });
      machining.refresh();
      go(1);
    } catch (cause) {
      setMessage({ tone: "error", text: `저장하지 못했습니다: ${cause instanceof Error ? cause.message : "알 수 없는 오류"}. 입력은 그대로입니다.` });
    } finally {
      setBusy(false);
    }
  }

  const strip = plan ? (
    <div role="group" aria-label="가공 단계" className="grid grid-cols-3 gap-1">
      {STAGE_KEYS.map((key) => {
        const s = stageState(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={stage === key}
            disabled={!s.unlocked}
            onClick={() => machining.setStage(key)}
            className={`flex h-9 items-center justify-center gap-1 rounded-md border text-[13px] ${stage === key ? "border-dx-accent bg-dx-accent/15 font-semibold text-white" : "border-dx-line text-dx-text"} disabled:opacity-45`}
          >
            {!s.unlocked && <Lock aria-hidden="true" className="h-3 w-3" />}
            {STAGE_NAME[key]}
            <span className="font-mono text-[11px] text-dx-muted">{s.passed}/{s.required}</span>
          </button>
        );
      })}
    </div>
  ) : (
    <p className="text-[12px] text-dx-muted">{machining.error ? `가공 단계 조회 실패: ${machining.error}` : "가공 단계 불러오는 중…"}</p>
  );

  return (
    <>
      <TaskFrame
        title={`${guide.title} · ${props.partName}`}
        subtitle={`제품 ${machining.serial || "-"} · ${STAGE_NAME[stage]} ${point ? `${list.indexOf(point) + 1}/${list.length}` : ""}`}
        mode={mode}
        doNow={mode === "view" ? props.viewReason ?? "저장된 결과만 볼 수 있습니다" : locked ? "앞 단계가 모두 합격해야 이 단계를 기록할 수 있습니다" : guide.doNow}
        strip={strip}
        onBack={props.onBack}
        onList={() => setListOpen(true)}
        onExports={props.onExports}
        drawing={
          <MobileDrawingView
            className="h-full"
            url={props.resultUrl}
            coordinateSize={{ width: document.image.width_px, height: document.image.height_px }}
            points={points}
            selectedId={point?.id}
            onSelect={(id) => {
              const target = points.find((p) => p.id === id);
              if (target && ids.has(target.source.id)) onSelectPoint(id);
              else setMessage({ tone: "info", text: `${id}번은 ${STAGE_NAME[stage]} 측정 대상이 아닙니다.` });
            }}
            toneOf={(p) => statusOf(p).tone}
            focusOnStart
          />
        }
        footer={
          <Footer
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            message={message}
            primary={
              mode === "view" || !point
                ? undefined
                : { label: mode === "trial" ? "체험값 적용 후 다음" : "저장 후 다음", disabled: !result || locked, busy, onClick: () => void submit() }
            }
          />
        }
      >
        {!point || !item ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-[14px] text-slate-700">{plan ? "이 단계에서 잴 항목이 없습니다." : "가공 단계를 불러오는 중입니다."}</p>
        ) : (
          <>
            <ItemCard
              point={point}
              title={machining.itemPlan(item.id)?.label || point.feature.name}
              criteria={
                criteria ? (
                  <>
                    <p>
                      <b className="font-semibold">{STAGE_NAME[stage]} 기준</b> {criteria.text}
                    </p>
                    {criteria.lower_limit !== null && criteria.upper_limit !== null && (
                      <p className="font-mono text-[14px]">
                        {formatNumber(criteria.lower_limit)} ~ {formatNumber(criteria.upper_limit)} {item.unit || "mm"}
                      </p>
                    )}
                    <p className="mt-1 text-[12px] text-slate-600">최종 도면 공차: {toleranceText(item)}</p>
                  </>
                ) : (
                  <p>이 항목은 {STAGE_NAME[stage]} 측정 대상이 아닙니다.</p>
                )
              }
            />
            {mode === "view" ? (
              <section className="rounded-xl border border-slate-200 bg-white p-3 text-[14px]">
                <h3 className="font-semibold text-slate-900">저장된 {STAGE_NAME[stage]} 결과</h3>
                <p className="mt-1 text-slate-800">
                  {saved ? `${saved.measured_value || "-"} · ${saved.judgement === "pass" ? "합격" : saved.judgement === "fail" ? "불합격" : "판정 보류"}` : "아직 기록이 없습니다."}
                </p>
              </section>
            ) : (
              <section aria-label="측정 입력" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                {locked && <p className="rounded-lg bg-amber-100 px-3 py-2 text-[13px] text-amber-900">앞 단계 측정이 모두 합격해야 {STAGE_NAME[stage]}을 기록할 수 있습니다.</p>}
                <label className="block">
                  <span className="text-[13px] font-medium text-slate-700">측정기</span>
                  <input
                    value={instrument}
                    onChange={(event) => setInstrument(event.target.value)}
                    placeholder="예: 외경 마이크로미터"
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-slate-900 focus:border-cyan-600 focus:outline-none"
                  />
                </label>
                <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[13px] leading-snug text-slate-800">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0"
                    disabled={!instrument.trim()}
                    checked={zeroOk}
                    onChange={(event) => machining.markZeroChecked(instrument, event.target.checked)}
                  />
                  <span><b>측정 전 0점 확인</b> — 기준봉·기준 시편으로 {instrument.trim() || "측정기"} 0점을 맞췄습니다.</span>
                </label>
                {gaugeMode ? (
                  <div className="grid grid-cols-2 gap-2">
                    {(["pass", "fail"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={gauge === key}
                        onClick={() => setGauge(key)}
                        className={`h-12 rounded-lg border text-[15px] font-semibold ${gauge === key ? (key === "pass" ? "border-emerald-600 bg-emerald-600 text-white" : "border-red-600 bg-red-600 text-white") : "border-slate-300 bg-white text-slate-800"}`}
                      >
                        {key === "pass" ? "합격" : "불합격"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <label className="block">
                    <span className="text-[13px] font-medium text-slate-700">실측값 ({item.unit || "mm"})</span>
                    <input
                      inputMode="decimal"
                      enterKeyHint="done"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={criteria?.target !== null && criteria?.target !== undefined ? `목표 ${formatNumber(criteria.target)}` : "숫자"}
                      className="mt-1 h-12 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-[18px] text-slate-900 focus:border-cyan-600 focus:outline-none"
                    />
                  </label>
                )}
                {result && <ResultChip result={result} label={mode === "trial" ? "체험 판정" : "예상 판정"} />}
                {mode === "trial" && tried && <p className="text-[12px] text-amber-800">적용한 체험값: {tried.value || "-"} · {RESULT_TEXT[tried.result]} (서버에 저장되지 않음)</p>}
              </section>
            )}
            <Cautions label={guide.caution} {...errors} />
          </>
        )}
      </TaskFrame>
      {listOpen && (
        <ItemList
          title={`${STAGE_NAME[stage]} 항목 ${list.length}개`}
          points={list}
          activeId={point?.id}
          statusOf={statusOf}
          onPick={onSelectPoint}
          onClose={() => setListOpen(false)}
        />
      )}
    </>
  );
}

