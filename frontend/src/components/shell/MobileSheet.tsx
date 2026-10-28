/**
 * 휴대폰용 하단 시트. 뒤의 3D·도면을 가리지 않도록 평소에는 한 줄(peek)만 보인다.
 * 가로 화면에서는 오른쪽 아래 카드로 붙고, 펼치면 오른쪽 전체 높이를 쓴다 (왼쪽 절반은 3D·도면).
 * 손잡이를 누르면 반/전체로 펼치고, 위아래로 끌어 단계를 바꾼다.
 * 내용은 접혀 있어도 마운트를 유지한다 (트리 펼침·탭 상태 보존).
 */
import { useRef, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { useLandscapePhone } from "../../hooks/useCompactLayout";

export type SheetState = "peek" | "half" | "full";
const ORDER: SheetState[] = ["peek", "half", "full"];

export function MobileSheet({
  label,
  state,
  onStateChange,
  summary,
  children,
}: {
  label: string;
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  /** 접혀 있을 때 보이는 한 줄 (현재 선택 등) */
  summary: ReactNode;
  children: ReactNode;
}) {
  const drag = useRef<{ id: number; y: number } | null>(null);
  // 끌어서 단계를 바꾼 직후 따라오는 click 은 무시한다 (탭·키보드는 click 으로 접고 편다).
  const dragged = useRef(false);
  const step = (delta: number) => {
    const index = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(state) + delta));
    onStateChange(ORDER[index]);
  };
  const landscape = useLandscapePhone();
  const height = state === "peek" ? undefined : landscape || state === "full" ? "calc(100% - 8px)" : "min(56%, 560px)";

  return (
    <section
      aria-label={label}
      className={`absolute bottom-0 z-30 flex flex-col border-t border-dx-line-strong bg-dx-panel shadow-[0_-8px_24px_rgba(0,0,0,0.45)] ${
        landscape ? "right-0 rounded-tl-xl border-l" : "inset-x-0 rounded-t-xl"
      }`}
      style={{ height, width: landscape ? "min(380px, 48%)" : undefined, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="flex shrink-0 touch-none items-center gap-2 px-3 pb-2 pt-1.5"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button[data-sheet-action]")) return;
          dragged.current = false;
          drag.current = { id: event.pointerId, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          drag.current = null;
          if (!start || start.id !== event.pointerId) return;
          const moved = event.clientY - start.y;
          if (Math.abs(moved) < 32) return;
          dragged.current = true;
          step(moved < 0 ? 1 : -1);
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        <button
          type="button"
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            onStateChange(state === "peek" ? "half" : "peek");
          }}
          aria-expanded={state !== "peek"}
          aria-label={state === "peek" ? `${label} 펼치기` : `${label} 접기`}
          className="flex min-w-0 flex-1 flex-col items-stretch gap-1.5 text-left"
        >
          <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-dx-line-strong" />
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1">{summary}</span>
            {state === "peek" ? <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-dx-muted" /> : <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-dx-muted" />}
          </span>
        </button>
        {state !== "peek" && !landscape && (
          <button
            type="button"
            data-sheet-action
            aria-label={state === "full" ? "반만 펼치기" : "전체로 펼치기"}
            onClick={() => onStateChange(state === "full" ? "half" : "full")}
            className="dx-btn dx-btn-ghost dx-icon-btn h-8 w-8 shrink-0 self-end"
          >
            {state === "full" ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className={`min-h-0 flex-1 flex-col overflow-hidden border-t border-dx-line ${state === "peek" ? "hidden" : "flex"}`}>{children}</div>
    </section>
  );
}
