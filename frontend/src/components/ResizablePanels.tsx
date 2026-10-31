import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 작업 패널 위치. 기본은 오른쪽(기존 화면). ENGINE DX 셸은 왼쪽에 두고, 패널 위에 현재 엔진·부품·도면 맥락(header)을 붙인다.
 * 페이지(관리자·부품제작·조립·검증)는 이 값을 몰라도 된다.
 */
export const PanelLayoutContext = createContext<{ side: 'left' | 'right'; header?: ReactNode }>({ side: 'right' });

const STORAGE_KEY = 'drawing-workspace-panel-width-v1';
export function panelBounds(width: number) {
  const max = Math.max(120, Math.min(680, width * 0.65, width - 220));
  return {min: Math.min(260, max), max};
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function ResizablePanels({left, right, initialWidth, storageScope = ''}: {left: ReactNode; right: ReactNode; initialWidth?: number; storageScope?: string}) {
  const {side, header} = useContext(PanelLayoutContext);
  const onLeft = side === 'left';
  const storageKey = `${onLeft ? `${STORAGE_KEY}-left` : STORAGE_KEY}${storageScope ? `-${storageScope}` : ''}`;
  const defaultWidth = initialWidth ?? (onLeft ? 440 : 400);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [requested, setRequested] = useState(() => {
    try {const saved = Number(localStorage.getItem(storageKey)); if (saved >= 120 && saved <= 680) return saved;} catch {}
    return defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{id: number; x: number; width: number} | null>(null);
  const bounds = panelBounds(width || 1200);
  const panelWidth = clamp(requested, bounds.min, bounds.max);
  // 왼쪽 패널은 오른쪽으로 끌면 넓어지고, 오른쪽 패널은 왼쪽으로 끌면 넓어진다.
  const direction = onLeft ? 1 : -1;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (dragging) return;
    try {localStorage.setItem(storageKey, String(requested));} catch {}
  }, [requested, dragging, storageKey]);
  function stop(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const main = <div className="flex min-h-0 min-w-0 flex-1 flex-col">{left}</div>;
  const separator = <div role="separator" aria-label={onLeft ? '작업 패널과 도면 너비 조절' : '도면과 오른쪽 패널 너비 조절'} aria-orientation="vertical"
      aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)} aria-valuenow={Math.round(panelWidth)}
      aria-valuetext={`${onLeft ? '왼쪽' : '오른쪽'} 패널 ${Math.round(panelWidth)}픽셀`} tabIndex={0}
      title="좌우로 드래그 · 방향키로 조절 · 두 번 클릭하면 기본 너비"
      className={`group relative z-50 flex w-1.5 shrink-0 touch-none cursor-col-resize items-center justify-center outline-none transition-colors before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[''] focus-visible:bg-cyan-600 ${dragging ? 'bg-cyan-600' : onLeft ? 'bg-dx-line hover:bg-dx-accent-strong' : 'bg-slate-700 hover:bg-cyan-700'}`}
      onPointerDown={e => {if(e.button!==0)return; e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,width:panelWidth};setDragging(true);}}
      onPointerMove={e => {const d=drag.current;if(d?.id===e.pointerId)setRequested(clamp(d.width+direction*(e.clientX-d.x),bounds.min,bounds.max));}}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
      onDoubleClick={()=>setRequested(defaultWidth)}
      onKeyDown={e=>{let next=panelWidth;const step=(e.shiftKey?40:16)*direction;
        if(e.key==='ArrowRight')next+=step;else if(e.key==='ArrowLeft')next-=step;else if(e.key==='Home')next=bounds.min;else if(e.key==='End')next=bounds.max;else return;
        e.preventDefault();setRequested(clamp(next,bounds.min,bounds.max));}}>
      <span aria-hidden="true" className={`h-8 w-0.5 rounded-full ${dragging ? 'bg-white' : 'bg-slate-400 group-hover:bg-white'}`} />
    </div>;
  const aside = <aside className="flex min-h-0 shrink-0 flex-col bg-white" style={{width:panelWidth}} aria-label={onLeft ? '작업 패널' : '측정 상세 패널'}>
    {header}
    <div className="min-h-0 flex-1 overflow-y-auto">{right}</div>
  </aside>;
  return <div ref={container} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" style={dragging ? {cursor:'col-resize',userSelect:'none'} : undefined}>
    {onLeft ? <>{aside}{separator}{main}</> : <>{main}{separator}{aside}</>}
    {dragging && <div className="absolute inset-0 z-40" aria-hidden="true" />}
  </div>;
}
