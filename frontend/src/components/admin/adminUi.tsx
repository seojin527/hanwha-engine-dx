/** 관리자 메뉴(오류 DB 관리 · 작업 진행 현황)에서 함께 쓰는 작은 표시 요소. 부품·도면 선택 화면과 같은 어두운 회색 톤. */
import type { ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";

/** 도면 위치 열기 요청: 현재 OCR 버전 항목만 열 수 있다. */
export interface LocationTarget {
  part_id: string;
  drawing_id: string;
  revision: string;
  item_id: string;
}

export function Loading({ children = "불러오는 중…" }: { children?: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 p-3 text-xs text-neutral-400">
      <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      {children}
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="note note-error whitespace-pre-wrap">{message}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-4 text-center text-xs text-neutral-400">{children}</p>;
}

export function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return `${Math.round(value * 1000) / 10}%`;
}

export function ProgressBar({ value, tone = "cyan" }: { value: number | null | undefined; tone?: "cyan" | "emerald" }) {
  const width = value === null || value === undefined ? 0 : Math.min(100, Math.max(0, value * 100));
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-neutral-700">
      <span className={`block h-full ${tone === "emerald" ? "bg-emerald-400" : "bg-cyan-400"}`} style={{ width: `${width}%` }} />
    </span>
  );
}

/** 흐름 카드 사이 연결선 (업무 흐름 설명용, 순서 제약이 아님) */
export function FlowConnector() {
  return (
    <span aria-hidden="true" className="hidden shrink-0 items-center self-center text-neutral-500 md:flex">
      <span className="h-px w-4 bg-neutral-600" />
      <ChevronRight className="-ml-1 h-4 w-4" />
    </span>
  );
}

export function FlowCard({
  title,
  active,
  onClick,
  children,
  label,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`card flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5 text-left transition-colors ${
        active ? "!border-cyan-500 shadow-[inset_0_2px_0_var(--color-cyan-400)]" : "hover:!border-neutral-500"
      }`}
    >
      <span className="text-[11px] font-semibold text-neutral-300">{title}</span>
      {children}
    </button>
  );
}

const TONES = {
  ok: "bg-emerald-400/10 text-emerald-300",
  warn: "bg-amber-400/10 text-amber-300",
  bad: "bg-rose-400/10 text-rose-300",
  muted: "bg-neutral-700 text-neutral-300",
  info: "bg-cyan-400/10 text-cyan-300",
} as const;

export function Tag({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`tag ${TONES[tone]}`}>{children}</span>;
}
