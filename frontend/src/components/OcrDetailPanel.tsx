import { PointErrorForm } from './PointErrorForm';
import { useEffect, useRef, useState } from 'react';
import { fetchItemErrors, type ErrorCandidate } from '../lib/drawingAPI';
import { toleranceText, type OcrPoint } from '../lib/ocr';
import OcrMeasurementEntry from "./OcrMeasurementEntry";
import type { SavedMeasurement } from "../lib/measurementAPI";


export function OcrDetailPanel({
  drawingId,
  revision,
  point,
  total,
  onNavigate,
  onMeasurementSaved,
}: {
  drawingId: string;
  revision: string;
  point?: OcrPoint;
  total: number;
  onNavigate: (delta: number) => void;
  onMeasurementSaved?: (record: SavedMeasurement) => void;
}) {
  const itemId = point?.source.id;
  const key = `${drawingId}/${revision}/${itemId}`;
  const [result, setResult] = useState<{ key: string; loading: boolean; errors: ErrorCandidate[]; error: string }>({ key: '', loading: true, errors: [], error: '' });
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    if (!itemId) return;
    const controller = new AbortController();
    const token = ++sequence.current;
    setResult({ key, loading: true, errors: [], error: '' });
    fetchItemErrors(drawingId, itemId, controller.signal).then((response) => {
      if (controller.signal.aborted || token !== sequence.current) return;
      if (response.drawing_id !== drawingId || response.item_id !== itemId || response.revision !== revision) {
        throw new Error('도면 결과가 변경됐습니다. 도면을 다시 선택해주세요.');
      }
      setResult({ key, loading: false, errors: response.errors, error: '' });
    }).catch((error) => {
      if (!controller.signal.aborted && token === sequence.current) {
        setResult({ key, loading: false, errors: [], error: error.message || '검색 실패' });
      }
    });
    return () => { controller.abort(); ++sequence.current; };
  }, [drawingId, revision, itemId, key, retry]);
  if (!point) return <p className="p-5 text-sm text-slate-500">측정항목을 선택해주세요.</p>;
  const item = point.source;
  const loading = result.key !== key || result.loading;
  return (
    <section className="space-y-5 p-5 text-slate-800">
      <header className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2"><span className="rounded bg-slate-900 px-2.5 py-1 text-xs font-extrabold text-cyan-400">{point.displayNumber.toString().padStart(2, '0')}</span>
          <div><h2 className="font-extrabold">{point.feature.name}</h2><p className="text-[11px] text-slate-500">{item.id}</p></div></div>
        <div className="flex items-center gap-2 text-xs"><button onClick={() => onNavigate(-1)} aria-label="이전 항목">◀</button>{point.displayNumber}/{total}<button onClick={() => onNavigate(1)} aria-label="다음 항목">▶</button></div>
      </header>
      <div className="space-y-2 rounded-xl border bg-slate-50 p-4 text-xs">
        <p className="font-bold text-slate-700">도면 추출 정보</p>
        <p className="font-mono text-sm font-bold">{item.raw_text}</p>
        <p>허용 범위: {toleranceText(item)}</p>
        <p className="text-slate-500">공차·형상 검토가 끝나기 전에는 자동 판정하지 않습니다.</p>
        {(item.review_reasons || []).map((reason) => <p key={reason} className="text-amber-800">• {reason}</p>)}
      </div>
      <OcrMeasurementEntry
        key={`measurement-${key}`}
        drawingId={drawingId}
        revision={revision}
        item={item}
        onSaved={onMeasurementSaved}
      />
      <PointErrorForm key={`error-form-${key}`} drawingId={drawingId} revision={revision} item={item} number={point.displayNumber} onIndexed={()=>setRetry(v=>v+1)} />
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
        <h3 className="text-xs font-extrabold text-amber-900">측정 전 확인 사항 · 관련 오류 후보</h3>
        {loading ? <p role="status" className="text-xs text-amber-900">관련 오류·주의사항 검색 중…</p>
          : result.error ? <div role="alert" className="text-xs text-rose-700">{result.error}<button onClick={() => setRetry((v) => v + 1)} className="ml-2 underline">다시 검색</button></div>
          : !result.errors.length ? <p className="text-xs text-slate-600">조건에 맞는 등록 사례가 없습니다. 안전함을 의미하지는 않습니다.</p>
          : result.errors.map((error) => <article key={error.case_id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <h4 className="font-bold text-rose-800">{error.case_title || error.case_id}</h4>
            <p className="text-[10px] text-slate-500">{error.case_id}{error.data_origin === 'SYNTHETIC' ? ' · 가상 테스트 사례' : error.data_origin === 'USER_REPORTED' ? ' · 사용자 등록 사례' : ''} · 적용 조건 확인 필요</p>
            <p>{error.error_description}</p>
            {error.cause && <p><b>원인:</b> {error.cause}</p>}
            {error.precaution && <div className="rounded bg-emerald-50 p-2 text-emerald-900"><b>주의사항:</b> {error.precaution}</div>}
            {error.recommended_instrument && <p><b>측정기 후보:</b> {error.recommended_instrument}</p>}
            {error.applicable_condition && <p><b>적용 조건:</b> {error.applicable_condition}</p>}
            {error.exclude_condition && <p><b>제외·확인 조건:</b> {error.exclude_condition}</p>}
            <p className="text-[10px] text-slate-400">출처: {error.source_file === 'user_form' ? '사용자 등록' : error.source_file || '오류사례 DB'}</p>
          </article>)}
      </div>
    </section>
  );
}
