import { useEffect, useMemo, useState } from 'react';
import type { OcrItem } from '../lib/ocr';
import { FEATURE_LABEL } from '../lib/inspection/instruments';
import { formatNumber } from '../lib/inspection/tolerance';
import { findFitPairs, loadPeerItems, ownFit, type FitPair, type Limits, type PeerItem } from '../lib/assemblyFit';

const KIND_LABEL: Record<FitPair['kind'], string> = {
  clearance: '틈새(간극)',
  transition: '간극·간섭 혼재',
  interference: '간섭(억지)',
};

type PeerState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'ready'; peers: PeerItem[] };

function limitsText(limits: Limits, unit: string) {
  return `${formatNumber(limits.lower)} ~ ${formatNumber(limits.upper)} ${unit}`.trim();
}

/**
 * 조립 작업자 전용 카드: 이 치수가 구멍/축 중 무엇인지, 같은 기준치수의 반대 형상 항목(짝 후보)과의 이론 간극.
 * 읽기 전용이며 판정 기준을 만들지 않는다. 짝 여부는 도면으로 확인해야 한다.
 */
export default function AssemblyFitCard({ item, drawingId, revision }: { item: OcrItem; drawingId: string; revision: string }) {
  const own = useMemo(() => ownFit(item), [item]);
  const key = `${drawingId}/${revision}`;
  const needPeers = own.kind === 'confirmed' && own.limits !== null;
  const [state, setState] = useState<PeerState | null>(null);

  // 짝 후보 조회는 도면(개정) 단위로 한 번만 한다. 항목을 바꿔도 다시 조회하지 않는다.
  useEffect(() => {
    if (!needPeers) return;
    const controller = new AbortController();
    setState((current) => (current?.key === key && current.status === 'ready' ? current : { key, status: 'loading' }));
    loadPeerItems(drawingId, controller.signal)
      .then((peers) => { if (!controller.signal.aborted) setState({ key, status: 'ready', peers }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, status: 'error', message: error instanceof Error ? error.message : '다른 도면을 불러오지 못했습니다.' });
      });
    return () => controller.abort();
  }, [needPeers, drawingId, key]);

  if (own.kind === 'hidden') return null;
  const unit = item.unit ?? 'mm';

  return (
    <section aria-label="결합 정보" className="card text-xs">
      <header className="card-header">
        <h3 className="text-xs font-semibold text-slate-900">결합 정보</h3>
        <span className="tag bg-indigo-50 text-indigo-700">조립 전용</span>
      </header>
      <div className="space-y-2 p-3">
        <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-slate-500">이 치수</dt>
          <dd>
            <span className="font-mono">{formatNumber(own.nominal)} {unit}</span>
            <span className="ml-1.5">
              {own.kind === 'confirmed' ? `${FEATURE_LABEL[own.shape]} (관리자 지정)` : '구멍/축 미확정'}
            </span>
          </dd>
          {own.limits && (
            <>
              <dt className="text-slate-500">한계 치수</dt>
              <dd className="font-mono">
                최소 {formatNumber(own.limits.lower)} ~ 최대 {formatNumber(own.limits.upper)} {unit}
                <span className="ml-1.5 text-[11px] text-slate-500">공차폭 {formatNumber(own.limits.upper - own.limits.lower)}</span>
              </dd>
            </>
          )}
        </dl>

        {own.kind === 'unconfirmed' && (
          <p className="note note-info">
            이 치수의 구멍/축 구분은 시스템 기본값입니다. 관리자 화면에서 구멍/축을 지정하면 결합 짝 후보가 여기에 표시됩니다.
          </p>
        )}

        {own.kind === 'confirmed' && !own.limits && (
          <p className="note note-info">허용 범위(한계 치수)가 없어 짝 후보를 찾지 않습니다. 관리자가 이 항목의 검사 기준을 확정해야 합니다.</p>
        )}

        {needPeers && state?.key === key && state.status === 'loading' && <p className="text-slate-500">다른 도면에서 짝 후보를 찾는 중…</p>}
        {needPeers && state?.key === key && state.status === 'error' && (
          <p className="note note-warn">짝 후보를 불러오지 못했습니다: {state.message}</p>
        )}
        {own.kind === 'confirmed' && state?.key === key && state.status === 'ready' && (
          <PairList pairs={findFitPairs(own, state.peers)} ownShape={own.shape} nominal={own.nominal} unit={unit} />
        )}
      </div>
    </section>
  );
}

function PairList({ pairs, ownShape, nominal, unit }: { pairs: FitPair[]; ownShape: 'HOLE' | 'SHAFT'; nominal: number; unit: string }) {
  const opposite = FEATURE_LABEL[ownShape === 'HOLE' ? 'SHAFT' : 'HOLE'];
  if (pairs.length === 0) {
    return (
      <p className="note note-info">
        다른 부품의 검토 완료 도면에서 기준치수 {formatNumber(nominal)} · {opposite}로 지정된 항목을 찾지 못했습니다.
        상대 부품 도면의 검토와 구멍/축 지정이 끝나야 표시됩니다.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] font-semibold text-slate-600">짝 후보 (같은 기준치수 · 반대 형상)</h4>
      {pairs.map((pair) => (
        <article key={`${pair.peer.drawingId}/${pair.peer.itemId}`} className="rounded-sm border border-slate-200 p-2">
          <p className="font-medium text-slate-900">
            {pair.peer.partName} · {pair.peer.number}번 <span className="font-mono">{pair.peer.rawText}</span> · {FEATURE_LABEL[pair.peer.shape]}
          </p>
          <p className="text-[11px] text-slate-500">{pair.peer.fileName}</p>
          <p className="mt-1">
            상대 허용 범위 <span className="font-mono">{limitsText(pair.peer.limits, unit)}</span>
          </p>
          <p>
            이론 간극{' '}
            <b className="font-mono text-[13px] text-slate-900">
              {formatNumber(pair.minClearance)} ~ {formatNumber(pair.maxClearance)} {unit}
            </b>
            <span className={`tag ml-1.5 ${pair.kind === 'clearance' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>
              {KIND_LABEL[pair.kind]}
            </span>
          </p>
        </article>
      ))}
      <p className="text-[11px] text-slate-500">
        한계 치수만으로 계산한 이론값입니다(간극 +, 간섭 −). 실제 결합 짝인지는 도면으로 확인해야 하며, 합격 기준은 아닙니다.
      </p>
    </div>
  );
}
