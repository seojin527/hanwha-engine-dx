import { useEffect, useRef, useState } from 'react';
import { fetchPointReports, registerPointError, retryCaseIndex, type RegistrationResult } from '../lib/pointAPI';
import type { OcrItem } from '../lib/ocr';

const fields = [
  ['case_title', '오류 제목', true], ['error_description', '발생한 오류', true],
  ['cause', '원인', false], ['corrective_action', '조치 내용', false],
  ['precaution', '주의사항·재발 방지', true],
  ['applicable_condition', '적용 조건', false], ['exclude_condition', '제외·확인 조건', false],
] as const;
export function PointErrorForm({drawingId, revision, item, number, onIndexed}: {
  drawingId: string; revision: string; item: OcrItem; number: number; onIndexed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<RegistrationResult | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof fetchPointReports>>['reports']>([]);
  const [historyError, setHistoryError] = useState('');
  const [version, setVersion] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryError('');
    fetchPointReports(drawingId, item.id, revision, controller.signal).then(r => {
      if (!controller.signal.aborted) setHistory(r.reports);
    }).catch(e => {if (!controller.signal.aborted) setHistoryError(e.message);});
    return () => controller.abort();
  }, [drawingId, item.id, revision, version]);
  async function submit() {
    if (lock.current) return;
    for (const [key, label, required] of fields) if (required && !values[key]?.trim()) {setError(`${label}을 입력해주세요.`); return;}
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await registerPointError(drawingId, item.id, {...values, revision, request_id: requestId.current});
      if (!alive.current) return;
      setSaved(response); setVersion(v => v + 1);
      if (response.vector_status === 'ready') onIndexed();
    } catch (e) {if (alive.current) setError(e instanceof Error ? e.message : '등록 실패');}
    finally {lock.current = false; if (alive.current) setBusy(false);}
  }
  async function retry() {
    if (!saved || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await retryCaseIndex(saved.case_id);
      if (!alive.current) return;
      setSaved({...saved, ...result}); setVersion(v => v + 1);
      if (result.vector_status === 'ready') onIndexed();
    } catch (e) {if (alive.current) setError(e instanceof Error ? e.message : '검색 반영 실패');}
    finally {lock.current = false; if (alive.current) setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold">이 포인트의 오류 기록</h3>
      <button onClick={() => setOpen(v => !v)} className="rounded-lg border border-cyan-300 bg-white px-3 py-1.5 text-xs font-bold text-cyan-800">{open ? '닫기' : '+ 오류사례 등록'}</button></div>
    {open && <div className="space-y-3 border-t pt-3">
      <p className="rounded bg-cyan-50 p-2 text-xs text-cyan-900">{number}번 · {item.raw_text}<br/>도면·항목·OCR 버전과 인식 정보는 자동 연결됩니다.</p>
      {saved ? <div role="status" className="space-y-2 text-xs"><p>{saved.vector_status === 'ready' ? '오류 기록 저장과 검색 반영이 완료됐습니다.' : '오류 기록은 저장됐지만 검색 반영에 실패했습니다.'}</p>
        <p className="break-all text-slate-500">{saved.case_id}</p>
        {saved.vector_status === 'failed' && <button disabled={busy} onClick={retry} className="rounded bg-amber-100 px-3 py-2">{busy ? '반영 중…' : '검색 반영 재시도'}</button>}
        <button disabled={busy} onClick={() => {setSaved(null); setValues({}); requestId.current = crypto.randomUUID();}} className="ml-2 underline">새 오류 작성</button>
      </div> : <form onSubmit={e => {e.preventDefault(); void submit();}} className="space-y-3">
        {fields.map(([key, label, required]) => <label key={key} className="block text-xs font-semibold">{label}{required ? ' *' : ''}
          <textarea required={required} maxLength={10000} rows={key === 'case_title' ? 1 : 2} disabled={busy}
            value={values[key] || ''} onChange={e => setValues(v => ({...v, [key]: e.target.value}))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal focus:border-cyan-500 focus:outline-none" /></label>)}
        <button disabled={busy} className="w-full rounded-lg bg-cyan-600 py-2 text-xs font-bold text-white disabled:opacity-40">{busy ? '저장·검색 반영 중…' : '이 포인트에 오류 등록'}</button>
      </form>}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
      <p className="text-[11px] text-slate-500">사용자 보고 사례로 저장됩니다. 미등록 작성 내용은 포인트 이동 시 사라집니다.</p>
    </div>}
    {historyError ? <p className="text-xs text-rose-700">기록 조회 실패: {historyError}</p> : history.length ? history.map(r => <article key={r.case_id} className="space-y-1 rounded-lg border bg-white p-3 text-xs">
      <h4 className="font-bold">{r.case_title}</h4><p>{r.error_description}</p><p className="text-[10px] text-slate-500">{r.created_at} · {r.vector_status === 'ready' ? '검색 반영 완료' : '검색 반영 필요'}</p>
    </article>) : <p className="text-xs text-slate-500">이 OCR 버전의 포인트에 직접 등록된 오류 기록이 없습니다.</p>}
  </section>;
}
