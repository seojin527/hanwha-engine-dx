/**
 * 관리자 「작업 진행 현황」: 선택한 부품·도면 한 대상의 제작 → 조립 → 검증 현황판 (조회 전용).
 *
 * - 제작: 제품 번호(시리얼)별 황삭·중삭·정삭 기록 (machining_stage_records)
 * - 조립·검증: 각 목적의 항목별 최신 측정 기록 (measurement_records, 제품 번호 없음)
 *   → 두 기록 단위는 연결돼 있지 않으므로 같은 실물의 이력처럼 합치지 않는다.
 * - 연결선은 업무 흐름 설명이다. 제작 완료 전 조립을 막는 등의 규칙은 없다.
 * - 측정값·검토값을 바꾸는 기능은 없다. 오류사례 연결만 할 수 있다 (오류 DB 관리와 같은 API).
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Link2, RotateCw } from "lucide-react";
import { DrawingViewer } from "../DrawingViewer";
import { apiUrl, fetchItemErrors, fetchOcr, type Drawing, type ErrorCandidate } from "../../lib/drawingAPI";
import { toOcrPoints, toleranceText, type OcrSnapshot } from "../../lib/ocr";
import { measurementStatusLabels, type MeasurementStatus } from "../../lib/measurementAPI";
import { STAGE_KEYS, STAGE_NAME, type StageKey } from "../../lib/machiningAPI";
import { WORK_PURPOSES, type WorkPurpose } from "../../lib/purpose";
import {
  fetchDrawingProgress,
  fetchItemProgress,
  type CardState,
  type DrawingProgress,
  type ItemProgress,
  type MeasurementRow,
  type ProgressItem,
} from "../../lib/admin/progressAPI";
import { ACTION_LABEL, createLink, type HistoryAction } from "../../lib/admin/errorDbAPI";
import { Empty, ErrorNote, FlowCard, FlowConnector, Loading, ProgressBar, Tag, percent } from "./adminUi";

const LABEL: Record<WorkPurpose, string> = Object.fromEntries(WORK_PURPOSES.map((p) => [p.value, p.label])) as Record<WorkPurpose, string>;

function statusTag(status: MeasurementStatus | null | undefined) {
  if (!status) return <Tag tone="muted">미측정</Tag>;
  const tone = status === "completed" ? "ok" : status === "remeasure" ? "bad" : status === "review_required" ? "warn" : "muted";
  const text = status === "pending" ? "확정 전" : status === "remeasure" ? "불합격" : measurementStatusLabels[status];
  return <Tag tone={tone}>{text}</Tag>;
}

/** 진행률을 낼 수 없을 때의 안내. 이유 문장이 무엇을 하면 되는지까지 말한다. */
function stateText(state: CardState, reason: string) {
  return state === "no_target" ? `대상 없음 — ${reason}` : reason;
}

/** 제작 항목의 마커 색: 불합격이 있으면 재측정, 모든 단계·모든 제품이 완료면 완료, 그 밖은 대기 */
function manufacturingStatus(item: ProgressItem): MeasurementStatus | null {
  const stages = Object.values(item.manufacturing?.stages ?? {});
  if (!stages.length || !stages[0].units) return null;
  if (stages.some((s) => s.failed > 0)) return "remeasure";
  if (stages.every((s) => s.completed === s.units)) return "completed";
  return "pending";
}

export function WorkflowProgress({
  drawing,
  onOpenDrawing,
  onChooseDrawing,
}: {
  drawing: Drawing | null;
  /** 이 도면을 관리자 검토 화면으로 연다 (itemId 가 있으면 그 항목 선택) */
  onOpenDrawing: (drawing: Drawing, itemId?: string) => void;
  /** 부품·도면 관리로 돌아가 다른 도면을 고른다 */
  onChooseDrawing: () => void;
}) {
  const [progress, setProgress] = useState<DrawingProgress | null>(null);
  const [snapshot, setSnapshot] = useState<OcrSnapshot | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [purpose, setPurpose] = useState<WorkPurpose>("manufacturing");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const drawingId = drawing?.drawing_id ?? "";

  useEffect(() => {
    setSelectedItem(null);
    setProgress(null);
    setSnapshot(null);
  }, [drawingId]);

  useEffect(() => {
    if (!drawingId) return;
    const controller = new AbortController();
    setError("");
    Promise.all([fetchDrawingProgress(drawingId, controller.signal), fetchOcr(drawingId, controller.signal)])
      .then(([nextProgress, nextSnapshot]) => {
        if (controller.signal.aborted) return;
        setProgress(nextProgress);
        setSnapshot(nextSnapshot);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "진행 현황 조회 실패");
      });
    return () => controller.abort();
  }, [drawingId, reload]);

  const sameRevision = !!progress && !!snapshot && snapshot.revision === progress.ocr.revision;
  const points = useMemo(() => (sameRevision && snapshot?.result ? toOcrPoints(snapshot.result) : []), [sameRevision, snapshot]);
  const itemById = useMemo(() => new Map((progress?.items ?? []).map((item) => [item.item_id, item])), [progress]);

  if (!drawing) {
    return (
      <div className="card flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-neutral-300">
        <p>작업 현황을 볼 부품·도면을 먼저 선택해주세요.</p>
        <button type="button" onClick={onChooseDrawing} className="btn btn-secondary">
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          부품·도면 관리에서 선택
        </button>
      </div>
    );
  }

  const markers = Object.fromEntries(points.map((point) => {
    const item = itemById.get(point.source.id);
    const status = !item ? null : purpose === "manufacturing" ? manufacturingStatus(item) : item[purpose]?.status ?? null;
    return [point.id, { status: status ?? "pending" }];
  }));
  const selectedPoint = points.find((point) => point.source.id === selectedItem);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white">
            {progress?.drawing.part_name ? `${progress.drawing.part_name} · ` : ""}{drawing.original_filename || drawing.name}
          </h3>
          <p className="text-[11px] text-neutral-400">
            {progress
              ? progress.ocr.has_result
                ? `OCR 버전 ${progress.ocr.revision?.slice(0, 8)} · 측정항목 ${progress.ocr.item_count}개 · ${progress.ocr.review_status === "reviewed" ? "검토 완료" : "검토 전"}`
                : "OCR 결과 없음"
              : "불러오는 중"}
            {" · 담당자 미기록"}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setReload((v) => v + 1)} className="btn btn-ghost">
            <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
            새로 고침
          </button>
          <button type="button" onClick={onChooseDrawing} className="btn btn-secondary">다른 도면 선택</button>
          <button type="button" onClick={() => onOpenDrawing(drawing, selectedItem ?? undefined)} className="btn btn-primary">
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            도면 검토 화면으로
          </button>
        </div>
      </div>

      <ErrorNote message={error} />
      {!progress ? (
        !error && <Loading>진행 현황을 불러오는 중…</Loading>
      ) : (
        <>
          {progress.unclassified_records > 0 && (
            <p className="note note-info">목적이 지정되지 않은 이전 측정 기록 {progress.unclassified_records}건은 어느 분야에도 포함하지 않았습니다.</p>
          )}
          {progress.ocr.has_result && !sameRevision && snapshot && (
            <p className="note note-warn">조회 중 OCR 결과가 바뀌었습니다. 「새로 고침」을 눌러주세요.</p>
          )}

          <div role="group" aria-label="작업 흐름" className="flex flex-col gap-2 md:flex-row md:items-stretch">
            {(["manufacturing", "assembly", "verification"] as WorkPurpose[]).map((key, index) => {
              const card = progress.stages[key];
              return (
                <div key={key} className="contents">
                  {index > 0 && <FlowConnector />}
                  <FlowCard title={LABEL[key]} active={purpose === key} onClick={() => setPurpose(key)}>
                    {card.state === "ok" && key !== "manufacturing" && "not_measured" in card && card.not_measured === card.target ? (
                      // 기록이 하나도 없으면 0% 막대 대신 아직 시작 전임을 알린다.
                      <span className="text-[11px] text-neutral-300">아직 {LABEL[key]} 측정 기록이 없습니다 (0 / {card.target} 항목)</span>
                    ) : card.state === "ok" ? (
                      <>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-lg font-semibold tabular-nums text-white">{percent(card.progress)}</span>
                          <span className="text-[11px] tabular-nums text-neutral-400">완료 {card.completed} / 대상 {card.target}</span>
                        </span>
                        <ProgressBar value={card.progress} tone={key === "manufacturing" ? "cyan" : "emerald"} />
                        <span className="text-[11px] tabular-nums text-neutral-300">
                          불합격 <b className={card.failed ? "text-rose-300" : ""}>{card.failed}</b> · 미완료 {card.incomplete}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-amber-200">{stateText(card.state, card.reason)}</span>
                    )}
                    {key === "manufacturing" && progress.stages.manufacturing.stages && (
                      <span className="mt-0.5 grid grid-cols-3 gap-1">
                        {STAGE_KEYS.map((stage) => {
                          const sub = progress.stages.manufacturing.stages![stage];
                          return (
                            <span key={stage} className="rounded border border-neutral-700 px-1.5 py-1 text-[10px] text-neutral-300">
                              <span className="block font-semibold">{sub.name}</span>
                              <span className="tabular-nums">
                                {sub.required_items === 0 ? "대상 없음" : card.state === "ok" ? `${sub.completed}/${sub.target}${sub.failed ? ` · 불합격 ${sub.failed}` : ""}` : `항목 ${sub.required_items}개`}
                              </span>
                            </span>
                          );
                        })}
                      </span>
                    )}
                    <span className="text-[10px] text-neutral-500">
                      {card.unit ? `단위: ${card.unit}` : ""}
                      {key === "manufacturing" && progress.stages.manufacturing.units?.length ? ` · 제품 ${progress.stages.manufacturing.units.length}개` : ""}
                    </span>
                    <span className="text-[10px] text-neutral-500">최근 기록 {card.last_recorded_at ?? "없음"} · 담당자 미기록</span>
                  </FlowCard>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-neutral-500">
            진행률 = 완료 ÷ 대상. 완료는 합격 판정 후 확정한 기록, 불합격은 최신 판정이 불합격인 기록, 미완료는 미측정·확정 전·기준 확인 필요입니다.
            조립·검증 기록은 제품 번호 없이 도면 항목별 최신 1건만 셉니다. 그래서 부품제작의 제품 번호(예: CR01)와 같은 실물의 이력으로 묶지 않습니다.
            관람객 체험값은 서버에 저장되지 않아 여기에 나오지 않습니다.
          </p>

          {progress.items.length > 0 && (
            <div className="grid min-h-[420px] flex-1 gap-3 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)_minmax(320px,380px)]">
              <ItemList purpose={purpose} progress={progress} selected={selectedItem} onSelect={setSelectedItem} />
              <section aria-label="도면 위치" className="card relative flex min-h-[320px] flex-col overflow-hidden bg-slate-950">
                {sameRevision && snapshot?.result ? (
                  <DrawingViewer
                    key={`${drawingId}:${snapshot.revision}`}
                    drawingUrl={snapshot.image_url ? apiUrl(snapshot.image_url) : null}
                    mediaType="image/jpeg"
                    points={points}
                    coordinateSize={{ width: snapshot.result.image.width_px, height: snapshot.result.image.height_px }}
                    selectedPointId={selectedPoint?.id ?? 0}
                    onSelectPoint={(id) => setSelectedItem(points.find((point) => point.id === id)?.source.id ?? null)}
                    inspectionRecords={markers}
                    isAnalyzing={false}
                    analyzingStep={0}
                  />
                ) : (
                  <Empty>도면을 표시할 수 없습니다.</Empty>
                )}
              </section>
              <section aria-label="항목 상세" className="card flex min-h-[320px] flex-col overflow-hidden">
                {selectedItem && progress.ocr.revision ? (
                  <ItemDetail
                    key={`${selectedItem}:${purpose}:${reload}`}
                    drawingId={drawingId}
                    revision={progress.ocr.revision}
                    itemId={selectedItem}
                    purpose={purpose}
                    onLinked={() => setReload((v) => v + 1)}
                  />
                ) : (
                  <Empty>목록이나 도면에서 항목을 선택하면 측정값·판정·관련 사례·이력을 볼 수 있습니다.</Empty>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ItemList({
  purpose,
  progress,
  selected,
  onSelect,
}: {
  purpose: WorkPurpose;
  progress: DrawingProgress;
  selected: string | null;
  onSelect: (itemId: string) => void;
}) {
  const units = progress.stages.manufacturing.units?.length ?? 0;
  return (
    <section aria-label={`${LABEL[purpose]} 항목 목록`} className="card flex min-h-[320px] flex-col overflow-hidden">
      <header className="card-header">
        <h4 className="text-xs font-semibold text-white">{LABEL[purpose]} 항목</h4>
        <span className="text-[11px] text-neutral-400">{progress.items.length}개</span>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {progress.items.map((item) => {
          const on = item.item_id === selected;
          const mfg = item.manufacturing;
          return (
            <li key={item.item_id} className="border-b border-neutral-700 last:border-b-0">
              <button
                type="button"
                aria-current={on || undefined}
                onClick={() => onSelect(item.item_id)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs ${on ? "bg-cyan-400/10 shadow-[inset_3px_0_0_var(--color-cyan-400)]" : "hover:bg-white/5"}`}
              >
                <span className="w-6 shrink-0 text-right font-mono tabular-nums text-neutral-400">{item.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-neutral-100">{item.raw_text.replace(/\n/g, " ")}</span>
                  {purpose === "manufacturing" ? (
                    <span className="mt-0.5 flex flex-wrap gap-1 text-[10px] tabular-nums text-neutral-400">
                      {mfg && Object.keys(mfg.stages).length ? (
                        (Object.keys(mfg.stages) as StageKey[]).map((stage) => {
                          const sub = mfg.stages[stage]!;
                          return (
                            <span key={stage} className={sub.failed ? "text-rose-300" : ""}>
                              {STAGE_NAME[stage]} {units ? `${sub.completed}/${units}` : "—"}
                            </span>
                          );
                        })
                      ) : (
                        <span>가공 측정 안 함</span>
                      )}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[10px] text-neutral-400">{item.category}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {purpose !== "manufacturing" && statusTag(item[purpose]?.status)}
                  {item.links[purpose] > 0 && <span className="text-[10px] text-neutral-400">연결 {item.links[purpose]}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MeasurementLine({ record }: { record: Partial<MeasurementRow> }) {
  const value = record.measurement_mode === "gauge" ? (record.gauge_result === "pass" ? "합격" : record.gauge_result === "fail" ? "불합격" : "—") : record.measured_value || "—";
  return (
    <>
      <span className="font-mono text-neutral-100">{value}</span>
      <span className="text-neutral-400"> · {record.judgement === "pass" ? "합격" : record.judgement === "fail" ? "불합격" : "기준 확인"}{record.confirmed ? " · 확정" : ""}</span>
      {record.instrument && <span className="text-neutral-500"> · {record.instrument}</span>}
    </>
  );
}

function ItemDetail({
  drawingId,
  revision,
  itemId,
  purpose,
  onLinked,
}: {
  drawingId: string;
  revision: string;
  itemId: string;
  purpose: WorkPurpose;
  onLinked: () => void;
}) {
  const [detail, setDetail] = useState<ItemProgress | null>(null);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<ErrorCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchItemProgress(drawingId, itemId, revision, controller.signal)
      .then((data) => !controller.signal.aborted && setDetail(data))
      .catch((cause: unknown) => !controller.signal.aborted && setError(cause instanceof Error ? cause.message : "항목 조회 실패"));
    return () => controller.abort();
  }, [drawingId, itemId, revision]);

  async function search() {
    setSearching(true);
    setError("");
    try {
      setCandidates((await fetchItemErrors(purpose, drawingId, itemId)).errors);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "추천 사례 조회 실패");
    } finally {
      setSearching(false);
    }
  }

  async function link(caseId: string) {
    if (!window.confirm(`${caseId} 사례를 이 항목(${itemId})에 연결할까요?`)) return;
    try {
      await createLink(purpose, { case_id: caseId, drawing_id: drawingId, item_id: itemId, revision });
      setNotice("연결했습니다.");
      onLinked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "연결 실패");
    }
  }

  if (!detail) return error ? <div className="p-3"><ErrorNote message={error} /></div> : <Loading />;
  const links = detail.links[purpose];
  const linkedIds = new Set(links.filter((l) => l.linked).map((l) => l.case_id));
  const history = detail.history[purpose];

  return (
    <>
      <header className="card-header">
        <h4 className="min-w-0 truncate text-xs font-semibold text-white">{detail.item.raw_text.replace(/\n/g, " ")}</h4>
        <span className="font-mono text-[11px] text-neutral-400">{detail.item.id}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
        <ErrorNote message={error} />
        {notice && <p role="status" className="note note-ok">{notice}</p>}
        <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1">
          <dt className="text-neutral-400">기준</dt>
          <dd className="text-neutral-200">{toleranceText(detail.item)}</dd>
          <dt className="text-neutral-400">측정 방식</dt>
          <dd className="text-neutral-200">{detail.item.measurement_mode === "gauge" ? "합격·불합격 기록" : "실측값"}{detail.item.instrument ? ` · ${detail.item.instrument}` : ""}</dd>
          <dt className="text-neutral-400">담당자</dt>
          <dd className="text-neutral-400">미기록</dd>
        </dl>

        <section aria-label={`${LABEL[purpose]} 측정 기록`}>
          <h5 className="mb-1 text-[11px] font-semibold text-neutral-300">{LABEL[purpose]} 측정 기록</h5>
          {purpose === "manufacturing" ? (
            detail.manufacturing.records.length === 0 ? (
              <p className="text-neutral-400">기록 없음</p>
            ) : (
              <ul className="space-y-0.5">
                {[...detail.manufacturing.records]
                  .sort((a, b) => a.serial.localeCompare(b.serial) || a.stage.localeCompare(b.stage))
                  .map((record) => (
                    <li key={`${record.serial}:${record.stage}`} className="flex flex-wrap items-center gap-x-1.5">
                      <span className="font-mono text-neutral-300">{record.serial}</span>
                      <span className="text-neutral-400">{STAGE_NAME[record.stage]}</span>
                      {statusTag(record.status)}
                      <MeasurementLine record={record} />
                      <span className="w-full text-[10px] text-neutral-500">{record.updated_at}{record.judgement_reason ? ` · ${record.judgement_reason}` : ""}</span>
                    </li>
                  ))}
              </ul>
            )
          ) : detail[purpose].record ? (
            <div className="space-y-0.5">
              <p className="flex flex-wrap items-center gap-x-1.5">{statusTag(detail[purpose].record!.status)}<MeasurementLine record={detail[purpose].record!} /></p>
              <p className="text-[10px] text-neutral-500">{detail[purpose].record!.updated_at} · {detail[purpose].record!.judgement_reason}</p>
              {detail[purpose].record!.note && <p className="text-neutral-300">메모: {detail[purpose].record!.note}</p>}
            </div>
          ) : (
            <p className="text-neutral-400">미측정</p>
          )}
          {(() => {
            const attempts = purpose === "manufacturing" ? detail.manufacturing.attempts : detail[purpose].attempts;
            if (!attempts.length) return null;
            return (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-neutral-300">저장 시도 이력 {attempts.length}건</summary>
                <ol className="mt-1 space-y-0.5 text-[11px]">
                  {attempts.map((attempt, index) => (
                    <li key={index} className="text-neutral-400">
                      <span className="tabular-nums">{attempt.created_at}</span>{" "}
                      {"serial" in attempt && <span className="font-mono">{String(attempt.serial)} {STAGE_NAME[(attempt as { stage?: StageKey }).stage ?? "3"]} </span>}
                      <MeasurementLine record={attempt} />
                    </li>
                  ))}
                </ol>
              </details>
            );
          })()}
        </section>

        <section aria-label="연결된 오류사례">
          <h5 className="mb-1 text-[11px] font-semibold text-neutral-300">이 항목에 연결한 {LABEL[purpose]} 사례</h5>
          {links.length === 0 ? (
            <p className="text-neutral-400">연결된 사례가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {links.map((link) => (
                <li key={link.link_id} className={`rounded border border-neutral-700 px-2 py-1 ${link.linked ? "" : "opacity-60"}`}>
                  <span className="block text-neutral-100">{link.case_title}</span>
                  <span className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-400">
                    <span className="font-mono">{link.case_id}</span>
                    {!link.case_active && <Tag tone="muted">비활성</Tag>}
                    {link.linked ? `연결 ${link.created_at}` : `해제 ${link.unlinked_at}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="자동 추천 사례">
          <div className="mb-1 flex items-center justify-between">
            <h5 className="text-[11px] font-semibold text-neutral-300">비슷한 사례 추천 (아직 연결 안 됨)</h5>
            <button type="button" disabled={searching} onClick={() => void search()} className="btn btn-ghost h-6">
              {candidates ? "다시 검색" : "추천 보기"}
            </button>
          </div>
          {searching && <Loading>검색 중…</Loading>}
          {candidates && (candidates.length === 0 ? (
            <p className="text-neutral-400">추천 사례가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {candidates.map((candidate) => (
                <li key={candidate.case_id} className="flex items-start gap-2 rounded border border-dashed border-neutral-600 px-2 py-1">
                  <span className="min-w-0 flex-1">
                    <span className="block text-neutral-200">{candidate.case_title}</span>
                    <span className="font-mono text-[10px] text-neutral-500">{candidate.case_id}</span>
                  </span>
                  {linkedIds.has(candidate.case_id) ? (
                    <span className="text-[10px] text-neutral-400">연결됨</span>
                  ) : (
                    <button type="button" onClick={() => void link(candidate.case_id)} className="btn btn-secondary h-6" title="이 항목에 명시적으로 연결">
                      <Link2 aria-hidden="true" className="h-3 w-3" />
                      연결
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ))}
        </section>

        <section aria-label="사례 이력">
          <h5 className="mb-1 text-[11px] font-semibold text-neutral-300">이 항목의 {LABEL[purpose]} 사례 등록·연결·해제 기록</h5>
          {history.length === 0 ? (
            <p className="text-neutral-400">기록된 이력이 없습니다.</p>
          ) : (
            <ol className="space-y-0.5 text-[11px]">
              {history.map((event) => (
                <li key={event.event_id} className="text-neutral-400">
                  <span className="tabular-nums">{event.created_at}</span> · <b className="text-neutral-200">{ACTION_LABEL[event.action as HistoryAction] ?? event.action}</b> · {event.case_title ?? event.case_id} · 작성자 미기록
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
