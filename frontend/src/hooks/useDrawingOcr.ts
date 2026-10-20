import { useEffect, useRef, useState } from 'react';
import { apiUrl, fetchOcr } from '../lib/drawingAPI';
import type { OcrSnapshot } from '../lib/ocr';

type State = {
  drawingId: string | null;
  status: 'idle' | 'loading' | 'applying' | 'ready' | 'error';
  snapshot: OcrSnapshot | null;
  error: string;
  stage: string;
};
const empty = (drawingId: string | null): State => ({drawingId, status: 'idle', snapshot: null, error: '', stage: ''});

async function prepare(snapshot: OcrSnapshot, signal: AbortSignal) {
  if (!snapshot.result || !snapshot.image_url) return snapshot;
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload=null; image.onerror=null;};
    const abort = () => {cleanup(); reject(new Error('조회 중단'));};
    const timer = setTimeout(() => {cleanup();reject(new Error('OCR 결과 이미지 응답 시간이 초과됐습니다.'));},15000);
    signal.addEventListener('abort',abort,{once:true});
    image.onload = () => {
      cleanup();
      const size=snapshot.result!.image;
      if (image.naturalWidth!==size.width_px || image.naturalHeight!==size.height_px) reject(new Error('OCR JPG와 JSON 크기가 다릅니다.'));
      else resolve();
    };
    image.onerror=()=>{cleanup();reject(new Error('저장된 OCR 결과 이미지를 불러오지 못했습니다.'));};
    if (signal.aborted) {abort();return;}
    image.src=apiUrl(snapshot.image_url!);
  });
  return snapshot;
}

export function useDrawingOcr(drawingId: string | null) {
  const [state,setState]=useState<State>(()=>empty(drawingId));
  const [reload,setReload]=useState(0);
  const sequence=useRef(0);
  const activeId=useRef(drawingId);activeId.current=drawingId;
  const starting=useRef(false);
  useEffect(()=>{
    const token=++sequence.current;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout> | undefined;
    setState({...empty(drawingId),status:drawingId?'loading':'idle'});
    if (!drawingId) return ()=>controller.abort();
    async function poll() {
      try {
        let snapshot=await fetchOcr(drawingId!,controller.signal);
        if (snapshot.drawing_id!==drawingId) throw new Error('다른 도면의 결과가 반환됐습니다.');
        if (controller.signal.aborted || token!==sequence.current) return;
        const working=snapshot.status==='queued'||snapshot.status==='running';
        if (!working && snapshot.result) snapshot=await prepare(snapshot,controller.signal);
        if (controller.signal.aborted || token!==sequence.current) return;
        const error=snapshot.status==='failed' ? snapshot.job?.error || 'OCR 실행에 실패했습니다.' : '';
        setState({drawingId,snapshot,status:working?'applying':error?'error':snapshot.result?'ready':'idle',error,stage:snapshot.job?.stage || ''});
        if (working) timer=setTimeout(()=>void poll(),2000);
      } catch(e) {
        if (!controller.signal.aborted && token===sequence.current) setState(p=>({...p,status:'error',error:e instanceof Error?e.message:'OCR 상태 조회 실패'}));
      }
    }
    void poll();
    return ()=>{controller.abort();if(timer)clearTimeout(timer);++sequence.current;};
  },[drawingId,reload]);

  async function run() {
    if (!drawingId || starting.current) return;
    starting.current=true;
    const target=drawingId; const token=++sequence.current;
    setState(p=>({...p,drawingId:target,status:'applying',error:'',stage:'OCR 작업 요청 중'}));
    try {
      const response=await fetch(apiUrl(`/api/drawings/${encodeURIComponent(target)}/ocr/run`),{method:'POST'});
      const body=await response.json();
      if (!response.ok) throw new Error(typeof body.detail==='string'?body.detail:`OCR 요청 실패 (${response.status})`);
      if (activeId.current===target && token===sequence.current) setReload(v=>v+1);
    } catch(e) {
      if (activeId.current===target && token===sequence.current) setState(p=>({...p,status:'error',error:e instanceof Error?e.message:'OCR 요청 실패'}));
    } finally {starting.current=false;}
  }
  return {...(state.drawingId===drawingId?state:empty(drawingId)),run,refresh: () => setReload(v => v + 1)};
}
