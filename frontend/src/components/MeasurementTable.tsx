/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";

interface MeasurementTableProps {
  points: any[];
  selectedPointId: number;
  onSelectPoint: (pointId: number) => void;
  inspectionRecords: Record<number, any>;
  selectedItemId: string;
  onSelectItem: (pointId: number, itemId: string) => void;
}

export const MeasurementTable: React.FC<MeasurementTableProps> = ({
  points = [],
  selectedPointId,
  onSelectPoint,
  inspectionRecords = {},
  selectedItemId,
  onSelectItem,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const completedCount = Object.values(inspectionRecords).filter(
    (r: any) => r?.status === "completed"
  ).length;

  return (
    <div className={`${collapsed ? "" : "h-[280px] max-h-[45%]"} bg-white flex flex-col border-t border-slate-200 shrink-0 shadow-inner`}>
      {/* Table Top Header & Progress */}
      <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            피스톤 로드 측정 항목 (Piston Rod Inspection Sheet)
          </h3>
          <span className="text-[11px] text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200 font-semibold">
            검사 진행률: {completedCount} / {points.length} 완료 ({Math.round((completedCount / Math.max(1, points.length)) * 100)}%)
          </span>
        </div>
        <button type="button" aria-expanded={!collapsed} aria-controls="demo-measurement-body" onClick={()=>setCollapsed(v=>!v)} className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-cyan-50">{collapsed ? '측정항목 펼치기 ▴' : '측정항목 접기 ▾'}</button>
      </div>

      {/* Table Scroll Body */}
      <div id="demo-measurement-body" hidden={collapsed} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-slate-50 sticky top-0 z-10 text-slate-600 font-semibold border-b border-slate-200">
            <tr>
              <th className="py-2 px-3 w-16 text-center">상태</th>
              <th className="py-2 px-3 w-14 text-center">번호</th>
              <th className="py-2 px-3">측정 위치</th>
              <th className="py-2 px-3">Feature</th>
              <th className="py-2 px-3">측정 항목</th>
              <th className="py-2 px-3">도면 규격</th>
              <th className="py-2 px-3">공차 / GD&T</th>
              <th className="py-2 px-3">측정기</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {points.map((pt) => {
              if (!pt) return null;
              const pointId = pt.id || pt.displayNumber;
              const isSelected = pointId === selectedPointId;
              const record = inspectionRecords[pointId] || {};
              const status = record.status || "pending";
              const isDone = status === "completed";

              const itemId = pt.items?.[0]?.id || `p${pointId}-item`;

              return (
                <tr
                  key={pointId}
                  onClick={() => {
                    onSelectPoint(pointId);
                    onSelectItem(pointId, itemId);
                  }}
                  className={`cursor-pointer transition hover:bg-cyan-50 ${
                    isSelected ? "bg-cyan-100/80 font-semibold" : ""
                  }`}
                >
                  <td className="py-2 px-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        isDone
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isDone ? "완료" : "대기"}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center font-bold text-slate-800">
                    {pt.displayNumber}
                  </td>
                  <td className="py-2 px-3 font-medium text-slate-900">
                    {pt.feature?.name}
                  </td>
                  <td className="py-2 px-3">
                    <span className="bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">
                      {pt.feature?.type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-700">
                    {pt.items?.[0]?.name || pt.feature?.name}
                  </td>
                  <td className="py-2 px-3 font-mono font-bold text-cyan-900">
                    {pt.dimension?.formatted}
                  </td>
                  <td className="py-2 px-3 font-mono text-slate-600">
                    {pt.dimension?.tolerance} {pt.gdgt ? `| ${pt.gdgt}` : ""}
                  </td>
                  <td className="py-2 px-3 text-slate-500 text-[11px]">
                    {pt.measuringTool}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};