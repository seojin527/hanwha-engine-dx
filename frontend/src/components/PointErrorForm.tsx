import { useEffect, useRef, useState } from 'react';
import { fetchPointReports, registerPointError, retryCaseIndex, type RegistrationResult } from '../lib/pointAPI';
import type { OcrItem } from '../lib/ocr';
import { useReportUnsaved } from '../lib/unsavedChanges';
import type { WorkPurpose } from '../lib/purpose';
import { ERROR_FORMS } from '../lib/errorForms';

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for(let i=0;i<16;i++) bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** 목적별 등록 폼. 항목 정의는 lib/errorForms/{목적}.ts 에서 목적마다 따로 관리한다. */
export function PointErrorForm({purpose, drawingId, revision, item, number, onIndexed, readOnly = false, onCount}: {
  purpose: WorkPurpose; drawingId: string; revision: string; item: OcrItem; number: number; onIndexed: () => void;
  /** 다른 업무 작업자가 보는 중이면 true: 기록 조회만 하고 등록·재시도를 숨긴다. */
  readOnly?: boolean;
  /** 이 항목에 연결된 사례 수 (탭 머리에 표시) */
  onCount?: (count: number | null) => void;
}) {
  const form = ERROR_FORMS[purpose];
  const fields = form.fields.map((field) => [field.key, field.label, !!field.required, field.rows ?? 2] as const);
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
    onCount?.(null);
    fetchPointReports(purpose, drawingId, item.id, revision, controller.signal).then(r => {
      if (!controller.signal.aborted) {setHistory(r.reports); onCount?.(r.reports.length);}
    }).catch(e => {if (!controller.signal.aborted) setHistoryError(e.message);});
    return () => controller.abort();
  }, [purpose, drawingId, item.id, revision, version]);
  async function submit() {
    if (lock.current) return;
    for (const [key, label, required] of fields) if (required && !values[key]?.trim()) {setError(`${label}을 입력해주세요.`); return;}
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await registerPointError(purpose, drawingId, item.id, {...values, revision, request_id: requestId.current});
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
      const result = await retryCaseIndex(purpose, caseId);
      if (!alive.current) return;
      setSaved(previous => previous?.case_id === caseId ? {...previous, ...result} : previous); setVersion(v => v + 1);
      if (result.vector_status !== 'ready') setError(result.message);
      if (result.vector_status === 'ready') onIndexed();
    } catch (e) {if (alive.current) setError(e instanceof Error ? e.message : '검색 반영 실패');}
    finally {lock.current = false; if (alive.current) setBusy(false);}
  }
  const label = 'block space-y-1 text-[11px] font-medium text-dx-muted';
  return <section aria-label="이 항목에 연결된 사례" className="space-y-2">
    <header className="flex items-center gap-2">
      <h3 className="min-w-0 flex-1 text-xs font-semibold text-white">이 항목에 연결된 사례 <span className="font-normal text-dx-muted">{history.length}건 · 작업자 등록·관리자 연결</span></h3>
      {readOnly ? <span className="text-[11px] text-dx-muted">조회 전용</span> : <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className={`dx-btn h-7 ${open ? '' : 'dx-btn-primary'}`}>{open ? '작성 닫기' : '+ 사례 등록'}</button>}
    </header>
    {open && !readOnly && <div className="space-y-2.5 rounded border border-dx-line-strong bg-dx-raised/60 p-3 text-xs">
      <p className="text-dx-muted"><b className="font-mono text-white">{number}번 · {item.raw_text.replace(/\n/g, '  ')}</b> 에 연결해 등록합니다. 도면·OCR 버전은 자동으로 붙습니다.</p>
      {saved ? <div role="status" className="space-y-2">
        <p className={saved.vector_status === 'ready' ? 'text-emerald-300' : 'text-amber-200'}>{saved.vector_status === 'ready' ? '등록했고 검색에도 반영했습니다.' : '등록은 됐지만 검색 반영에 실패했습니다.'}</p>
        <div className="flex flex-wrap gap-2">
          {saved.vector_status === 'failed' && <button type="button" disabled={busy} onClick={()=>void retry()} className="dx-btn">{busy ? '반영 중…' : '검색 반영 재시도'}</button>}
          <button type="button" disabled={busy} onClick={() => {setSaved(null); setValues({}); requestId.current = newRequestId();}} className="dx-btn dx-btn-ghost">새 사례 작성</button>
        </div>
      </div> : <form onSubmit={e => {e.preventDefault(); void submit();}} className="space-y-2.5">
        <label className={label}>오류 분류
          <select disabled={busy} value={values.error_category || ''} onChange={e=>setValues(v=>({...v,error_category:e.target.value}))} className="dx-input"><option value="">선택 안 함</option>{form.categories.map(category=><option key={category} value={category}>{category}</option>)}</select>
        </label>
        {fields.map(([key, fieldLabel, required, rows]) => <label key={key} className={label}>{fieldLabel}{required ? <span className="ml-0.5 text-rose-300" aria-hidden="true">*</span> : ''}
          <textarea required={required} maxLength={10000} rows={rows} disabled={busy}
            value={values[key] || ''} onChange={e => setValues(v => ({...v, [key]: e.target.value}))}
            className="dx-input resize-y" /></label>)}
        <button disabled={busy} className="dx-btn dx-btn-primary dx-btn-lg w-full">{busy ? '저장·검색 반영 중…' : '이 항목에 사례 등록'}</button>
      </form>}
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      <p className="text-[11px] text-dx-faint">작업자 등록 사례로 저장됩니다. 등록하지 않은 작성 내용은 항목을 옮기면 사라집니다.</p>
    </div>}
    {historyError ? <p role="alert" className="text-xs text-rose-300">연결 사례 조회 실패: {historyError}</p> : history.length ? <div className="space-y-1.5">{history.map(r => <article key={r.case_id} className="rounded border border-dx-accent/30 bg-dx-accent/[0.06] px-3 py-2 text-xs">
      <p className="font-semibold text-white">{r.case_title}</p>
      {r.error_description && <p className="mt-0.5 leading-relaxed text-dx-text">{r.error_description}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-dx-muted"><span>연결 {r.created_at}</span>{r.active === false && <span className="text-amber-200">비활성 사례</span>}{r.vector_status !== 'ready' && <span className="text-amber-200">검색 반영 필요</span>}
      {r.vector_status !== 'ready' && !readOnly && <button type="button" disabled={busy} onClick={()=>void retry(r.case_id)} className="text-[11px] font-medium text-dx-accent underline underline-offset-2 disabled:opacity-40">검색 반영 재시도</button>}</p>
    </article>)}</div> : <p className="text-xs text-dx-muted">이 항목에 직접 연결된 사례가 없습니다.{readOnly ? '' : ' 측정 중 겪은 오류는 「사례 등록」으로 남길 수 있습니다.'}</p>}
  </section>;
}
