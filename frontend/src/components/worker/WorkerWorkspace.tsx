import { useContext, useEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { BookOpen, Ruler, ScanLine, X } from 'lucide-react';
import { PanelLayoutContext, ResizablePanels } from '../ResizablePanels';

/** Worker-only layout: measurement | drawing + existing table | support. */
export function WorkerWorkspace({ left, right, support }: { left: ReactNode; right: ReactNode; support: ReactNode }) {
  const context = useContext(PanelLayoutContext);
  const workspace = useRef<HTMLDivElement>(null);
  const [requestedWidth, setRequestedWidth] = useState(() => {
    try { const value = Number(localStorage.getItem('dx.worker-support-width')); if (Number.isFinite(value) && value >= 240 && value <= 620) return value; } catch {}
    return 340;
  });
  const [availableWidth, setAvailableWidth] = useState(1200);
  const [measurementWidth, setMeasurementWidth] = useState(360);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  // Reserve drawing space even when the left measurement panel is resized.
  const maxWidth = Math.max(240, Math.min(620, availableWidth - measurementWidth - 372));
  const minWidth = Math.min(280, maxWidth);
  const supportWidth = Math.max(minWidth, Math.min(maxWidth, requestedWidth));
  useEffect(() => {
    const container = workspace.current;
    if (!container) return;
    const measurement = container.querySelector<HTMLElement>('[aria-label="작업 패널"]');
    const readSizes = () => {
      const width = container.getBoundingClientRect().width;
      const left = measurement?.getBoundingClientRect().width;
      if (width) setAvailableWidth(width);
      if (left) setMeasurementWidth(left);
    };
    readSizes();
    const observer = new ResizeObserver(readSizes);
    observer.observe(container);
    if (measurement) observer.observe(measurement);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (dragging) return;
    try { localStorage.setItem('dx.worker-support-width', String(requestedWidth)); } catch {}
  }, [requestedWidth, dragging]);
  const clampWidth = (width: number) => Math.max(minWidth, Math.min(maxWidth, width));
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  // The responsive drawer uses the same mounted form: closing it preserves draft input.
  useEffect(() => {
    if (panel.current) panel.current.inert = !open && window.matchMedia('(max-width: 1179px)').matches;
    const media = window.matchMedia('(max-width: 1179px)');
    const sync = () => { if (panel.current) panel.current.inert = !open && media.matches; };
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [open]);
  return (
    <div ref={workspace} className="worker-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden" style={dragging ? { cursor: 'col-resize', userSelect: 'none' } : undefined}>
      <div className="worker-main flex min-h-0 min-w-0 flex-1">
        <PanelLayoutContext.Provider value={{ ...context, side: 'left' }}>
          <ResizablePanels initialWidth={360} storageScope="worker"
            left={<section aria-label="도면 및 측정항목" className="worker-center flex min-h-0 min-w-0 flex-1 flex-col"><PaneHeading icon={<ScanLine aria-hidden="true" size={17} />} title="도면·측정 위치" description="도면 번호를 눌러 항목 선택" />{left}</section>}
            right={<div className="worker-measurement min-h-full">
              <PaneHeading icon={<Ruler aria-hidden="true" size={17} />} title="측정·판정" description="실측값 입력과 결과 저장" />
              {right}
            </div>}
          />
        </PanelLayoutContext.Provider>
      </div>
      <div role="separator" aria-label="도면과 오류 사례 너비 조절" aria-orientation="vertical"
        aria-valuemin={Math.round(minWidth)} aria-valuemax={Math.round(maxWidth)} aria-valuenow={Math.round(supportWidth)}
        aria-valuetext={`오류 사례 패널 ${Math.round(supportWidth)}픽셀`} tabIndex={0}
        title="드래그 또는 방향키로 너비 조절 · 두 번 클릭하면 기본 너비"
        className={`worker-support-resizer ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, width: supportWidth }; setDragging(true);
        }}
        onPointerMove={event => {
          const current = drag.current;
          if (current?.id === event.pointerId) setRequestedWidth(clampWidth(current.width + current.x - event.clientX));
        }}
        onPointerUp={event => {
          if (drag.current?.id !== event.pointerId) return;
          drag.current = null; setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
        onDoubleClick={() => setRequestedWidth(340)}
        onKeyDown={event => {
          const step = event.shiftKey ? 40 : 16;
          const next = event.key === 'ArrowLeft' ? supportWidth + step : event.key === 'ArrowRight' ? supportWidth - step
            : event.key === 'Home' ? minWidth : event.key === 'End' ? maxWidth : null;
          if (next === null) return;
          event.preventDefault(); setRequestedWidth(clampWidth(next));
        }}
      ><span aria-hidden="true" /></div>
      <button ref={toggle} type="button" className="worker-support-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}>
        <BookOpen aria-hidden="true" className="h-4 w-4" />측정 가이드
      </button>
      <aside ref={panel} id={panelId} aria-label="주의사항 및 오류 사례" className={`worker-support ${open ? 'is-open' : ''}`} style={{ '--worker-support-width': `${supportWidth}px` } as CSSProperties}>
        <PaneHeading icon={<BookOpen aria-hidden="true" size={17} />} title="측정 가이드" description="선택 항목의 주의사항·참고 사례"
          action={<button ref={close} type="button" className="worker-support-close" aria-label="오류 사례 패널 닫기" onClick={() => { setOpen(false); toggle.current?.focus(); }}><X className="h-4 w-4" /></button>} />
        <div className="worker-support-content">{support}</div>
      </aside>
      {dragging && <div className="absolute inset-0 z-40" aria-hidden="true" />}
    </div>
  );
}

function PaneHeading({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <header className="worker-pane-heading">
    <span className="worker-pane-icon">{icon}</span>
    <div><h2>{title}</h2><p>{description}</p></div>
    {action}
  </header>;
}
