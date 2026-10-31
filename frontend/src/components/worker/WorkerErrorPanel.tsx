import { useEffect, useState } from 'react';
import { BookOpen, ChevronRight, RefreshCw } from 'lucide-react';
import { fetchItemErrors, type ErrorCandidate } from '../../lib/drawingAPI';
import { fetchStageErrors, STAGE_NAME, type StageKey } from '../../lib/machiningAPI';
import type { OcrPoint } from '../../lib/ocr';
import type { WorkPurpose } from '../../lib/purpose';
import { caseTextBlocks } from '../../lib/casePresentation';
import { PointErrorForm } from '../PointErrorForm';
import { ReadableCaseText } from './ReadableCaseText';

type State = { key: string; loading: boolean; errors: ErrorCandidate[]; error: string };
export function WorkerErrorPanel({ purpose, drawingId, revision, point, readOnly, stage, serial }: {
  purpose: WorkPurpose; drawingId: string; revision: string; point?: OcrPoint; readOnly: boolean; stage?: StageKey; serial?: string;
}) {
  const itemId = point?.source.id;
  const key = `${purpose}/${drawingId}/${revision}/${stage ?? ''}/${serial ?? ''}/${itemId}`;
  const [state, setState] = useState<State>({ key: '', loading: true, errors: [], error: '' });
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState({ key: "", id: "" });
  useEffect(() => {
    if (!itemId) return;
    const controller = new AbortController();
    setState({ key, loading: true, errors: [], error: '' });
    const query = purpose === 'manufacturing' && stage
      ? fetchStageErrors(drawingId, itemId, stage, controller.signal)
      : fetchItemErrors(purpose, drawingId, itemId, controller.signal);
    query.then(response => {
      if (controller.signal.aborted) return;
      if (response.item_id !== itemId || ('revision' in response && response.revision !== revision) ||
          ('drawing_id' in response && response.drawing_id !== drawingId) ||
          ('stage' in response && response.stage !== stage)) throw new Error('도면 또는 단계가 변경됐습니다. 다시 조회해주세요.');
      setState({ key, loading: false, errors: response.errors, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, loading: false, errors: [], error: error instanceof Error ? error.message : '조회 실패' });
    });
    return () => controller.abort();
  }, [purpose, drawingId, revision, itemId, stage, key, retry]);
  if (!point) return <p className="worker-empty">도면이나 아래 측정항목 표에서 치수를 선택하세요.</p>;
  const loading = state.key !== key || state.loading;
  const errors = state.key === key ? state.errors : [];
  const selected = errors.find(error => selection.key === key && error.case_id === selection.id) ?? errors[0];
  return <div className="worker-case-browser" aria-label="오류 사례 선택 항목">
    <p className="worker-case-current">{point.displayNumber}번 · {point.feature.name} <span>{point.source.raw_text.replace(/\n/g, " ")}</span></p>
    <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
      <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4" />참고 사례 {!loading && !state.error && `· ${errors.length}건`}</span>
      <button type="button" className="btn btn-secondary h-7" onClick={() => setRetry(v => v + 1)} disabled={loading} aria-label="오류 사례 다시 조회"><RefreshCw className="h-3 w-3" /></button>
    </div>
    {loading ? <p role="status" className="worker-empty">관련 오류·주의사항을 찾고 있습니다…</p>
      : state.error ? <p role="alert" className="note note-error">조회하지 못했습니다. {state.error}</p>
      : !errors.length ? <div className="worker-empty">조건에 맞는 등록 사례가 없습니다.<p className="mt-1 text-xs">사례가 없다고 안전함을 의미하지는 않습니다.</p></div>
      : <>
          <nav className={`worker-case-list ${errors.length === 1 ? "worker-single-case" : ""}`} aria-label="참고 사례 목록">
            {errors.map((error, index) => <button type="button" key={error.case_id}
              aria-pressed={selected?.case_id === error.case_id}
              onClick={() => setSelection({ key, id: error.case_id })}>
              <span className="worker-case-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="worker-case-list-title">{error.case_title || error.case_id}</span>
              <ChevronRight aria-hidden="true" size={15} />
            </button>)}
          </nav>
          <p className="worker-case-caption">유사 조건 검색 결과 · 적용 조건 확인 필요</p>
          {selected && <CaseCard key={`${key}/${selected.case_id}`} error={selected} />}
        </>}
    <div className="worker-case-registration">
      <PointErrorForm key={key} purpose={purpose} drawingId={drawingId} revision={revision} item={point.source} number={point.displayNumber} readOnly={readOnly} onIndexed={() => setRetry(v => v + 1)} />
    </div>
  </div>;
}

export function CaseField({ label, value, tone = 'plain' }: { label: string; value: unknown; tone?: 'plain' | 'warning' | 'action' }) {
  const blocks = caseTextBlocks(value);
  if (!blocks.length) return null;
  return <section className={`worker-case-field is-${tone}`} aria-label={label}>
    <h4>{label}</h4>
    <ReadableCaseText value={value} />
  </section>;
}
export function CaseCard({ error }: { error: ErrorCandidate }) {
  return <article className="worker-case-card">
    <header>
      <h3>{error.case_title || error.case_id}</h3>
    </header>
    <div className="space-y-2.5 p-3">
      <CaseField label="측정 전 주의사항" value={error.precaution} tone="warning" />
      <CaseField label="조치" value={error.corrective_action} tone="action" />
      {!caseTextBlocks(error.precaution).length && !caseTextBlocks(error.corrective_action).length && <CaseField label="발생 오류" value={error.error_description} />}
      <details className="worker-case-details">
        <summary>오류 내용·원인·적용 조건</summary>
        <div className="space-y-3 pt-3">
          <CaseField label="발생 오류" value={error.error_description} />
          <CaseField label="원인" value={error.cause} />
          <CaseField label="적용 조건" value={error.applicable_condition} />
          <CaseField label="제외·확인 조건" value={error.exclude_condition} tone="warning" />
          {error.data_origin && <p className="text-[11px] text-slate-500">데이터 구분: {error.data_origin === 'SYNTHETIC' ? '샘플' : error.data_origin === 'USER_REPORTED' ? '사용자 등록' : error.data_origin}</p>}
          <CaseField label="측정기 후보" value={error.recommended_instrument} />
          <CaseField label="영향" value={error.impact} />
          <CaseField label="심각도" value={error.severity} />
          <CaseField label="공정" value={error.process_stage} />
          <p className="text-[11px] text-slate-500">사례 {error.case_id}<br />출처: {error.source_file === 'user_form' ? '사용자 등록' : error.source_file || '오류사례 DB'}</p>
        </div>
      </details>
    </div>
  </article>;
}
