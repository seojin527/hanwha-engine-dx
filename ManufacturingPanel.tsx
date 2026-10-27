import { AlertTriangle, Download, Lock } from 'lucide-react';
import { PointErrorForm } from './PointErrorForm';
import { useEffect, useRef, useState } from 'react';
import type { ErrorCandidate } from '../lib/drawingAPI';
import type { WorkPurpose } from '../lib/purpose';
import { type OcrItem, type OcrPoint } from '../lib/ocr';
import ItemHeader, { Chip, ProgressBar } from './review/ItemHeader';
import { FEATURE_LABEL } from '../lib/inspection/instruments';
import { TOLERANCE_SOURCE_LABEL, formatDeviationPair, formatNumber } from '../lib/inspection/tolerance';
import StageEntry from './manufacturing/StageEntry';
import {
  STAGE_KEYS,
  STAGE_NAME,
  fetchStageErrors,
  saveStageRecord,
  stageReportUrl,
  type MachiningItem,
  type MachiningState,
  type StageKey,
} from '../lib/machiningAPI';

/** 이 패널의 오류사례 검색·등록은 manufacturing 저장소만 사용한다. */
const PURPOSE: WorkPurpose = 'manufacturing';

export interface ReviewInfo {
  reviewer: string;
  at: string;
}

/** 단계별 도면 번호 색 (ManufacturingPage 와 같은 색) */
export const STAGE_DOT: Record<StageKey, string> = { '1': 'bg-orange-500', '2': 'bg-violet-600', '3': 'bg-indigo-600' };

/**
 * 부품제작(가공 중 측정) 오른쪽 패널.
 * 제품 번호 → 단계(황삭·중삭·정삭) → 이 단계에서 잴 항목의 기준·측정 입력·관련 오류사례.
 */
export function ManufacturingPanel({
  drawingId,
  revision,
  point,
  position,
  total,
  labelTotal,
  onNavigate,
  reviewInfo,
  machining,
  unit = 'mm',
}: {
  drawingId: string;
  revision: string;
  point?: OcrPoint;
  /** 이번 단계 목록 안에서 몇 번째인지 (목록 밖 항목이면 0) */
  position: number;
  total: number;
  /** 도면 전체 번호 개수 (머리글의 번호/전체 표시용) */
  labelTotal: number;
  onNavigate: (delta: number) => void;
  reviewInfo?: ReviewInfo | null;
  machining: MachiningState;
  unit?: string;
}) {
  const { plan, stage } = machining;
  const itemId = point?.source.id;
  const key = `${drawingId}/${revision}/${machining.serial}/${stage}/${itemId}`;
  const [result, setResult] = useState<{ key: string; loading: boolean; errors: ErrorCandidate[]; error: string }>({ key: '', loading: true, errors: [], error: '' });
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    if (!itemId) return;
    const controller = new AbortController();
    const token = ++sequence.current;
    setResult({ key, loading: true, errors: [], error: '' });
    fetchStageErrors(drawingId, itemId, stage, controller.signal).then((response) => {
      if (controller.signal.aborted || token !== sequence.current) return;
      setResult({ key, loading: false, errors: response.errors, error: '' });
    }).catch((error) => {
      if (!controller.signal.aborted && token === sequence.current) {
        setResult({ key, loading: false, errors: [], error: error.message || '검색 실패' });
      }
    });
    return () => { controller.abort(); ++sequence.current; };
  }, [drawingId, revision, itemId, key, retry, stage]);

  const status = plan?.status[stage];
  const locked = plan && status && !status.unlocked
    ? lockMessage(plan.status, stage)
    : undefined;

  if (!point) {
    return (
      <section className="flex min-h-full flex-col bg-slate-50 text-slate-800">
        <StageBar machining={machining} drawingId={drawingId} revision={revision} />
        <p className="p-5 text-sm text-slate-500">{plan ? '이 단계에서 잴 항목이 없습니다.' : '측정항목을 선택해주세요.'}</p>
      </section>
    );
  }
  const item = point.source;
  const loading = result.key !== key || result.loading;
  const itemPlan = machining.itemPlan(item.id);
  const criteria = itemPlan?.stages[stage] ?? null;
  const record = machining.stageRecords[item.id] ?? null;

  return (
    <section className="flex min-h-full flex-col bg-slate-50 text-slate-800">
      <div className="sticky top-0 z-10 shadow-sm">
        <StageBar machining={machining} drawingId={drawingId} revision={revision} />
        <ItemHeader
          number={point.displayNumber}
          total={labelTotal}
          title={itemPlan?.label || point.feature.name}
          rawText={item.raw_text}
          itemId={item.id}
          onNavigate={onNavigate}
          chips={
            <>
              {reviewInfo ? (
                <Chip tone="ok">검토 완료 · {reviewInfo.reviewer || '검토자 미기록'}{reviewInfo.at ? ` ${reviewInfo.at}` : ''}</Chip>
              ) : (
                <Chip tone="warn">검토 전</Chip>
              )}
              {position > 0 ? (
                <Chip tone="info">{STAGE_NAME[stage]} {position}/{total}번째</Chip>
              ) : (
                <Chip tone="neutral">{STAGE_NAME[stage]} 측정 대상 아님</Chip>
              )}
              {record && (
                <Chip tone={record.status === 'completed' ? 'ok' : record.judgement === 'fail' ? 'error' : 'warn'}>
                  {record.judgement === 'pass' ? '합격' : record.judgement === 'fail' ? '불합격' : '판정 보류'}
                </Chip>
              )}
            </>
          }
        />
        {status && (
          <ProgressBar
            label={`${machining.serial} · ${STAGE_NAME[stage]} 합격`}
            done={status.passed}
            total={status.required}
            chips={status.failed > 0 ? <Chip tone="error">불합격 {status.failed}</Chip> : null}
          />
        )}
      </div>

      <div className="flex-1 space-y-3 p-3">
        {itemPlan && <StageCriteriaCard itemPlan={itemPlan} stage={stage} stageLabel={plan!.stage_labels[stage]} />}
        {(!criteria || criteria.role !== 'allowance') && <CriteriaCard item={item} />}
        {!plan ? (
          <p className="note note-info">가공 단계 정보를 불러오는 중입니다.</p>
        ) : !criteria ? (
          <p className="note note-info">이 항목은 {STAGE_NAME[stage]} 측정 대상이 아닙니다. 도면의 색 번호를 눌러 이번 단계 항목을 재주세요.</p>
        ) : (
          <StageEntry
            key={`entry-${key}`}
            stage={stage}
            criteria={criteria}
            rawText={item.raw_text}
            unit={item.unit || unit}
            defaultInstrument={item.instrument ?? ''}
            featureType={item.feature_type}
            gdtSymbols={item.category === 'GDT' ? item.raw_text.split('\n').map((row) => row.split('|')[0]) : []}
            record={record}
            locked={locked}
            zeroChecked={machining.zeroChecked}
            onZeroChecked={machining.markZeroChecked}
            save={async (body) => {
              const saved = await saveStageRecord(drawingId, item.id, { ...body, revision, serial: machining.serial, stage });
              machining.refresh();
              return saved;
            }}
          />
        )}

        <section aria-label="측정 전 확인 · 관련 오류사례" className="card border-amber-300">
          <header className="card-header border-amber-200 bg-amber-50">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              {STAGE_NAME[stage]} 측정 전 확인 · 관련 오류사례
            </h3>
            {!loading && !result.error && <span className="tag bg-amber-100 text-amber-900">{result.errors.length}건</span>}
          </header>
          {loading ? <p role="status" className="p-3 text-xs text-slate-600">관련 오류·주의사항 검색 중…</p>
            : result.error ? <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-xs text-rose-700"><span className="min-w-0 flex-1">{result.error}</span><button type="button" onClick={() => setRetry((v) => v + 1)} className="btn btn-secondary h-6">다시 검색</button></div>
            : !result.errors.length ? <p className="p-3 text-xs text-slate-600">조건에 맞는 등록 사례가 없습니다. 안전함을 의미하지는 않습니다.</p>
            : <div className="divide-y divide-slate-200">{result.errors.map((error) => <article key={error.case_id} className="space-y-2 p-3 text-xs">
              <div>
                <h4 className="text-[13px] font-semibold leading-snug text-slate-900">{error.case_title || error.case_id}</h4>
                <p className="mt-0.5 text-[11px] text-slate-500">{error.case_id}{error.data_origin === 'SYNTHETIC' ? ' · 가상 테스트 사례' : error.data_origin === 'USER_REPORTED' ? ' · 사용자 등록 사례' : ''} · 적용 조건 확인 필요</p>
              </div>
              <p className="leading-relaxed text-slate-800">{error.error_description}</p>
              {error.precaution && <p className="note note-ok"><b className="mr-1 font-semibold">주의사항</b>{error.precaution}</p>}
              {(error.cause || error.recommended_instrument) && (
                <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 leading-relaxed">
                  {error.cause && <><dt className="text-slate-500">원인</dt><dd className="text-slate-800">{error.cause}</dd></>}
                  {error.recommended_instrument && <><dt className="text-slate-500">측정기 후보</dt><dd className="text-slate-800">{error.recommended_instrument}</dd></>}
                </dl>
              )}
            </article>)}</div>}
        </section>
        <PointErrorForm key={`error-form-${key}`} purpose={PURPOSE} drawingId={drawingId} revision={revision} item={item} number={point.displayNumber} onIndexed={() => setRetry((v) => v + 1)} />
      </div>
    </section>
  );
}

function lockMessage(status: Record<StageKey, { passed: number; required: number }>, stage: StageKey) {
  const previous = STAGE_KEYS[STAGE_KEYS.indexOf(stage) - 1];
  if (!previous) return undefined;
  const s = status[previous];
  return `${STAGE_NAME[previous]} 측정이 모두 합격해야 ${STAGE_NAME[stage]}을 기록할 수 있습니다. (${STAGE_NAME[previous]} 합격 ${s.passed}/${s.required})`;
}

/** 제품 번호 · 단계 선택 · 진행 · 성적서 */
function StageBar({ machining, drawingId, revision }: { machining: MachiningState; drawingId: string; revision: string }) {
  const { plan, stage, setStage, serial, setSerial, loading, error } = machining;
  const [draft, setDraft] = useState(serial);
  useEffect(() => setDraft(serial), [serial]);
  const apply = () => {
    if (draft.trim() && draft.trim() !== serial) setSerial(draft);
  };
  const current = plan?.status[stage];
  const nextStage = STAGE_KEYS[STAGE_KEYS.indexOf(stage) + 1];

  return (
    <div className="space-y-1.5 border-b border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          제품 번호
          <input
            className="field h-7 w-28 font-mono text-xs"
            list="machining-serials"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={apply}
            onKeyDown={(event) => { if (event.key === 'Enter') apply(); }}
            aria-label="제품 번호 (시리얼)"
          />
          <datalist id="machining-serials">
            {(plan?.serials ?? []).map((value) => <option key={value} value={value} />)}
          </datalist>
        </label>
        {plan && (
          <a href={stageReportUrl(drawingId, revision)} download className="btn btn-secondary ml-auto h-7" title="제품 번호별 실측·편차·판정 (치수 검사 기록서 양식)">
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
            자주검사 성적서
          </a>
        )}
      </div>
      {!plan ? (
        <p className="text-[11px] text-slate-500">
          {error ? <span className="text-rose-700">가공 단계 조회 실패: {error}</span> : loading ? '가공 단계 불러오는 중…' : '가공 단계 정보 없음'}
        </p>
      ) : (
        <>
          <div role="group" aria-label="가공 단계 선택" className="seg w-full">
            {STAGE_KEYS.map((key) => {
              const s = plan.status[key];
              const disabled = !s.unlocked;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={stage === key}
                  disabled={disabled}
                  title={disabled ? '앞 단계 측정이 모두 합격해야 열립니다' : plan.stage_labels[key]}
                  onClick={() => setStage(key)}
                  className="seg-item flex-1 justify-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {disabled ? <Lock aria-hidden="true" className="h-3 w-3" /> : <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STAGE_DOT[key]}`} />}
                  {STAGE_NAME[key]}
                  <span className="font-mono text-[10px] text-slate-500">{s.passed}/{s.required}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] leading-snug text-slate-600">
            <b className="font-semibold text-slate-800">{STAGE_NAME[stage]}:</b> {plan.stage_labels[stage]}
            {!plan.template_found && ' · 부품 기준 템플릿이 없어 모든 항목을 정삭 후 측정으로 표시합니다.'}
          </p>
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-slate-500" aria-label="도면 번호 색">
            <Dot className={STAGE_DOT[stage]} label={`${STAGE_NAME[stage]} 측정 대상`} />
            <Dot className="bg-emerald-600" label="합격" />
            <Dot className="bg-red-600" label="재측정" />
            <Dot className="bg-slate-300" label="다른 단계" />
          </p>
          {current?.complete && nextStage && (
            <div className="note note-ok flex flex-wrap items-center justify-between gap-2">
              <span>{STAGE_NAME[stage]} 측정 {current.required}건 모두 합격했습니다.</span>
              <button type="button" className="btn btn-primary h-7" onClick={() => setStage(nextStage)}>
                {STAGE_NAME[nextStage]}으로 넘어가기
              </button>
            </div>
          )}
          {current?.complete && !nextStage && (
            <p className="note note-ok">정삭 측정까지 모두 합격 — {serial} 가공 중 측정 완료. 자주검사 성적서를 내려받을 수 있습니다.</p>
          )}
          {current && !current.complete && current.failed > 0 && (
            <p className="note note-error">{STAGE_NAME[stage]} 불합격 {current.failed}건 — 재가공·재측정 후 모두 합격해야 다음 단계로 넘어갑니다.</p>
          )}
        </>
      )}
    </div>
  );
}

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

/** 이 항목이 어느 단계에서 무엇으로 판정되는지. */
function StageCriteriaCard({ itemPlan, stage, stageLabel }: { itemPlan: MachiningItem; stage: StageKey; stageLabel: string }) {
  const criteria = itemPlan.stages[stage];
  return (
    <section aria-label="가공 단계 기준" className="card text-xs">
      <header className="card-header">
        <h3 className="text-xs font-semibold text-slate-900">가공 단계 기준</h3>
        <span className="text-[11px] text-slate-500">{itemPlan.source === 'template' ? '부품 기준 (고정)' : '기본 규칙'}</span>
      </header>
      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 p-3">
        <dt className="text-slate-500">측정 단계</dt>
        <dd className="font-medium text-slate-900">
          {itemPlan.plan_label}
          <span className="ml-1.5 font-normal text-slate-500">
            ({STAGE_KEYS.filter((key) => itemPlan.stages[key]).map((key) => STAGE_NAME[key]).join(' → ')})
          </span>
        </dd>
        <dt className="text-slate-500">{STAGE_NAME[stage]} 판정</dt>
        <dd>
          {!criteria
            ? `${STAGE_NAME[stage]}(${stageLabel})에서는 재지 않습니다.`
            : criteria.role === 'allowance'
              ? (
                <>
                  <span>{criteria.text}</span>
                  {criteria.lower_limit !== null && criteria.upper_limit !== null && (
                    <b className="mt-0.5 block font-mono text-[13px] font-semibold text-slate-900">
                      {formatNumber(criteria.lower_limit)} ~ {formatNumber(criteria.upper_limit)} mm
                    </b>
                  )}
                  <span className="mt-0.5 block text-[11px] text-slate-500">다음 가공 여유가 남아 있는지 확인합니다. 도면 공차는 정삭에서 판정합니다.</span>
                </>
              )
              : criteria.role === 'finish'
                ? '이 단계에서 마무리 — 도면 공차로 판정'
                : '마무리(정삭) 후 — 도면 공차로 판정'}
        </dd>
      </dl>
    </section>
  );
}

/** 관리자가 확정한 검사 기준 (관리자 화면의 '작업자 검사 기준' 카드와 같은 내용, 읽기 전용). */
function CriteriaCard({ item }: { item: OcrItem }) {
  const approved = item.inspection_approved === true;
  const numeric = (item.measurement_mode ?? 'numeric') === 'numeric';
  const hasRange = typeof item.lower_limit === 'number' && typeof item.upper_limit === 'number';

  if (!approved) {
    return (
      <div className="note note-warn space-y-1">
        <h3 className="text-xs font-semibold">검사 기준 미지정</h3>
        <p>관리자가 이 항목의 검사 기준을 아직 지정하지 않았습니다. 측정값은 기록되지만 자동 판정하지 않습니다.</p>
        <p className="font-mono text-slate-700">도면 표기: {item.raw_text.replace(/\n/g, '  ')}</p>
      </div>
    );
  }

  return (
    <section aria-label="검사 기준" className="card text-xs">
      <header className="card-header">
        <h3 className="text-xs font-semibold text-slate-900">검사 기준</h3>
        <span className="text-[11px] text-slate-500">관리자 지정 · 읽기 전용</span>
      </header>
      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 p-3">
        <dt className="text-slate-500">측정 방식</dt>
        <dd>{numeric ? '실측값 입력 · 자동 판정' : '합격 / 불합격 기록'}</dd>
        <dt className="text-slate-500">측정 형상</dt>
        <dd>{FEATURE_LABEL[item.feature_type ?? ''] ?? '-'}</dd>
        {numeric ? (
          <>
            {typeof item.nominal_value === 'number' && (
              <>
                <dt className="text-slate-500">기준치수</dt>
                <dd className="font-mono">{formatNumber(item.nominal_value)} {item.unit ?? ''}</dd>
              </>
            )}
            {typeof item.upper_deviation === 'number' && typeof item.lower_deviation === 'number' && (
              <>
                <dt className="text-slate-500">공차</dt>
                <dd>
                  <span className="font-mono">{formatDeviationPair(item.upper_deviation, item.lower_deviation)}</span>
                  {item.tolerance_source && (
                    <span className="ml-1.5 text-[11px] text-slate-500">{TOLERANCE_SOURCE_LABEL[item.tolerance_source]}</span>
                  )}
                </dd>
              </>
            )}
            <dt className="text-slate-500">허용 범위</dt>
            <dd>
              {hasRange ? (
                <>
                  <b className="font-mono text-[13px] font-semibold text-slate-900">
                    {formatNumber(item.lower_limit as number)} ~ {formatNumber(item.upper_limit as number)} {item.unit ?? ''}
                  </b>
                </>
              ) : (
                '기준 없음'
              )}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-slate-500">판정 기준</dt>
            <dd className="whitespace-pre-wrap">{item.gauge_criteria || '-'}</dd>
          </>
        )}
        <dt className="text-slate-500">측정기</dt>
        <dd>{item.instrument || '-'}</dd>
      </dl>
    </section>
  );
}
