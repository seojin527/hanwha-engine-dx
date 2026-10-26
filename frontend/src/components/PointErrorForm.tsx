import { useEffect, useRef, useState } from 'react';
import { fetchPointReports, registerPointError, retryCaseIndex, type RegistrationResult } from '../lib/pointAPI';
import type { OcrItem } from '../lib/ocr';
import { useReportUnsaved } from '../lib/unsavedChanges';

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for(let i=0;i<16;i++) bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const fields = [
  ['case_title', '오류 제목', true], ['error_description', '발생한 오류', true],
  ['recommended_instrument', '측정기', false],
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
  // 작성 중인 오류사례가 있으면 페이지 전환 전에 확인하도록 알린다.
  useReportUnsaved(open && !saved && Object.values(values).some((value) => value.trim() !== ''));
  const [history, setHistory] = useState<Awaited<ReturnType<typeof fetchPointReports>>['reports']>([]);
  const [historyError, setHistoryError] = useState('');
  const [version, setVersion] = useState(0);
  const requestId = useRef(newRequestId());
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
  async function retry(caseId = saved?.case_id) {
    if (!caseId || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await retryCaseIndex(caseId);
      if (!alive.current) return;
      setSaved(previous => previous?.case_id === caseId ? {...previous, ...result} : previous); setVersion(v => v + 1);
      if (result.vector_status !== 'ready') setError(result.message);
      if (result.vector_status === 'ready') onIndexed();
    } catch (e) {if (alive.current) setError(e instanceof Error ? e.message : '검색 반영 실패');}
    finally {lock.current = false; if (alive.current) setBusy(false);}
  }
  return <section aria-label="이 포인트의 오류 기록" className="card">
    <header className="card-header">
      <h3 className="text-xs font-semibold text-slate-900">이 포인트의 오류 기록{history.length ? <span className="ml-1.5 font-normal text-slate-500">{history.length}건</span> : null}</h3>
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className={`btn h-6 ${open ? 'btn-ghost' : 'btn-secondary'}`}>{open ? '작성 닫기' : '오류사례 등록'}</button>
    </header>
    {open && <div className="space-y-3 border-b border-slate-200 bg-slate-50 p-3">
      <p className="note note-info"><b className="font-mono font-semibold">{number}번 · {item.raw_text}</b><br/>도면·항목·OCR 버전과 인식 정보는 자동 연결됩니다.</p>
      {saved ? <div role="status" className="space-y-2 text-xs"><p className={saved.vector_status === 'ready' ? 'note note-ok' : 'note note-warn'}>{saved.vector_status === 'ready' ? '오류 기록 저장과 검색 반영이 완료됐습니다.' : '오류 기록은 저장됐지만 검색 반영에 실패했습니다.'}</p>
        <p className="break-all font-mono text-[11px] text-slate-500">{saved.case_id}</p>
        <div className="flex flex-wrap gap-2">
          {saved.vector_status === 'failed' && <button type="button" disabled={busy} onClick={()=>void retry()} className="btn btn-secondary">{busy ? '반영 중…' : '검색 반영 재시도'}</button>}
          <button type="button" disabled={busy} onClick={() => {setSaved(null); setValues({}); requestId.current = newRequestId();}} className="btn btn-ghost">새 오류 작성</button>
        </div>
      </div> : <form onSubmit={e => {e.preventDefault(); void submit();}} className="space-y-2.5">
        <label className="block space-y-1"><span className="field-label">오류 분류</span>
          <select disabled={busy} value={values.error_category || ''} onChange={e=>setValues(v=>({...v,error_category:e.target.value}))} className="field"><option value="">선택 안 함</option>{['측정','가공','환경','기타'].map(label=><option key={label} value={label}>{label}</option>)}</select>
        </label>
        {fields.map(([key, label, required]) => <label key={key} className="block space-y-1"><span className="field-label">{label}{required ? <span className="ml-0.5 text-rose-600" aria-hidden="true">*</span> : ''}</span>
          <textarea required={required} maxLength={10000} rows={key === 'case_title' ? 1 : 2} disabled={busy}
            value={values[key] || ''} onChange={e => setValues(v => ({...v, [key]: e.target.value}))}
            className="field resize-y" /></label>)}
        <button disabled={busy} className="btn btn-primary btn-lg w-full">{busy ? '저장·검색 반영 중…' : '이 포인트에 오류 등록'}</button>
      </form>}
      {error && <p role="alert" className="note note-error">{error}</p>}
      <p className="text-[11px] text-slate-500">사용자 보고 사례로 저장됩니다. 미등록 작성 내용은 포인트 이동 시 사라집니다.</p>
    </div>}
    <div className="divide-y divide-slate-100">
    {historyError ? <p className="note note-error m-3">기록 조회 실패: {historyError}</p> : history.length ? history.map(r => <article key={r.case_id} className="space-y-1 p-3 text-xs">
      <h4 className="font-semibold text-slate-900">{r.case_title}</h4><p className="leading-relaxed text-slate-800">{r.error_description}</p>
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500"><span>{r.created_at}</span><span className={`tag ${r.vector_status === 'ready' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>{r.vector_status === 'ready' ? '검색 반영 완료' : '검색 반영 필요'}</span>
      {r.vector_status !== 'ready' && <button type="button" disabled={busy} onClick={()=>void retry(r.case_id)} className="text-[11px] font-medium text-cyan-800 underline underline-offset-2 disabled:opacity-40">검색 반영 재시도</button>}</p>
    </article>) : <p className="p-3 text-xs text-slate-500">이 OCR 버전의 포인트에 직접 등록된 오류 기록이 없습니다.</p>}
    </div>
  </section>;
}
