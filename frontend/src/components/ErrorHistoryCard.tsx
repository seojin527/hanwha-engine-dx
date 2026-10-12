import React from "react";
import { ErrorHistoryItem } from "../data/mockHistory";
import { AlertOctagon, AlertTriangle, Info, Calendar } from "lucide-react";

interface ErrorHistoryCardProps {
  error: ErrorHistoryItem;
}

export const ErrorHistoryCard: React.FC<ErrorHistoryCardProps> = ({ error }) => {
  // Severity visual styling
  const severityConfig = {
    HIGH: {
      badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
      accentBorder: "border-l-rose-500",
      icon: <AlertOctagon className="w-3.5 h-3.5 text-rose-600 shrink-0" />,
      label: "심각 (HIGH)",
    },
    MEDIUM: {
      badgeBg: "bg-amber-50 text-amber-700 border-amber-200",
      accentBorder: "border-l-amber-500",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />,
      label: "경고 (MEDIUM)",
    },
    LOW: {
      badgeBg: "bg-blue-50 text-blue-700 border-blue-200",
      accentBorder: "border-l-blue-400",
      icon: <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />,
      label: "주의 (LOW)",
    },
  }[error.severity];

  return (
    <div
      className={`bg-white border border-slate-200 rounded p-2.5 shadow-2xs border-l-4 ${severityConfig.accentBorder} space-y-1.5`}
    >
      {/* Title & Metadata Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {severityConfig.icon}
          <h5 className="text-xs font-bold text-slate-900 truncate">
            {error.title}
          </h5>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border ${severityConfig.badgeBg}`}
          >
            {severityConfig.label}
          </span>
          <span className="flex items-center gap-0.5 text-[10px] font-mono text-slate-500">
            <Calendar className="w-3 h-3 text-slate-400" />
            {error.occurredAt}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-[11px] text-slate-700 leading-snug bg-slate-50/80 px-2 py-1.5 rounded border border-slate-150">
        {error.description}
      </p>

      {/* Cause & Corrective Action 2-Column Grid */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="bg-slate-50 p-1.5 rounded border border-slate-200">
          <span className="text-[10px] font-semibold text-slate-500 block uppercase leading-none mb-1">
            원인 (Root Cause)
          </span>
          <span className="text-slate-800 leading-tight block">
            {error.cause}
          </span>
        </div>

        <div className="bg-slate-50 p-1.5 rounded border border-slate-200">
          <span className="text-[10px] font-semibold text-slate-500 block uppercase leading-none mb-1">
            조치 (Corrective Action)
          </span>
          <span className="text-slate-800 leading-tight block">
            {error.correctiveAction}
          </span>
        </div>
      </div>

      {/* Prevention rule highlight */}
      <div className="text-[11px] text-slate-600 flex items-baseline gap-1 pt-0.5">
        <span className="text-[10px] font-bold text-blue-700 shrink-0">
          재발 방지책:
        </span>
        <span className="text-slate-700 text-[11px] font-medium truncate">
          {error.preventionRule}
        </span>
      </div>
    </div>
  );
};
