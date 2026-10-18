import React from "react";
import { PreInspectionNotice } from "../data/mockData";
import { Info, AlertCircle } from "lucide-react";

interface PreInspectionNoticesProps {
  notices: PreInspectionNotice[];
}

export const PreInspectionNotices: React.FC<PreInspectionNoticesProps> = ({ notices }) => {
  return (
    <div className="space-y-2">
      {/* Read-only notice list */}
      <div className="space-y-1.5">
        {notices.map((notice) => (
          <div
            key={notice.id}
            className="bg-amber-50/40 border border-amber-200/70 rounded p-2 text-xs transition-colors hover:bg-amber-50/70 select-text"
          >
            {/* Title row */}
            <div className="flex items-center gap-1.5 font-medium text-slate-900 mb-0.5">
              <span className="inline-block px-1.5 py-0.2 rounded font-mono font-bold text-[10px] bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                {notice.numberText}
              </span>
              <span className="text-slate-400 text-[10px]">|</span>
              <h5 className="font-semibold text-slate-800 text-[11px] truncate">
                {notice.title}
              </h5>
            </div>

            {/* Description text */}
            <p className="text-[11px] text-slate-600 leading-relaxed pl-0.5">
              {notice.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
