import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/drawingAPI';
import type { OcrDocument, OcrItem } from '../lib/ocr';

async function request(path: string, options?: RequestInit) {
  const response = await fetch(apiUrl(path), options);
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail));
  return body;
}
type Entry = {review_id: string; reviewer: string; completed: boolean; created_at: string; changes: {item_id: string; before: OcrItem; after: OcrItem}[]};
export function DrawingReviewPanel({drawingId, revision, document, selectedItemId, onSaved}: {
  drawingId: string; revision: string; document: OcrDocument; selectedItemId?: string; onSaved: () => void;
}) {
  const [admin, setAdmin] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [edits, setEdits] = useState<Record<string, Partial<OcrItem>>>({});
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request(`/api/drawings/${encodeURIComponent(drawingId)}/ocr/reviews`, {signal: controller.signal})
      .then(body => {if (!controller.signal.aborted) setHistory(body.history);})
      .catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [drawingId, revision]);
  const original = document.items.find(item => item.id === selectedItemId);
  const item = original ? {...original, ...edits[original.id]} : null;
  function update(patch: Partial<OcrItem>) {
    if (!original) return;
    setEdits(previous => ({...previous, [original.id]: {...previous[original.id], ...patch}}));
    setConfirmed(previous => previous.filter(id => id !== original.id));
  }
  async function save(complete: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await request(`/api/drawings/${encodeURIComponent(drawingId)}/ocr/review`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({revision, reviewer, edits, confirmed_ids: confirmed, complete}),
      });
      onSaved();
    } catch(e) {setError(e instanceof Error ? e.message : '검토 저장 실패');}
    finally {setBusy(false);}
  }
  const field = 'w-full rounded border border-slate-300 p-1 text-xs';
  return <section className="space-y-3 border-b bg-slate-50 p-4 text-xs text-slate-800">
    <div className="flex justify-between"><b>OCR 관리자 검토</b>
      <button onClick={() => setAdmin(v => !v)} className="rounded border px-2 py-1">{admin ? '작업자 화면' : '관리자 편집'}</button></div>
    <p>{document.review?.completed ? '검토 완료' : '검토 대기'} · 수정 이력 {history.length}건</p>
    {admin && <fieldset disabled={busy} className="space-y-2">
      <p>역할 전환은 검토용 UI이며 계정 권한 인증은 포함하지 않습니다.</p>
      <label className="block">검토자<input className={field} value={reviewer} onChange={e => setReviewer(e.target.value)} /></label>
      {item && <div className="space-y-2 rounded border bg-white p-3">
        <b>선택 항목 {item.id}</b>
        <label className="block">OCR 인식값<input className={field} value={item.raw_text} onChange={e => update({raw_text: e.target.value})} /></label>
        {(['nominal_value', 'lower_limit', 'upper_limit'] as const).map((key, index) => <label key={key} className="block">{['기준 치수', '허용 하한', '허용 상한'][index]}
          <input type="number" step="any" className={field} value={item[key] ?? ''} onChange={e => update({[key]: e.target.value === '' ? null : Number(e.target.value)})} /></label>)}
        {(['feature_type', 'tol_type', 'measurement_characteristic'] as const).map((key, index) => <label key={key} className="block">{['형상 유형', '공차 유형', '측정 특성'][index]}
          <input className={field} value={item[key] || ''} onChange={e => update({[key]: e.target.value})} /></label>)}
        <label className="flex gap-2"><input type="checkbox" checked={confirmed.includes(item.id)} onChange={e => setConfirmed(previous => e.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />인식값·공차·좌표 확인 완료</label>
      </div>}
      <p>항목 확인 {confirmed.length}/{document.items.length} · 도면 또는 표에서 항목을 선택하세요.</p>
      <button disabled={!reviewer.trim()} onClick={() => void save(false)} className="rounded border px-2 py-1 disabled:opacity-40">수정 저장</button>
      <button disabled={!reviewer.trim() || confirmed.length !== document.items.length} onClick={() => void save(true)} className="ml-2 rounded bg-cyan-700 px-2 py-1 text-white disabled:opacity-40">검토 완료</button>
      <p>저장하면 OCR 버전이 변경됩니다. 이전 실측값과 오류 기록은 서버에 보존됩니다.</p>
    </fieldset>}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <details><summary>수정 이력 보기</summary>{history.map(entry => <article key={entry.review_id} className="my-2 rounded border p-2">
      <p>{entry.created_at} · {entry.reviewer} · {entry.completed ? '검토 완료' : '수정 저장'}</p>
      {entry.changes.map(change => <details key={change.item_id}><summary>{change.item_id}: {change.before.raw_text} → {change.after.raw_text}</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify({이전: change.before, 이후: change.after}, null, 2)}</pre></details>)}
    </article>)}</details>
  </section>;
}
