/**
 * 작업자 화면(부품제작·조립·검증) 공통 배치 조각.
 *
 * 왼쪽 작업 패널: [단계 줄(부품제작)] → 진행률·필터·측정 항목 목록 → 선택 항목의 기준·입력·판정 → 하단 고정 버튼
 * 오른쪽: 도면(크게) → 아래 접을 수 있는 보조 영역 (측정 전 주의사항 · 오류 사례)
 *
 * 저장 API·판정·단계 잠금은 각 입력 컴포넌트가 그대로 쓰고, 여기서는 보여주는 방식만 정한다.
 * 오류 사례는 실제로 값이 있는 필드만 사람이 읽는 문장으로 보여준다 (내부 필드명·원문 JSON 을 그대로 쓰지 않는다).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Lightbulb, Loader2, RotateCw } from "lucide-react";
import type { ErrorCandidate } from "../../lib/drawingAPI";
import type { OcrItem, OcrPoint } from "../../lib/ocr";
import { FEATURE_LABEL } from "../../lib/inspection/instruments";
import { formatDeviationPair, formatNumber } from "../../lib/inspection/tolerance";

// ==================================================================== 상태 (색 + 문구를 함께)
export type WorkStatus = "none" | "pending" | "completed" | "remeasure" | "review_required";

export interface WorkRecordLike {
  status: string;
  judgement?: string | null;
}

export function workStatusOf(record?: WorkRecordLike | null): WorkStatus {
  if (!record) return "none";
  if (record.status === "completed") return "completed";
  if (record.status === "remeasure" || record.judgement === "fail") return "remeasure";
  if (record.status === "review_required") return "review_required";
  return "pending";
}

export const WORK_STATUS: Record<WorkStatus, { label: string; dot: string; text: string }> = {
  none: { label: "미측정", dot: "bg-dx-faint", text: "text-dx-muted" },
  pending: { label: "확정 전", dot: "bg-sky-400", text: "text-sky-300" },
  completed: { label: "합격", dot: "bg-emerald-400", text: "text-emerald-300" },
  remeasure: { label: "불합격", dot: "bg-rose-400", text: "text-rose-300" },
  review_required: { label: "기준 확인", dot: "bg-amber-400", text: "text-amber-200" },
};

/** 저장된 판정 상자 색 (어두운 화면용) */
export const RESULT_BOX: Record<string, string> = {
  pending: "border border-sky-400/40 bg-sky-400/10 text-sky-100",
  completed: "border border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
  remeasure: "border border-rose-400/40 bg-rose-500/10 text-rose-100",
  review_required: "border border-amber-400/40 bg-amber-400/10 text-amber-100",
};

export function StatusPill({ status }: { status: WorkStatus }) {
  const style = WORK_STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium ${style.text}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

// ==================================================================== 측정 항목 목록 (진행률 · 필터)
type Filter = "all" | "todo" | "fail";

export function WorkItemList({
  points,
  selectedId,
  onSelect,
  statusOf,
  progressLabel,
  emptyText = "측정 항목이 없습니다.",
}: {
  points: OcrPoint[];
  selectedId: number;
  onSelect: (id: number) => void;
  statusOf: (point: OcrPoint) => WorkStatus;
  /** 진행률 줄 앞 문구 (예: "CR01 · 황삭 합격") */
  progressLabel: string;
  emptyText?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const list = useRef<HTMLUListElement>(null);
  const statuses = points.map((point) => statusOf(point));
  const done = statuses.filter((status) => status === "completed").length;
  const failed = statuses.filter((status) => status === "remeasure").length;
  const todo = points.length - done;
  const visible = points.filter((_, index) =>
    filter === "all" ? true : filter === "todo" ? statuses[index] !== "completed" : statuses[index] === "remeasure",
  );
  const percent = points.length ? Math.round((done / points.length) * 100) : 0;

  // 도면 번호를 눌러 바꿔도 목록에서 그 항목이 보이게 한다 (목록 안에서만 스크롤).
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId, filter]);

  return (
    <section aria-label="측정 항목" className="flex max-h-[32%] min-h-[120px] shrink-0 flex-col border-b border-dx-line [@media(max-height:720px)]:max-h-[26%]">
      <div className="shrink-0 space-y-1.5 px-3 pb-1.5 pt-2">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-dx-muted">{progressLabel}</span>
          <span className="shrink-0 tabular-nums">
            <b className="text-white">{done}</b>
            <span className="text-dx-muted"> / {points.length}</span>
            {failed > 0 && <span className="ml-2 text-rose-300">불합격 {failed}</span>}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-dx-raised" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={progressLabel}>
          <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <div role="group" aria-label="목록 필터" className="flex gap-1">
          {([
            ["all", `전체 ${points.length}`],
            ["todo", `미완료 ${todo}`],
            ["fail", `불합격 ${failed}`],
          ] as [Filter, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`h-6 rounded border px-2 text-[11px] ${filter === key ? "border-dx-accent bg-dx-accent/15 text-white" : "border-dx-line text-dx-muted hover:text-dx-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul ref={list} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {visible.length === 0 ? (
          <li className="px-2 py-3 text-xs text-dx-muted">{points.length ? "이 조건에 맞는 항목이 없습니다." : emptyText}</li>
        ) : (
          visible.map((point) => {
            const status = statusOf(point);
            const active = point.id === selectedId;
            return (
              <li key={point.id}>
                <button
                  type="button"
                  aria-current={active || undefined}
                  onClick={() => onSelect(point.id)}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs ${active ? "bg-dx-accent/15 shadow-[inset_2px_0_0_var(--color-dx-accent)]" : "hover:bg-white/5"}`}
                >
                  <span className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold ${active ? "bg-dx-accent text-dx-bg" : "bg-dx-raised text-dx-text"}`}>
                    {point.displayNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-dx-text">{point.source.raw_text.replace(/\n/g, "  ").replace(/\|/g, " ")}</span>
                    <span className="ml-1.5 text-[11px] text-dx-faint">{point.feature.name}</span>
                  </span>
                  <StatusPill status={status} />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

// ==================================================================== 선택 항목 머리글
export function WorkItemHeading({ point, title, status, extra }: { point: OcrPoint; title: string; status: WorkStatus; extra?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-dx-line px-3 py-2">
      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-dx-accent px-1.5 font-mono text-xs font-bold text-dx-bg">{point.displayNumber}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">{title}</p>
        <p className="truncate font-mono text-[11px] text-dx-muted">도면 표기 {point.source.raw_text.replace(/\n/g, "  ").replace(/\|/g, " ")}</p>
      </div>
      {extra}
      <StatusPill status={status} />
    </div>
  );
}

// ==================================================================== 검사 기준 요약
const BASIS_LABEL: Record<string, string> = {
  drawing: "도면 표기 공차",
  drawing_note: "도면 주석의 일반공차",
  project_default: "프로젝트 기본 기준 (도면 표기 아님)",
  admin: "관리자 지정",
};
const SOURCE_FALLBACK: Record<string, string> = {
  DRAWING: "도면 표기 공차",
  GENERAL: "일반공차 ISO 2768-m",
  SPECIAL: "관리자 지정 특별 공차",
};

/** 관리자가 확정한 검사 기준을 한눈에: 허용 범위(크게) · 기준·공차·근거 · 측정 방식·형상·측정기 */
export function CriteriaSummary({ item, title = "검사 기준" }: { item: OcrItem; title?: string }) {
  const approved = item.inspection_approved === true;
  const numeric = (item.measurement_mode ?? "numeric") === "numeric";
  const unit = item.unit || "mm";
  const hasRange = typeof item.lower_limit === "number" && typeof item.upper_limit === "number";
  if (!approved) {
    return (
      <div className="rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
        <p className="font-semibold">검사 기준 미지정</p>
        <p className="mt-0.5 text-amber-100/80">관리자가 이 항목의 기준을 아직 정하지 않아 자동 판정 없이 기록만 합니다.</p>
      </div>
    );
  }
  const basis =
    item.tolerance_source === "GENERAL"
      ? `일반공차 ISO 2768-m · ${BASIS_LABEL[item.tolerance_basis ?? ""] ?? "적용 근거 미기록"}`
      : item.tolerance_source
        ? SOURCE_FALLBACK[item.tolerance_source] ?? item.tolerance_source
        : "";
  return (
    <section aria-label={title} className="rounded border border-dx-line bg-dx-raised/60 px-3 py-2 text-xs">
      <p className="text-[11px] text-dx-muted">{title}</p>
      {numeric ? (
        <>
          <p className="mt-0.5 font-mono text-[15px] font-semibold text-white">
            {hasRange ? `${formatNumber(item.lower_limit as number)} ~ ${formatNumber(item.upper_limit as number)} ${unit}` : "허용 범위 없음"}
          </p>
          <p className="mt-0.5 text-dx-muted">
            {typeof item.nominal_value === "number" && <>기준 <span className="font-mono text-dx-text">{formatNumber(item.nominal_value)}</span></>}
            {typeof item.upper_deviation === "number" && typeof item.lower_deviation === "number" && (
              <> · 공차 <span className="font-mono text-dx-text">{formatDeviationPair(item.upper_deviation, item.lower_deviation)}</span></>
            )}
            {basis && <> · <span className={item.tolerance_basis === "project_default" ? "text-amber-200" : "text-dx-text"}>{basis}</span></>}
          </p>
        </>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-white">{item.gauge_criteria || "판정 기준 미지정"}</p>
      )}
      <p className="mt-1 text-[11px] text-dx-faint">
        {numeric ? "실측값 입력 · 자동 판정" : "합격·불합격 기록"} · {FEATURE_LABEL[item.feature_type ?? ""] ?? "형상 미지정"} · 측정기 {item.instrument || "미지정"}
      </p>
    </section>
  );
}

/** 저장 실패 문구: 네트워크 오류는 알아듣기 쉬운 말로, 서버가 보낸 이유는 그대로 */
export function saveErrorText(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  if (!message || /failed to fetch|networkerror|load failed/i.test(message)) {
    return "서버에 연결하지 못해 저장하지 않았습니다. 입력값은 그대로 있으니 연결을 확인한 뒤 다시 눌러주세요.";
  }
  return `저장하지 않았습니다: ${message}`;
}

// ==================================================================== 하단 고정 버튼 줄
export function WorkFooter({ error, children }: { error?: string; children: ReactNode }) {
  return (
    <footer className="shrink-0 space-y-1.5 border-t border-dx-line bg-dx-panel px-3 py-2">
      {error && (
        <p role="alert" className="flex items-start gap-1.5 rounded border border-rose-400/40 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </p>
      )}
      <div className="flex items-center gap-2">{children}</div>
    </footer>
  );
}

// ==================================================================== 오류 사례 조회 (검색 추천)
export function useCaseSearch(key: string, enabled: boolean, search: (signal: AbortSignal) => Promise<ErrorCandidate[]>) {
  const [state, setState] = useState<{ key: string; loading: boolean; errors: ErrorCandidate[]; error: string }>({ key: "", loading: true, errors: [], error: "" });
  const [retry, setRetry] = useState(0);
  const latest = useRef(search);
  latest.current = search;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ key, loading: true, errors: [], error: "" });
    latest.current(controller.signal)
      .then((errors) => !controller.signal.aborted && setState({ key, loading: false, errors, error: "" }))
      .catch((cause: unknown) => !controller.signal.aborted && setState({ key, loading: false, errors: [], error: cause instanceof Error ? cause.message : "검색 실패" }));
    return () => controller.abort();
  }, [key, enabled, retry]);
  return {
    loading: state.key !== key || state.loading,
    errors: state.key === key ? state.errors : [],
    error: state.key === key ? state.error : "",
    retry: () => setRetry((value) => value + 1),
  };
}

/** 사례 제목 앞의 [황삭]·[조립 전] 같은 공정 표시를 따로 뗀다. */
function splitTitle(title: string) {
  const match = /^\[([^\]]{1,12})\]\s*(.*)$/.exec(title.trim());
  return match ? { tag: match[1], text: match[2] } : { tag: "", text: title.trim() };
}

function originLabel(error: ErrorCandidate) {
  const origin = error.data_origin === "SYNTHETIC" ? "가상 테스트 사례" : error.data_origin === "USER_REPORTED" ? "작업자 등록 사례" : "등록 사례";
  const file = error.source_file && error.source_file !== "user_form" ? ` · ${error.source_file}` : "";
  return origin + file;
}

function Field({ label, children }: { label: string; children?: string | null }) {
  if (!children || !String(children).trim()) return null;
  return (
    <div className="grid grid-cols-[72px_1fr] gap-2">
      <dt className="text-dx-faint">{label}</dt>
      <dd className="whitespace-pre-wrap text-dx-text">{children}</dd>
    </div>
  );
}

/** 측정 전 주의사항 한 건: 제목 · 핵심 설명(주의사항) · 필요한 조치 → 펼치면 적용 기준·출처 */
function NoticeCard({ error }: { error: ErrorCandidate }) {
  const [open, setOpen] = useState(false);
  const title = splitTitle(error.case_title || "");
  return (
    <article className="rounded border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-xs">
      <header className="flex items-start gap-2">
        <Lightbulb aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="leading-snug text-white">{error.precaution}</p>
          <p className="mt-0.5 truncate text-[11px] text-dx-muted">
            {title.tag && <span className="mr-1 rounded bg-white/10 px-1 text-dx-text">{title.tag}</span>}
            관련 사례: {title.text || error.case_id}
          </p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="dx-btn dx-btn-ghost h-6 shrink-0 px-1.5 text-[11px]">
          {open ? "접기" : "자세히"}
        </button>
      </header>
      {open && (
        <dl className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[11px]">
          <Field label="필요한 조치">{error.corrective_action}</Field>
          <Field label="적용 기준">{error.applicable_condition}</Field>
          <Field label="제외 조건">{error.exclude_condition}</Field>
          <Field label="측정기 후보">{error.recommended_instrument}</Field>
          <Field label="출처">{originLabel(error)}</Field>
        </dl>
      )}
    </article>
  );
}

/** 검색 추천 사례 한 건: 제목 · 오류 내용 · 원인 · 조치 → 펼치면 영향·조건·측정기·출처 (값이 있는 필드만) */
function CaseCard({ error }: { error: ErrorCandidate }) {
  const [open, setOpen] = useState(false);
  const title = splitTitle(error.case_title || error.case_id);
  return (
    <article className="rounded border border-dx-line bg-dx-raised/50 px-3 py-2 text-xs">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug text-white">
            {title.tag && <span className="mr-1 rounded bg-white/10 px-1 text-[11px] font-normal text-dx-text">{title.tag}</span>}
            {title.text}
          </p>
          {error.error_description && <p className={`mt-1 leading-relaxed text-dx-text ${open ? "" : "line-clamp-2"}`}>{error.error_description}</p>}
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="dx-btn dx-btn-ghost h-6 shrink-0 px-1.5 text-[11px]">
          {open ? "접기" : "자세히"}
        </button>
      </header>
      <dl className="mt-1.5 space-y-1 text-[11px]">
        <Field label="원인">{error.cause}</Field>
        <Field label="조치">{error.corrective_action}</Field>
        {open && (
          <>
            <Field label="영향">{error.impact}</Field>
            <Field label="주의사항">{error.precaution}</Field>
            <Field label="측정기 후보">{error.recommended_instrument}</Field>
            <Field label="적용 조건">{error.applicable_condition}</Field>
            <Field label="제외 조건">{error.exclude_condition}</Field>
            <Field label="공정">{error.process_stage}</Field>
            <Field label="중요도">{error.severity}</Field>
            <Field label="출처">{originLabel(error)}</Field>
          </>
        )}
      </dl>
    </article>
  );
}

// ==================================================================== 오른쪽 아래 보조 영역 (탭 · 접기)
const ASSIST_KEY = "dx.work-assist-open";

export function WorkAssistPanel({
  search,
  linked,
  linkedCount,
  emptyNote,
}: {
  search: ReturnType<typeof useCaseSearch>;
  /** 이 항목에 연결된 사례 + 사례 등록 (PointErrorForm) */
  linked: ReactNode;
  linkedCount: number | null;
  /** 주의사항 탭 머리 안내 (예: 황삭 측정 전 확인) */
  emptyNote?: string;
}) {
  const [tab, setTab] = useState<"notices" | "cases">("notices");
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(ASSIST_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  function toggle() {
    setOpen((value) => {
      try {
        window.localStorage.setItem(ASSIST_KEY, value ? "closed" : "open");
      } catch {
        // 기억하지 못해도 이번 화면에서는 동작한다
      }
      return !value;
    });
  }
  const notices = search.errors.filter((error) => error.precaution && error.precaution.trim());
  const status = search.loading ? "…" : search.error ? "!" : null;
  return (
    <section aria-label="측정 보조 정보" className={`flex shrink-0 flex-col border-t border-dx-line bg-dx-panel text-dx-text ${open ? "h-[clamp(180px,34%,340px)]" : ""}`}>
      <div role="tablist" aria-label="보조 정보" className="flex h-9 shrink-0 items-center gap-1 border-b border-dx-line px-2">
        <button type="button" role="tab" aria-selected={tab === "notices"} onClick={() => { setTab("notices"); if (!open) toggle(); }} className="dx-tab">
          <Lightbulb aria-hidden="true" className="h-3.5 w-3.5" />
          측정 전 주의사항 <span className="tabular-nums text-dx-faint">{status ?? notices.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "cases"} onClick={() => { setTab("cases"); if (!open) toggle(); }} className="dx-tab">
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          오류 사례 <span className="tabular-nums text-dx-faint">연결 {linkedCount ?? "…"} · 추천 {status ?? search.errors.length}</span>
        </button>
        <button type="button" onClick={toggle} aria-expanded={open} className="dx-btn dx-btn-ghost ml-auto h-7 px-1.5" title={open ? "보조 영역 접기 (도면을 더 크게)" : "보조 영역 펼치기"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          {open ? "접기" : "펼치기"}
        </button>
      </div>
      {open && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "notices" ? (
            search.loading ? (
              <p role="status" className="flex items-center gap-1.5 text-xs text-dx-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />관련 주의사항을 찾는 중…</p>
            ) : search.error ? (
              <p role="alert" className="flex items-center gap-2 text-xs text-rose-300">
                {search.error}
                <button type="button" className="dx-btn h-6" onClick={search.retry}><RotateCw className="h-3 w-3" />다시 검색</button>
              </p>
            ) : notices.length === 0 ? (
              <p className="text-xs text-dx-muted">이 항목에 맞는 등록 주의사항이 없습니다. 안전하다는 뜻은 아니니 측정 기준을 그대로 따르세요.</p>
            ) : (
              <div className="space-y-2">
                {emptyNote && <p className="text-[11px] text-dx-muted">{emptyNote}</p>}
                {notices.map((error) => <NoticeCard key={error.case_id} error={error} />)}
                <p className="text-[11px] text-dx-faint">비슷한 측정 조건의 오류 사례에서 뽑은 주의사항입니다. 적용 조건이 이 항목과 맞는지 확인하세요.</p>
              </div>
            )
          ) : (
            <div className="space-y-4">
              {linked}
              <section aria-label="검색 추천 사례" className="space-y-2">
                <h3 className="text-xs font-semibold text-white">
                  검색 추천 사례 <span className="font-normal text-dx-muted">· 이 항목과 비슷한 조건으로 찾은 사례 (연결된 사례 아님)</span>
                </h3>
                {search.loading ? (
                  <p role="status" className="flex items-center gap-1.5 text-xs text-dx-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />검색 중…</p>
                ) : search.error ? (
                  <p role="alert" className="text-xs text-rose-300">{search.error}</p>
                ) : search.errors.length === 0 ? (
                  <p className="text-xs text-dx-muted">조건에 맞는 등록 사례가 없습니다.</p>
                ) : (
                  search.errors.map((error) => <CaseCard key={error.case_id} error={error} />)
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
