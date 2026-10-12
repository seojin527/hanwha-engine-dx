import React from "react";
import { MeasurementPoint } from "../data/mockData";
import { PointInspectionRecord, getPointStatus } from "../lib/inspection";
import { Check, AlertTriangle, Clock } from "lucide-react";

interface MeasurementMarkerProps {
  point: MeasurementPoint;
  isSelected: boolean;
  record?: PointInspectionRecord;
  onClick: () => void;
}

export const MeasurementMarker: React.FC<MeasurementMarkerProps> = ({
  point,
  isSelected,
  record,
  onClick,
}) => {
  const summary = getPointStatus(point, record);

  // Status styling
  let badgeBg = "bg-white text-slate-700 border-slate-400 hover:border-slate-600";
  let statusIcon = null;

  if (summary.status === "COMPLETED") {
    if (summary.overallJudgement === "OK") {
      badgeBg = "bg-emerald-600 text-white border-emerald-700 shadow-sm";
      statusIcon = <Check className="w-2.5 h-2.5 stroke-[3]" />;
    } else {
      badgeBg = "bg-rose-600 text-white border-rose-700 shadow-sm animate-pulse";
      statusIcon = <AlertTriangle className="w-2.5 h-2.5 stroke-[2.5]" />;
    }
  } else if (summary.status === "IN_PROGRESS") {
    if (summary.hasNG) {
      badgeBg = "bg-rose-600 text-white border-rose-700 shadow-sm";
      statusIcon = <AlertTriangle className="w-2.5 h-2.5 stroke-[2.5]" />;
    } else {
      badgeBg = "bg-blue-600 text-white border-blue-700 shadow-sm";
      statusIcon = <Clock className="w-2.5 h-2.5 stroke-[2.5]" />;
    }
  } else {
    statusIcon = <Clock className="w-2 h-2 text-slate-400" />;
  }

  return (
    <div
      className="absolute cursor-pointer transition-transform duration-150 -translate-x-1/2 -translate-y-1/2 group select-none"
      style={{
        left: `${point.drawingPosition.xPercent}%`,
        top: `${point.drawingPosition.yPercent}%`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Outer focus halo when selected */}
      {isSelected && (
        <span className="absolute -inset-2.5 rounded-full bg-blue-500/20 border border-blue-500 animate-ping opacity-75 pointer-events-none" />
      )}
      {isSelected && (
        <span className="absolute -inset-1.5 rounded-full bg-blue-500/25 border-2 border-blue-600 pointer-events-none" />
      )}

      {/* Inspection Balloon / Bubble */}
      <div
        className={`relative flex items-center justify-center w-7 h-7 rounded-full font-mono text-xs font-bold border-2 transition-all duration-150 shadow-sm ${
          isSelected
            ? "bg-blue-600 text-white border-blue-800 scale-110 shadow-md ring-2 ring-blue-300"
            : badgeBg
        } group-hover:scale-110`}
      >
        <span>{point.displayNumber}</span>

        {/* Small status dot indicator */}
        <span
          className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center border ${
            summary.status === "COMPLETED" && summary.overallJudgement === "OK"
              ? "bg-emerald-500 text-white border-white"
              : summary.hasNG
              ? "bg-rose-500 text-white border-white"
              : summary.status === "IN_PROGRESS"
              ? "bg-blue-400 text-white border-white"
              : "bg-slate-200 text-slate-600 border-white"
          }`}
        >
          {statusIcon}
        </span>
      </div>

      {/* Hover Tooltip */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover:flex flex-col items-center pointer-events-none z-30 whitespace-nowrap">
        <div className="bg-slate-900/95 text-white text-[11px] px-2.5 py-1 rounded shadow-lg border border-slate-700 font-sans backdrop-blur-xs flex items-center gap-1.5">
          <span className="font-mono text-blue-400 font-bold">#{point.displayNumber}</span>
          <span className="font-medium">{point.feature.name}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300 font-mono">{point.cadCallout}</span>
          <span
            className={`px-1 rounded text-[10px] font-bold ${
              summary.status === "COMPLETED" && summary.overallJudgement === "OK"
                ? "bg-emerald-500 text-white"
                : summary.hasNG
                ? "bg-rose-500 text-white"
                : summary.status === "IN_PROGRESS"
                ? "bg-blue-500 text-white"
                : "bg-slate-700 text-slate-300"
            }`}
          >
            {summary.statusText}
          </span>
        </div>
        {/* Tooltip caret */}
        <div className="w-1.5 h-1.5 bg-slate-900 border-b border-r border-slate-700 rotate-45 -mt-0.5" />
      </div>
    </div>
  );
};
