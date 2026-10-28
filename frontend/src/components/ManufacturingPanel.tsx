import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OcrPoint } from '../lib/ocr';
import { formatNumber } from '../lib/inspection/tolerance';
import StageEntry from './manufacturing/StageEntry';
import { CriteriaSummary, WorkFooter, WorkItemHeading, WorkItemList, workStatusOf } from './work/WorkParts';
import {
  STAGE_KEYS,
  STAGE_NAME,
  saveStageRecord,
  type MachiningItem,
  type MachiningState,
  type StageKey,
} from '../lib/machiningAPI';

/** 다른 업무 작업자가 볼 때 측정 입력 대신 보여주는 안내 */
const READ_ONLY_MESSAGE = '이 업무의 담당 작업자만 입력할 수 있습니다. 저장된 결과만 표시합니다.';

/** 단계별 도면 번호 색 (ManufacturingPage 의 마커 색과 같은 색) */
export const STAGE_DOT: Record<StageKey, string> = { '1': 'bg-orange-500', '2': 'bg-violet-600', '3': 'bg-indigo-600' };

/**
 * 부품제작(가공 중 측정) 왼쪽 작업 패널.
 * 제품 번호·단계(황삭·중삭·정삭, 잠금 이유) → 이번 단계 측정 항목 목록 → 선택 항목의 기준·입력·판정 → 하단 고정 버튼.
 * 단계 잠금·0점 확인·저장 API 는 그대로 쓴다.
 */
export function ManufacturingPanel({
  drawingId,
  revision,
  point,
  points,
  onSelect,
  onNavigate,
  machining,
  unit = 'mm',
  readOnly = false,
}: {
  drawingId: string;
  revision: string;
  point?: OcrPoint;
  /** 이번 단계에서 잴 항목 (목록) */
  points: OcrPoint[];
  onSelect: (id: number) => void;
  onNavigate: (delta: number) => void;
  machining: MachiningState;
  unit?: string;
  /** 이 업무 담당이 아닌 작업자가 보는 중이면 true (측정 입력 잠금, 조회만) */
  readOnly?: boolean;
}) {
  const { plan, stage } = machining;
  const status = plan?.status[stage];
  const locked = plan && status && !status.unlocked ? lockMessage(plan.status, stage) : undefined;
  const item = point?.source;
  const itemPlan = item ? machining.itemPlan(item.id) : undefined;
  const criteria = itemPlan?.stages[stage] ?? null;
  const record = item ? machining.stageRecords[item.id] ?? null : null;
  const key = `${drawingId}/${revision}/${machining.serial}/${stage}/${item?.id}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-dx-panel text-dx-text">
      <StageBar machining={machining} />
      <WorkItemList
        points={points}
        selectedId={point?.id || 0}
        onSelect={onSelect}
        statusOf={(entry) => workStatusOf(machining.stageRecords[entry.source.id])}
        progressLabel={`${machining.serial || '제품'} · ${STAGE_NAME[stage]} 합격${readOnly ? ' · 조회 전용' : ''}`}
        emptyText={plan ? `${STAGE_NAME[stage]}에서 잴 항목이 없습니다.` : '가공 단계 정보를 불러오는 중입니다.'}
      />
      {!point || !item ? (
        <p className="p-4 text-sm text-dx-muted">위 목록이나 도면의 색 번호에서 측정 항목을 고르세요.</p>
      ) : (
        <>
          <WorkItemHeading point={point} title={itemPlan?.label || point.feature.name} status={workStatusOf(record)} />
          {!plan || !criteria ? (
            <>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <CriteriaSummary item={item} />
                <p className="rounded border border-dx-line bg-dx-raised/60 px-3 py-2 text-xs text-dx-muted">
                  {!plan ? '가공 단계 정보를 불러오는 중입니다.' : `이 항목은 ${STAGE_NAME[stage]} 측정 대상이 아닙니다. 목록이나 도면의 색 번호에서 이번 단계 항목을 고르세요.`}
                </p>
              </div>
              <WorkFooter>
                <button type="button" className="dx-btn dx-btn-lg flex-1" onClick={() => onNavigate(-1)}>이전</button>
                <button type="button" className="dx-btn dx-btn-lg flex-1" onClick={() => onNavigate(1)}>다음</button>
              </WorkFooter>
            </>
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
              locked={readOnly ? READ_ONLY_MESSAGE : locked}
              readOnlyView={readOnly}
              zeroChecked={machining.zeroChecked}
              onZeroChecked={machining.markZeroChecked}
              onNavigate={onNavigate}
              criteriaView={
                criteria.role === 'allowance' && itemPlan ? (
                  <StageCriteriaSummary itemPlan={itemPlan} stage={stage} unit={item.unit || unit} />
                ) : (
                  <CriteriaSummary
                    item={item}
                    title={`${STAGE_NAME[stage]} 기준 · ${criteria.role === 'finish' ? '이 단계에서 마무리' : '마무리(정삭) 후'} — 도면 공차로 판정`}
                  />
                )
              }
              save={async (body) => {
                if (readOnly) throw new Error(READ_ONLY_MESSAGE);
                const saved = await saveStageRecord(drawingId, item.id, { ...body, revision, serial: machining.serial, stage });
                machining.refresh();
                return saved;
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function lockMessage(status: Record<StageKey, { passed: number; required: number }>, stage: StageKey) {
  const previous = STAGE_KEYS[STAGE_KEYS.indexOf(stage) - 1];
  if (!previous) return undefined;
  const s = status[previous];
  return `${STAGE_NAME[previous]} 측정이 모두 합격해야 ${STAGE_NAME[stage]}을 기록할 수 있습니다. (${STAGE_NAME[previous]} 합격 ${s.passed}/${s.required})`;
}

/** 제품 번호 · 단계 선택(잠금 이유를 문장으로) · 단계 완료/불합격 안내 */
function StageBar({ machining }: { machining: MachiningState }) {
  const { plan, stage, setStage, serial, setSerial, loading, error } = machining;
  const [draft, setDraft] = useState(serial);
  useEffect(() => setDraft(serial), [serial]);
  const apply = () => {
    if (draft.trim() && draft.trim() !== serial) setSerial(draft);
  };
  const current = plan?.status[stage];
  const nextStage = STAGE_KEYS[STAGE_KEYS.indexOf(stage) + 1];
  // 잠긴 다음 단계가 있으면 이유를 한 줄로 보여준다 (마우스를 올리지 않아도 보이게).
  const firstLocked = plan ? STAGE_KEYS.find((key) => !plan.status[key].unlocked) : undefined;

  return (
    <div className="shrink-0 space-y-1.5 border-b border-dx-line px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-dx-muted">
          제품 번호
          <input
            className="dx-input h-7 w-24 py-0.5 font-mono"
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
        {plan && <span className="min-w-0 flex-1 truncate text-right text-[11px] text-dx-faint" title={plan.stage_labels[stage]}>{plan.stage_labels[stage]}</span>}
      </div>
      {!plan ? (
        <p className="text-[11px] text-dx-muted">
          {error ? <span className="text-rose-300">가공 단계 조회 실패: {error}</span> : loading ? '가공 단계 불러오는 중…' : '가공 단계 정보 없음'}
        </p>
      ) : (
        <>
          <div role="group" aria-label="가공 단계 선택" className="grid grid-cols-3 gap-1">
            {STAGE_KEYS.map((key) => {
              const s = plan.status[key];
              const disabled = !s.unlocked;
              const active = stage === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  title={disabled ? lockMessage(plan.status, key) : plan.stage_labels[key]}
                  onClick={() => setStage(key)}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded border text-xs font-medium disabled:cursor-not-allowed ${
                    active ? 'border-dx-accent bg-dx-accent/15 text-white' : disabled ? 'border-dx-line text-dx-faint' : 'border-dx-line-strong text-dx-text hover:bg-white/5'
                  }`}
                >
                  {disabled ? <Lock aria-hidden="true" className="h-3 w-3" /> : <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STAGE_DOT[key]}`} />}
                  {STAGE_NAME[key]}
                  <span className="font-mono text-[10px] opacity-80">{s.passed}/{s.required}</span>
                  {s.complete && <span className="text-emerald-300" aria-label="완료">✓</span>}
                </button>
              );
            })}
          </div>
          {firstLocked && <p className="flex items-start gap-1 text-[11px] text-amber-200"><Lock aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />{lockMessage(plan.status, firstLocked)}</p>}
          {!plan.template_found && <p className="text-[11px] text-dx-muted">부품 기준 템플릿이 없어 모든 항목을 정삭 후 측정으로 표시합니다.</p>}
          {current?.complete && nextStage && (
            <p className="flex items-center justify-between gap-2 rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-1.5 text-emerald-100">
              <span>{STAGE_NAME[stage]} {current.required}건 모두 합격</span>
              <button type="button" className="dx-btn dx-btn-primary h-7" onClick={() => setStage(nextStage)}>{STAGE_NAME[nextStage]}으로</button>
            </p>
          )}
          {current?.complete && !nextStage && (
            <p className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-1.5 text-emerald-100">정삭까지 모두 합격 — {serial} 가공 중 측정 완료. 상단 「자주검사 성적서」로 내려받을 수 있습니다.</p>
          )}
          {current && !current.complete && current.failed > 0 && (
            <p className="rounded border border-rose-400/40 bg-rose-500/10 px-2 py-1.5 text-rose-100">{STAGE_NAME[stage]} 불합격 {current.failed}건 — 재가공·재측정 후 모두 합격해야 다음 단계가 열립니다.</p>
          )}
        </>
      )}
    </div>
  );
}

/** 이 항목이 이번 단계에서 무엇으로 판정되는지 (목표 범위 또는 도면 공차) */
function StageCriteriaSummary({ itemPlan, stage, unit }: { itemPlan: MachiningItem; stage: StageKey; unit: string }) {
  const criteria = itemPlan.stages[stage];
  const order = STAGE_KEYS.filter((key) => itemPlan.stages[key]).map((key) => STAGE_NAME[key]).join(' → ');
  return (
    <section aria-label="가공 단계 기준" className="rounded border border-dx-line bg-dx-raised/60 px-3 py-2 text-xs">
      <p className="text-[11px] text-dx-muted">
        {STAGE_NAME[stage]} 기준 · {itemPlan.source === 'template' ? '부품 가공 기준' : '기본 규칙'} · 측정 단계 {order}
      </p>
      {criteria?.role === 'allowance' ? (
        <>
          <p className="mt-0.5 font-mono text-[15px] font-semibold text-white">
            {criteria.lower_limit !== null && criteria.upper_limit !== null ? `${formatNumber(criteria.lower_limit)} ~ ${formatNumber(criteria.upper_limit)} ${unit}` : '목표 범위 없음'}
          </p>
          <p className="mt-0.5 text-dx-muted">{criteria.text} · 다음 가공 여유 확인 (도면 공차는 정삭에서 판정)</p>
        </>
      ) : (
        <p className="mt-0.5 text-white">{criteria?.role === 'finish' ? '이 단계에서 마무리 — 도면 공차로 판정' : '마무리(정삭) 후 — 도면 공차로 판정'}</p>
      )}
    </section>
  );
}
