import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BookOpen, X } from 'lucide-react';
import { PanelLayoutContext, ResizablePanels } from '../ResizablePanels';

/** Worker-only layout: measurement | drawing + existing table | support. */
export function WorkerWorkspace({ left, right, support }: { left: ReactNode; right: ReactNode; support: ReactNode }) {
  const context = useContext(PanelLayoutContext);
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
    <div className="worker-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="worker-main flex min-h-0 min-w-0 flex-1">
        <PanelLayoutContext.Provider value={{ ...context, side: 'left' }}>
          <ResizablePanels initialWidth={360} storageScope="worker"
            left={<section aria-label="도면 및 측정항목" className="worker-center flex min-h-0 min-w-0 flex-1 flex-col">{left}</section>}
            right={<div className="worker-measurement min-h-full">{right}</div>}
          />
        </PanelLayoutContext.Provider>
      </div>
      <button ref={toggle} type="button" className="worker-support-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}>
        <BookOpen aria-hidden="true" className="h-4 w-4" />주의사항 · 오류 사례
      </button>
      <aside ref={panel} id={panelId} aria-label="주의사항 및 오류 사례" className={`worker-support ${open ? 'is-open' : ''}`}>
        <div className="worker-support-heading">
          <span><BookOpen aria-hidden="true" className="h-4 w-4 text-slate-400" /><b>주의사항 · 오류 사례</b></span>
          <button ref={close} type="button" className="worker-support-close" aria-label="오류 사례 패널 닫기" onClick={() => { setOpen(false); toggle.current?.focus(); }}><X className="h-4 w-4" /></button>
        </div>
        <div className="worker-support-content">{support}</div>
      </aside>
    </div>
  );
}
