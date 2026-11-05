/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

interface MeasurementMarkerProps {
  point?: any;
  isSelected?: boolean;
  onClick?: () => void;
  status?: string;
}

export const MeasurementMarker: React.FC<MeasurementMarkerProps> = ({
  point,
  isSelected = false,
  onClick = () => {},
  status,
}) => {
  if (!point) return null;

  const displayNumber = point.displayNumber || point.id || 1;

  // 부품제작 가공 단계 색 (황삭 주황 · 중삭 보라 · 정삭 남색 · 다른 단계 회색)
  const stageColor: Record<string, string> = {
    "stage-1": "bg-orange-500 text-white",
    "stage-2": "bg-violet-600 text-white",
    "stage-3": "bg-indigo-600 text-white",
    "stage-other": "bg-slate-300 text-slate-600 opacity-70",
  };

  const markerColor = status && stageColor[status]
    ? stageColor[status]
    : status === "remeasure"
      ? "bg-red-600 text-white"
      : status === "completed"
        ? "bg-emerald-600 text-white"
        : status === "review_required"
          ? "bg-amber-500 text-slate-950"
          : "bg-cyan-700 text-white";

  const statusLabel =
    status === "stage-other"
      ? "다른 단계"
      : status?.startsWith("stage-")
        ? "이번 단계 측정 대상"
        : status === "remeasure"
      ? "재측정 필요"
      : status === "completed"
        ? "완료"
        : status === "review_required"
          ? "확인 필요"
          : "대기";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`relative z-20 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold shadow transition-transform hover:scale-125 ${markerColor} ${
        isSelected
          ? "z-30 scale-125 ring-2 ring-slate-950 ring-offset-2 ring-offset-white"
          : "ring-1 ring-white/70"
      }`}
      title={`#${displayNumber}: ${
        point.feature?.name || point.name || "포인트"
      } · ${statusLabel}`}
      aria-label={`${displayNumber}번 · ${statusLabel}`}
      aria-pressed={isSelected}
    >
      {displayNumber}
    </button>
  );
};