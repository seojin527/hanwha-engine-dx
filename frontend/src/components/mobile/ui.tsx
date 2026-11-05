/**
 * 휴대폰 화면 공통 요소: 상단 바(뒤로·제목·메뉴), 전체 화면 보조 화면, 작업 모드 표시.
 */
import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";

export function MobileTopBar({
  title,
  subtitle,
  onBack,
  backLabel = "뒤로",
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-dx-line bg-dx-panel pr-1" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label={backLabel} className="flex h-12 w-11 shrink-0 items-center justify-center text-white active:bg-white/10">
          <ChevronLeft aria-hidden="true" className="h-6 w-6" />
        </button>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <div className="min-w-0 flex-1 py-1.5">
        <h1 className="truncate text-[16px] font-semibold leading-tight text-white">{title}</h1>
        {subtitle && <p className="truncate text-[12px] leading-tight text-dx-muted">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

/** 목록·내보내기 같은 보조 화면. 화면 전체를 덮고 닫으면 원래 화면으로 돌아간다. */
export function MobileOverlay({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[90] flex flex-col bg-dx-bg">
      <header className="flex min-h-14 shrink-0 items-center border-b border-dx-line bg-dx-panel pl-4" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold text-white">{title}</h2>
        <button type="button" onClick={onClose} aria-label="닫기" className="flex h-12 w-12 items-center justify-center text-white active:bg-white/10">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {footer && <div className="shrink-0 border-t border-dx-line bg-dx-panel p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>{footer}</div>}
    </div>
  );
}

export type WorkMode = "trial" | "save" | "view";

/** 체험(서버 저장 안 됨) · 실제 저장 · 조회 전용을 한눈에 구분한다 */
export function ModeBadge({ mode }: { mode: WorkMode }) {
  const style = {
    trial: "border-amber-300/40 bg-amber-300/15 text-amber-100",
    save: "border-emerald-300/40 bg-emerald-300/15 text-emerald-100",
    view: "border-slate-300/30 bg-white/5 text-slate-200",
  }[mode];
  const text = { trial: "체험 · 서버에 저장 안 됨", save: "실제 작업 · 서버 저장", view: "조회 전용" }[mode];
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}>{text}</span>;
}

export function MenuButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex h-12 w-11 shrink-0 items-center justify-center text-white active:bg-white/10">
      {icon}
    </button>
  );
}
