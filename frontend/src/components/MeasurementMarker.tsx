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

  const markerColor =
    status === "remeasure"
      ? "bg-red-600 text-white"
      : status === "completed"
        ? "bg-emerald-600 text-white"
        : status === "review_required"
          ? "bg-amber-500 text-slate-950"
          : "bg-cyan-700 text-white";

  const statusLabel =
    status === "remeasure"
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