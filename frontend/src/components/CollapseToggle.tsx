import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface CollapseToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  /** 접기·펼치기 대상 이름 (스크린리더용) */
  label: string;
  /** 어두운 배경 위에 놓일 때 */
  tone?: "light" | "dark";
}

// 섹션 머리줄 오른쪽에 붙는 접기/펼치기 버튼
export const CollapseToggle: React.FC<CollapseToggleProps> = ({
  collapsed,
  onToggle,
  label,
  tone = "light",
}) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onToggle();
    }}
    aria-expanded={!collapsed}
    aria-label={`${label} ${collapsed ? "펼치기" : "접기"}`}
    className={`flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${
      tone === "dark"
        ? "text-slate-300 hover:bg-slate-700 hover:text-white"
        : "text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
    }`}
  >
    {collapsed ? "펼치기" : "접기"}
    {collapsed ? (
      <ChevronDown className="h-3.5 w-3.5" />
    ) : (
      <ChevronUp className="h-3.5 w-3.5" />
    )}
  </button>
);
