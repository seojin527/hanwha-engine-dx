import type { ReactNode } from "react";

export type ChipTone = "ok" | "warn" | "error" | "neutral" | "info";

const CHIP_CLASS: Record<ChipTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  info: "border-cyan-200 bg-cyan-50 text-cyan-800",
};

export function Chip({ tone, children, onClick }: { tone: ChipTone; children: ReactNode; onClick?: () => void }) {
  const className = `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${CHIP_CLASS[tone]}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} hover:brightness-95`}>
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

/** 관리자·작업자 공통 항목 머리글: 번호, 항목명, 도면 표기, ◀▶ 이동, 상태 칩. */
export default function ItemHeader({ number, total, title, rawText, itemId, onNavigate, chips }: Props) {
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 rounded-md bg-slate-900 px-2 py-1 text-sm font-extrabold text-cyan-400">
          {String(number).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-extrabold text-slate-900">
            <span>{title}</span>
            <span className="break-all font-mono text-sm font-bold text-slate-700">
              {rawText.replace(/\n/g, "  ")}
            </span>
          </h2>
          <p className="text-[11px] text-slate-500">{itemId}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
          <button
            type="button"
            aria-label="이전 항목"
            onClick={() => onNavigate(-1)}
            className="rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-100"
          >
            ◀
          </button>
          <span>
            <b className="text-slate-900">{number}</b>/{total}
          </span>
          <button
            type="button"
            aria-label="다음 항목"
            onClick={() => onNavigate(1)}
            className="rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-100"
          >
            ▶
          </button>
        </div>
      </div>
      {chips && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
    </header>
  );
}

export function ProgressBar({ label, done, total, chips }: { label: string; done: number; total: number; chips?: ReactNode }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <b className="text-slate-800">
          {label} {done} / {total}
        </b>
        <span className="flex-1" />
        {chips}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-cyan-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
