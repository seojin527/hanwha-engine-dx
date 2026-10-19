import { useEffect, useRef, useState } from 'react';
import { fetchMeasurements, saveMeasurement, type MeasurementRecord } from '../lib/pointAPI';
import { toleranceText, type OcrItem } from '../lib/ocr';

export function MeasurementEntry({drawingId, revision, item, onSaved}: {
  drawingId: string; revision: string; item: OcrItem; onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [instrument, setInstrument] = useState('');
  const [note, setNote] = useState('');
  const [record, setRecord] = useState<MeasurementRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => { alive.current = true; return () => {alive.current = false;}; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoaded(false); setError('');
    fetchMeasurements(drawingId, revision, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if (response.drawing_id !== drawingId || response.revision !== revision) throw new Error('도면 결과가 변경됐습니다.');
      const saved = response.records.find(r => r.item_id === item.id) || null;
      setRecord(saved); setValue(saved?.measured_value || '');
      setInstrument(saved?.instrument || ''); setNote(saved?.note || '');
      setDirty(false); setLoaded(true); setLoading(false);
    }).catch(e => { if (!controller.signal.aborted) {setError(e.message); setLoading(false);} });
    return () => controller.abort();
  }, [drawingId, revision, item.id, reload]);
  async function save() {
    if (lock.current) return;
    if (!value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value))) {
      setError('실측값에는 유효한 숫자를 입력해주세요.'); return;
    }
    lock.current = true; setSaving(true); setError('');
    try {
      const saved = await saveMeasurement(drawingId, item.id, {revision, measured_value: value.trim(), instrument, note});
      if (!alive.current) return;
      setRecord(saved); setDirty(false); onSaved();
    } catch (e) {if (alive.current) setError(e instanceof Error ? e.message : '저장 실패');}
    finally {lock.current = false; if (alive.current) setSaving(false);}
  }
  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none';
  const status = dirty ? '변경됨 · 저장 필요' : record ? ({pass: 'OK — 규격 적합', fail: 'NG — 규격 이탈', review: '저장됨 · 판정 보류'}[record.judgement]) : '측정 대기';
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
    <h3 className="text-xs font-bold text-slate-700">측정 결과 및 판정</h3>
    <div className="rounded-lg border bg-white p-3"><p className="text-[11px] text-slate-400">기준 치수 및 허용 범위</p>
      <p className="mt-1 font-mono text-sm font-bold">{item.raw_text}</p><p className="mt-1 text-xs text-cyan-700">허용 범위: {toleranceText(item)}</p></div>
    {loading ? <p role="status" className="text-xs">저장된 실측값 불러오는 중…</p> : <>
      <label className="block text-xs font-bold">실측값 입력 (Measured Value){item.unit ? ` · ${item.unit}` : ''}
        <input aria-label="실측값" inputMode="decimal" value={value} disabled={saving || !loaded} onChange={e => {setValue(e.target.value); setDirty(true);}} placeholder="실측값을 입력하세요" className={field + ' font-mono'} /></label>
      <label className="block text-xs">사용 계측기<input value={instrument} disabled={saving || !loaded} onChange={e => {setInstrument(e.target.value); setDirty(true);}} className={field} placeholder="사용한 계측기" /></label>
      <label className="block text-xs">측정 메모<textarea value={note} disabled={saving || !loaded} onChange={e => {setNote(e.target.value); setDirty(true);}} className={field} rows={2} /></label>
      <div className="flex items-center justify-between gap-2"><span className={`rounded px-2 py-1 text-xs font-bold ${!dirty && record?.judgement === 'pass' ? 'bg-emerald-100 text-emerald-800' : !dirty && record?.judgement === 'fail' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{status}</span>
        <button disabled={saving || !loaded || !dirty || !value.trim()} onClick={save} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{saving ? '저장 중…' : '실측값 저장'}</button></div>
      {!dirty && record && <p className="text-[11px] text-slate-500">{record.judgement_reason}</p>}
      <p className="text-[11px] text-slate-500">미저장 입력은 포인트 이동 시 사라집니다. 기준이 미확정이면 자동 판정을 보류합니다.</p>
    </>}
    {error && <p role="alert" className="text-xs text-rose-700">{error} <button type="button" onClick={() => setReload(v => v + 1)} className="underline">다시 불러오기</button></p>}
  </section>;
}
