import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type ChipTone = "ok" | "warn" | "error" | "neutral" | "info";

const CHIP_CLASS: Record<ChipTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-white text-slate-600",
  info: "border-cyan-200 bg-cyan-50 text-cyan-800",
};

export function Chip({ tone, children, onClick }: { tone: ChipTone; children: ReactNode; onClick?: () => void }) {
  const className = `inline-flex max-w-full items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-tight ${CHIP_CLASS[tone]}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} underline-offset-2 hover:underline`}>
      {children}
    </button>
  ) : (
    <span className={className}>{children}</span>
  );
}

interface Props {
  number: number;
  total: number;
  title: string;
  rawText: string;
  itemId: string;
  onNavigate: (delta: number) => void;
  chips?: ReactNode;
}

/** 관리자·작업자 공통 항목 머리글: 번호, 항목명, 도면 표기, 이전/다음 이동, 상태 칩. */
export default function ItemHeader({ number, total, title, rawText, itemId, onNavigate, chips }: Props) {
  return (
    <header className="border-b border-slate-200 bg-white px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-px shrink-0 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[13px] font-semibold tabular-nums text-white">
          {String(number).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-snug text-slate-900">{title}</h2>
          <p className="mt-0.5 break-all font-mono text-[13px] font-medium text-slate-800">
            {rawText.replace(/\n/g, "  ")}
          </p>
          <p className="worker-item-id mt-0.5 truncate text-[11px] text-slate-400">{itemId}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-xs text-slate-500">
          <button
            type="button"
            aria-label="이전 항목"
            onClick={() => onNavigate(-1)}
            className="btn btn-secondary btn-icon h-6 w-6"
          >
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[44px] text-center font-mono text-[11px] tabular-nums">
            <b className="font-semibold text-slate-900">{number}</b>/{total}
          </span>
          <button
            type="button"
            aria-label="다음 항목"
            onClick={() => onNavigate(1)}
            className="btn btn-secondary btn-icon h-6 w-6"
          >
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {chips && <div className="mt-2 flex flex-wrap gap-1">{chips}</div>}
    </header>
  );
}

export function ProgressBar({ label, done, total, chips }: { label: string; done: number; total: number; chips?: ReactNode }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="text-slate-600">
          {label} <b className="font-mono font-semibold text-slate-900">{done}</b> / {total}
        </span>
        <span className="font-mono text-slate-400">{percent}%</span>
        <span className="flex-1" />
        {chips}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full bg-cyan-700 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
