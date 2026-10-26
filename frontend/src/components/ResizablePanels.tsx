import { useEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'drawing-workspace-panel-width-v1';
export function panelBounds(width: number) {
  const max = Math.max(120, Math.min(680, width * 0.65, width - 220));
  return {min: Math.min(260, max), max};
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function ResizablePanels({left, right}: {left: ReactNode; right: ReactNode}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [requested, setRequested] = useState(() => {
    try {const saved = Number(localStorage.getItem(STORAGE_KEY)); if (saved >= 120 && saved <= 680) return saved;} catch {}
    return 400;
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{id: number; x: number; width: number} | null>(null);
  const bounds = panelBounds(width || 1200);
  const panelWidth = clamp(requested, bounds.min, bounds.max);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (dragging) return;
    try {localStorage.setItem(STORAGE_KEY, String(requested));} catch {}
  }, [requested, dragging]);
  function stop(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={container} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" style={dragging ? {cursor:'col-resize',userSelect:'none'} : undefined}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{left}</div>
    {dragging && <div className="absolute inset-0 z-40" aria-hidden="true" />}
    <div role="separator" aria-label="도면과 오른쪽 패널 너비 조절" aria-orientation="vertical"
      aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(panelWidth)}
      aria-valuetext={`오른쪽 패널 ${Math.round(panelWidth)}픽셀`} tabIndex={0}
      title="좌우로 드래그 · 방향키로 조절 · 두 번 클릭하면 기본 너비"
      className={`group relative z-50 flex w-1.5 shrink-0 touch-none cursor-col-resize items-center justify-center outline-none transition-colors before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[''] focus-visible:bg-cyan-600 ${dragging ? 'bg-cyan-600' : 'bg-slate-700 hover:bg-cyan-700'}`}
      onPointerDown={e => {if(e.button!==0)return; e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,width:panelWidth};setDragging(true);}}
      onPointerMove={e => {const d=drag.current;if(d?.id===e.pointerId)setRequested(clamp(d.width+d.x-e.clientX,bounds.min,bounds.max));}}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
      onDoubleClick={()=>setRequested(400)}
      onKeyDown={e=>{let next=panelWidth;const step=e.shiftKey?40:16;
        if(e.key==='ArrowLeft')next+=step;else if(e.key==='ArrowRight')next-=step;else if(e.key==='Home')next=bounds.min;else if(e.key==='End')next=bounds.max;else return;
        e.preventDefault();setRequested(clamp(next,bounds.min,bounds.max));}}>
      <span aria-hidden="true" className={`h-8 w-0.5 rounded-full ${dragging ? 'bg-white' : 'bg-slate-400 group-hover:bg-white'}`} />
    </div>
    <aside className="flex min-h-0 shrink-0 flex-col overflow-y-auto bg-white" style={{width:panelWidth}} aria-label="측정 상세 패널">{right}</aside>
  </div>;
}
