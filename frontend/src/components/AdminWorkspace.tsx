import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminHeader } from './AdminHeader';
import { AdminDrawingViewer } from './AdminDrawingViewer';
import { AdminMeasurementTable } from './AdminMeasurementTable';
import { AdminChecklist } from './AdminChecklist';
import { EditHistoryPopover } from './EditHistoryPopover';
import { DrawingLibrary } from './DrawingLibrary';
import { apiUrl, fetchOcr, type Drawing } from '../lib/drawingAPI';
import { useDrawingOcr } from '../hooks/useDrawingOcr';
import { fetchDemoIndex, type DemoDrawingEntry, type DemoDrawingDoc, type DemoItem } from '../lib/demoDrawings';
import { applyEditToItem, buildConfirmRecords, buildPointsWithEdits, computeReadiness, diffEdit, makeAddedDimension, withAddedItems } from '../lib/admin/adminOverlay';
import { loadSegments, pickLineAt } from '../lib/admin/pickLine';
import type { Point } from '../lib/admin/highlights';
import type { AddDraft, AddedDimension, EditLogEntry, ItemEdit } from '../lib/admin/adminStore';
import { featureLabel } from '../lib/admin/featureTypes';
import type { OcrSnapshot } from '../lib/ocr';

type State = { edits: Record<string, ItemEdit>; added: AddedDimension[]; nextOrder: number };
const empty = (): State => ({edits: {}, added: [], nextOrder: 1});
type ServerDoc = NonNullable<OcrSnapshot['result']> & {
  review_base_items?: DemoItem[]; admin_ui_state?: State;
  review?: {completed: boolean; reviewer: string; completed_at?: number; confirmed_ids?: string[]};
};
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(apiUrl(path), body === undefined ? {signal} : {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
  return result;
}
export function AdminWorkspace({initialDrawing, onWorker}: {initialDrawing: Drawing | null; onWorker: (drawing: Drawing | null) => void}) {
  const [drawing, setDrawing] = useState(initialDrawing);
  const [snapshot, setSnapshot] = useState<OcrSnapshot | null>(null);
  const [references, setReferences] = useState<DemoDrawingEntry[]>([]);
  const [referenceId, setReferenceId] = useState(() => initialDrawing ? '' : localStorage.getItem('hanwha_demo_drawing_id') || 'HDH_63_01');
  const [state, setState] = useState<State>(empty);
  // 서버에 마지막으로 저장된(또는 처음 불러온) 상태. state 와 다르면 저장 안 된 변경이다.
  const [baseline, setBaseline] = useState<State>(empty);
  const [history, setHistory] = useState<EditLogEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selected, setSelected] = useState(1);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [uploadRequest, setUploadRequest] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{draft: AddDraft; step: 'lines'|'marker'; lines: Point[][]} | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const ocr = useDrawingOcr(referenceId ? null : drawing?.drawing_id || null);
  const serverDoc = snapshot?.result as ServerDoc | null;
  const doc: DemoDrawingDoc | null = serverDoc ? {...serverDoc, demo_id: snapshot!.drawing_id,
    image: {...serverDoc.image, file: ''},
    items: (serverDoc.review_base_items || serverDoc.items) as DemoItem[]} : null;
  const withAdded = useMemo(() => doc ? withAddedItems(doc, state.added) : null, [serverDoc, state.added]);
  const points = useMemo(() => withAdded ? buildPointsWithEdits(withAdded, [], state.edits, state.added) : [], [withAdded, state]);
  const readiness = computeReadiness(points);
  const active = points.find(p => p.id === selected) || points[0];
  const completedAt = serverDoc?.review?.completed ? serverDoc.review.completed_at || Date.now() : null;
  const key = snapshot?.drawing_id || '';
  function install(next: OcrSnapshot) {
    setSnapshot(next);
    const result = next.result as ServerDoc | null;
    const saved = result?.admin_ui_state;
    const loaded: State = saved ? saved
      : {...empty(), edits: Object.fromEntries((result?.review?.confirmed_ids || []).map(id => [id, {confirmed:true}]))};
    setState(loaded); setBaseline(loaded);
  }
  async function loadHistory(id: string) {
    const data = await request('/api/ocr-review/history/entries');
    return data.history.flatMap((entry: any) => {
      const at = Date.parse(entry.created_at.replace(' ','T')+'Z');
      const rows = entry.changes.flatMap((change: any) => {
        const before = change.before, after = change.after;
        const confirmation = change.confirmed_before !== change.confirmed_after ? [{itemNo:change.item_no || 0,itemName:change.item_id,field:'확인 상태',from:change.confirmed_before ? '확인 완료' : '미확인',to:change.confirmed_after ? '확인 완료' : '미확인'}] : [];
        if (!before || !after) return [{itemNo:change.item_no || 0,itemName:change.item_id,field: after ? '치수 추가' : '항목 삭제', from: before?.raw_text || '(없음)', to: after?.raw_text || '(삭제)'}];
        const labels: Record<string,string> = {raw_text:'도면 표기', nominal_value:'기준 치수', upper_limit:'상한', lower_limit:'하한', tolerance_value:'공차값', datum_references:'데이텀', equipment:'측정기', feature_type:'형상', upper_deviation:'상한 공차(+)',lower_deviation:'하한 공차(-)'};
        const show = (field: string, value: unknown) => field === 'feature_type' ? featureLabel(value as string | undefined) : JSON.stringify(value ?? '(없음)');
        return [...confirmation,...Object.entries(labels).filter(([field]) => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map(([field,label]) => ({
          itemNo:change.item_no || 0,itemName:change.item_id,field:label, from:show(field,before[field]), to:show(field,after[field]),
        }))];
      }).map((change:any,index:number) => ({...change,id:entry.review_id+'-'+index,at,drawingId:entry.drawing_id || id}));
      return [...rows, ...(!!entry.completed !== !!entry.previous_completed ? [{id:entry.review_id,at,drawingId:entry.drawing_id || id,itemNo:0,itemName:'도면 전체',field:'검토 상태',from:entry.previous_completed ? '검토 완료' : '미완료',to:entry.completed ? '검토 완료' : '완료 취소'}] : [])];
    }) as EditLogEntry[];
  }
  useEffect(() => {if (referenceId) localStorage.setItem('hanwha_demo_drawing_id',referenceId);}, [referenceId]);
  useEffect(() => {fetchDemoIndex().then(setReferences).catch(e => setError(e.message));}, []);
  useEffect(() => {
    const token = ++generation.current;
    const controller = new AbortController();
    setSnapshot(null); setState(empty()); setBaseline(empty()); setHistory([]); setAdding(null); setSelected(1); setError('');
    const load = referenceId ? request('/api/ocr-review/demo/'+encodeURIComponent(referenceId), {}, controller.signal)
      : drawing ? fetchOcr(drawing.drawing_id, controller.signal) : Promise.resolve(null);
    load.then(async (next: OcrSnapshot | null) => {
      if (!next || controller.signal.aborted || token !== generation.current) return;
      install(next);
      const rows = await loadHistory(next.drawing_id);
      if (!controller.signal.aborted && token === generation.current) setHistory(rows);
    }).catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [referenceId, drawing?.drawing_id]);
  useEffect(() => {
    if (!referenceId && ocr.snapshot?.result && (!snapshot?.result || ocr.snapshot.revision !== snapshot.revision)) install(ocr.snapshot);
  }, [ocr.snapshot]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {if (event.key === 'Escape') setAdding(null);};
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown',handler);
  }, []);
  async function persist(next: State, complete = false) {
    if (!withAdded || !snapshot?.revision || lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    const previousState = state; setState(next);
    const token = generation.current;
    try {
      const targetDoc = withAddedItems(doc!, next.added);
      const currentIds = new Set(serverDoc!.items.map(i => i.id));
      const edited = targetDoc.items.map(item => {
        const applied = applyEditToItem(item, next.edits[item.id]);
        return {...applied, equipment: next.edits[item.id]?.equipment ?? (item as any).equipment,
          ...(item.category === 'DIMENSION' && typeof applied.lower_limit === 'number' && typeof applied.upper_limit === 'number' ? {tol_type: item.measurement_characteristic === 'THREAD_SPEC' ? 'THREAD_SPEC' : 'DIMENSION'} : {})};
      });
      const allowed = ['raw_text','nominal_value','lower_limit','upper_limit','upper_deviation','lower_deviation','tolerance_value','datum_references','gdt_symbol','equipment','tol_type','feature_type','measurement_characteristic'];
      const edits = Object.fromEntries(edited.map(item => {
        const current = serverDoc!.items.find(i=>i.id===item.id) as any;
        return [item.id,Object.fromEntries(allowed.filter(field => (item as any)[field] !== undefined && (!current || JSON.stringify((item as any)[field]) !== JSON.stringify(current[field]))).map(field => [field,(item as any)[field]]))];
      }).filter(([,patch])=>Object.keys(patch).length));
      const nextSnapshot = await request('/api/drawings/'+encodeURIComponent(key)+'/ocr/review', {
        revision:snapshot.revision, reviewer:'관리자', edits,
        confirmed_ids: edited.filter(item => next.edits[item.id]?.confirmed).map(item => item.id),
        complete, ui_state:next, added_items:edited.filter(item => !currentIds.has(item.id)),
        removed_ids:serverDoc!.items.filter(item => (item as any).admin_added && !edited.some(e => e.id === item.id)).map(item => item.id),
      });
      if (token !== generation.current) return;
      install(nextSnapshot);
      const rows = await loadHistory(key).catch(() => {
        if (token === generation.current) setError('수정은 저장됐지만 이력을 불러오지 못했습니다. 다시 불러와주세요.');
        return null;
      });
      if (rows && token === generation.current) setHistory(rows);
      return true;
    } catch(e) {if (token === generation.current) {setState(previousState);setError(e instanceof Error ? e.message : '저장 실패');} return false;}
    finally {lock.current=false; setBusy(false);}
  }
  function commit(id: string, edit: ItemEdit | undefined) {
    // 서버에는 저장하지 않고 화면 상태에만 쌓는다. 검토 완료(변경 저장)를 누를 때 한 번에 저장한다.
    const edits = {...state.edits}; if (edit) edits[id]=edit; else delete edits[id];
    setState({...state, edits});
  }
  async function place(pt: Point) {
    if (!adding || lock.current) return;
    if (adding.step === 'lines') {
      try {
        const segments = referenceId.startsWith('HDH_63_') ? await loadSegments() : await request('/api/drawings/'+encodeURIComponent(key)+'/ocr/lines');
        const line = pickLineAt(segments,pt,20);
        if (line) setAdding(prev => prev ? {...prev,lines:[...prev.lines,line]} : null);
      } catch(e) {setError('도면 선 정보를 불러오지 못했습니다.');}
      return;
    }
    const entry = makeAddedDimension(state.nextOrder,adding.draft.kind,adding.draft.nominal,Math.round(pt.x),Math.round(pt.y),adding.lines);
    const {plus,minus,equipment} = adding.draft;
    setState({...state,nextOrder:state.nextOrder+1,added:[...state.added,entry],edits:{...state.edits,[entry.id]:{plus,minus,equipment}}});
    setSelected((doc?.items.length || 0)+state.added.length+1); setAdding(null);
  }
  // 저장하지 않은 변경 건수: 마지막으로 저장한 상태(baseline)와 다른 항목(수정·확인·추가·삭제)의 수
  const dirtyCount = useMemo(() => {
    const changed = new Set<string>();
    for (const id of new Set([...Object.keys(state.edits), ...Object.keys(baseline.edits)])) {
      if (JSON.stringify(state.edits[id] ?? null) !== JSON.stringify(baseline.edits[id] ?? null)) changed.add(id);
    }
    const before = new Set(baseline.added.map(item => item.id)), now = new Set(state.added.map(item => item.id));
    for (const id of before) if (!now.has(id)) changed.add(id);
    for (const id of now) if (!before.has(id)) changed.add(id);
    return changed.size;
  }, [state, baseline]);
  const confirmLeave = () => dirtyCount === 0 || window.confirm(`저장 안 된 변경 ${dirtyCount}건이 사라집니다. 이동할까요?`);
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);
  // 작업자 모드는 서버에 저장된 값을 보여 주므로, 모든 항목을 확인하고 "검토 완료"로 저장하기 전에는 넘어가지 못하게 막는다.
  // (불러온 항목이 없으면 확인할 대상이 없으므로 막지 않는다)
  function blockWorker() {
    if (points.length === 0) return false;
    if (readiness.ready) {
      if (completedAt && dirtyCount === 0) return false;
      setError('관리자 검토 완료(변경 저장)를 눌러 서버에 저장해야 작업자 모드로 전환할 수 있습니다.');
      return true;
    }
    const numbers = readiness.pendingNumbers;
    const shown = numbers.slice(0, 10).join(', ') + (numbers.length > 10 ? ` 외 ${numbers.length - 10}건` : '');
    setError(`미확인 항목 ${numbers.length}건이 남아 있어 작업자 모드로 전환할 수 없습니다. 모든 치수·기하공차를 확인해 주세요. (번호 ${shown})`);
    return true;
  }
  useEffect(() => {
    setError(prev => (readiness.ready && prev.startsWith('미확인 항목')) || (completedAt && dirtyCount === 0 && prev.startsWith('관리자 검토 완료(변경 저장)')) ? '' : prev);
  }, [readiness.ready, completedAt, dirtyCount]);
  const focused = collapsed && !sideOpen;
  const toolbar = <>
    <button type="button" onClick={() => setSideOpen(v=>!v)} className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700">{sideOpen ? '측정 패널 접기 ▶' : '◀ 측정 패널 펼치기'}</button>
    <button type="button" aria-pressed={focused} onClick={() => {setCollapsed(!focused);setSideOpen(focused);}} className={`rounded px-2 py-1 font-semibold ${focused ? 'bg-cyan-700 hover:bg-cyan-600' : 'bg-slate-800 hover:bg-slate-700'}`}>{focused ? '↙ 원래 화면' : '⛶ 도면 크게 보기'}</button>
  </>;
  const filtered = points.filter(p => `${p.displayNumber} ${p.feature.name} ${p.dimension.formatted}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans">
    <AdminHeader displayInfo={{partName:serverDoc?.part_name || '도면 선택',drawingName:referenceId || drawing?.original_filename || '—',partNo:(serverDoc as any)?.part_no,scale:(serverDoc as any)?.drawing_scale}}
      onUploadDrawing={()=>setUploadRequest(v=>v+1)} onResetData={()=>{setSelected(1);setSearch('');}} searchQuery={search} onSearchChange={setSearch}
      mode="admin" onModeChange={mode=>{if(mode==='worker' && !busy && blockWorker()) return; if(mode==='worker' && !busy) onWorker(drawing || (snapshot ? {drawing_id:key,part_id:'jm-reference',name:referenceId,original_filename:referenceId+'.jpg',media_type:'image/jpeg',size_bytes:0,ocr_status:'completed',created_at:'',file_url:'/api/drawings/'+key+'/file'} : null));}} historyOpen={historyOpen} historyCount={history.length} onToggleHistory={()=>setHistoryOpen(v=>!v)} />
    {historyOpen && <EditHistoryPopover entries={history} mode="admin" activeDrawingId={key || null} onClose={()=>setHistoryOpen(false)} onClear={async()=>{
      if(window.confirm('수정 내역을 모두 지우시겠습니까?')) {
        try {await request('/api/ocr-review/history/clear',{});setHistory([]);}
        catch(e) {setError(e instanceof Error ? e.message : '내역 정리 실패');}
      }
    }} />}
    <div className="flex shrink-0 items-center gap-2 border-b border-cyan-900 bg-cyan-950 px-4 py-1 text-[11px] text-cyan-200">
      <span className="rounded bg-cyan-700 px-1.5 py-0.5 font-bold text-white">관리자 모드</span>
      <span>수정한 값은 작업자 모드에도 반영됩니다. 확인·수정 내용은 "관리자 검토 완료"를 누를 때 서버에 한 번에 저장됩니다.</span>
      {dirtyCount > 0 && <span className="ml-auto rounded bg-amber-400 px-1.5 py-0.5 font-bold text-slate-900">저장 안 된 변경 {dirtyCount}건</span>}
    </div>
    <DrawingLibrary uploadRequest={uploadRequest} onSelectDrawing={d=>{if(!busy && confirmLeave()){setReferenceId('');setDrawing(d);}}} onClearDrawing={()=>{if(!busy && confirmLeave()){setDrawing(null);setReferenceId('');}}} />
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-1.5 text-xs">
      <span className="flex items-center gap-2 text-slate-300"><label htmlFor="demo-drawing" className="text-slate-400">데모 도면</label>
        <select id="demo-drawing" disabled={busy} value={referenceId} onChange={e=>{if(!confirmLeave())return;setReferenceId(e.target.value);if(e.target.value)setDrawing(null);}} className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-white focus:border-cyan-500 focus:outline-none">
          <option value="">등록 도면</option>{references.map(entry=><option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        <span>측정항목 {points.length}건 (치수 {points.filter(p=>p.feature.type!=='GD&T').length} · 기하공차 {points.filter(p=>p.feature.type==='GD&T').length}) · 도면 추출 결과에서 자동 생성{completedAt ? ' · 관리자 검토 완료' : ''}</span>
      </span>
      {!referenceId && drawing && <button disabled={busy || ocr.status==='applying'} onClick={()=>void ocr.run()} className="rounded border border-cyan-700 bg-cyan-950 px-3 py-1 text-cyan-200">{ocr.status==='applying' ? ocr.stage : 'OCR 실행'}</button>}
    </div>
    {(error || ocr.error) && <p role="alert" className="shrink-0 bg-rose-950 px-4 py-2 text-xs text-rose-200">{error || ocr.error}</p>}
    {busy && <p role="status" className="shrink-0 bg-cyan-950 px-4 py-1 text-xs text-cyan-200">서버에 저장 중…</p>}
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-800">
        <AdminDrawingViewer key={key} drawingUrl={snapshot?.result ? apiUrl('/api/drawings/'+key+'/ocr/image') : drawing ? apiUrl(drawing.file_url) : null}
          mediaType={snapshot?.result ? 'image/jpeg' : drawing?.media_type} points={filtered}
          coordinateSize={doc ? {width:doc.image.width_px,height:doc.image.height_px} : undefined}
          selectedPointId={active?.id || 0} onSelectPoint={setSelected} inspectionRecords={buildConfirmRecords(points)}
          isAnalyzing={ocr.status==='applying'} analyzingStep={0} toolbarRight={toolbar}
          highlightLines={adding ? adding.lines : null} onPlaceAt={adding && !busy ? place : undefined} />
        <AdminMeasurementTable collapsed={collapsed} onToggleCollapsed={()=>setCollapsed(v=>!v)} points={filtered}
          selectedPointId={active?.id || 0} onSelectPoint={setSelected} inspectionRecords={buildConfirmRecords(points)}
          selectedItemId={active?.items?.[0]?.id || ''} onSelectItem={id=>setSelected(id)} />
      </div>
      {!sideOpen && <button type="button" onClick={()=>setSideOpen(true)} aria-label="측정 패널 펼치기" className="flex w-9 shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white py-4 text-xs font-bold text-slate-600 shadow-xl hover:bg-slate-50 hover:text-slate-900"><span>◀</span><span className="[writing-mode:vertical-rl]">측정 패널 펼치기</span></button>}
      <div className={`${sideOpen ? 'flex' : 'hidden'} w-[39.5%] min-w-[420px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl`}>
        {withAdded && points.length ? <fieldset disabled={busy} className="contents">
          <AdminChecklist doc={withAdded} points={points} edits={state.edits} selectedPointId={active?.id || 0} onSelectPoint={setSelected}
            onCommitEdit={commit} readiness={readiness} completedAt={completedAt} dirtyCount={dirtyCount} onComplete={()=>void persist(state,true)} onReopen={()=>void persist(state,false)}
            placing={adding ? {step:adding.step,lineCount:adding.lines.length,text:`${adding.draft.kind} ${adding.draft.nominal}`} : null}
            onStartAdd={draft=>setAdding({draft,step:'lines',lines:[]})} onUndoLine={()=>setAdding(prev=>prev ? {...prev,lines:prev.lines.slice(0,-1)} : null)}
            onFinishLines={()=>setAdding(prev=>prev ? {...prev,step:'marker'} : null)} onCancelAdd={()=>setAdding(null)}
            onDeleteAdded={id=>{if(window.confirm('추가 항목을 삭제하시겠습니까?')){const edits={...state.edits};delete edits[id];setState({...state,edits,added:state.added.filter(item=>item.id!==id)});setSelected(1);}}} />
        </fieldset> : <p className="p-5 text-xs text-slate-500">{ocr.status==='applying' ? 'CPU OCR 분석 중…' : '도면을 선택하고 추출 결과를 불러와주세요.'}</p>}
      </div>
    </div>
  </div>;
}
