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
  const isCompleted = status === "completed";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      // 치수 숫자가 가려지지 않도록 bg-opacity-60 및 backdrop-blur 적용
      className={`w-6 h-6 rounded-full text-[11px] font-extrabold flex items-center justify-center shadow transition transform hover:scale-125 z-20 backdrop-blur-[1px] ${
        isSelected
          ? "bg-amber-400/60 text-slate-950 ring-2 ring-cyan-500 scale-110 shadow-lg"
          : isCompleted
          ? "bg-emerald-600/50 text-white ring-1 ring-emerald-300"
          : "bg-cyan-600/50 text-white hover:bg-cyan-500/70"
      }`}
      title={`#${displayNumber}: ${point.feature?.name || point.name || "포인트"}`}
    >
      {displayNumber}
    </button>
  );
};