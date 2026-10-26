/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

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
    <div className={`${collapsed ? "" : "h-[240px] max-h-[42%] min-h-[120px]"} flex shrink-0 flex-col border-t border-slate-300 bg-white`}>
      {/* Table Top Header & Progress */}
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-3">
        <h3 className="min-w-0 truncate text-xs font-semibold text-slate-900">
          피스톤 로드 측정항목
        </h3>
        <span className="shrink-0 text-[11px] text-slate-500">
          완료 <b className="font-mono font-medium text-slate-700">{completedCount}</b> / {points.length}
          <span className="ml-1 text-slate-400">({Math.round((completedCount / Math.max(1, points.length)) * 100)}%)</span>
        </span>
        <button type="button" aria-expanded={!collapsed} aria-controls="demo-measurement-body" onClick={()=>setCollapsed(v=>!v)} className="btn btn-ghost ml-auto h-6">
          {collapsed ? '펼치기' : '접기'}
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Table Scroll Body */}
      <div id="demo-measurement-body" hidden={collapsed} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-white text-[11px] text-slate-500">
            <tr className="[&>th]:border-b [&>th]:border-slate-200 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
              <th scope="col" className="w-16">상태</th>
              <th scope="col" className="w-12 text-right">번호</th>
              <th scope="col">측정 위치</th>
              <th scope="col">형상</th>
              <th scope="col">측정 항목</th>
              <th scope="col">도면 규격</th>
              <th scope="col">공차 / GD&T</th>
              <th scope="col">측정기</th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => {
              if (!pt) return null;
              const pointId = pt.id || pt.displayNumber;
              const isSelected = pointId === selectedPointId;
              const record = inspectionRecords[pointId] || {};
              const status = record.status || "pending";
              const isDone = status === "completed";

              const itemId = pt.items?.[0]?.id || `p${pointId}-item`;
              const select = () => {
                onSelectPoint(pointId);
                onSelectItem(pointId, itemId);
              };

              return (
                <tr
                  key={pointId}
                  tabIndex={0}
                  aria-selected={isSelected}
                  onClick={select}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select();
                    }
                  }}
                  className={`cursor-pointer outline-none [&>td]:border-b [&>td]:border-slate-100 [&>td]:px-3 [&>td]:py-1.5 focus-visible:[&>td]:bg-slate-100 ${
                    isSelected
                      ? "[&>td]:bg-cyan-50 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-cyan-700)]"
                      : "hover:[&>td]:bg-slate-50"
                  }`}
                >
                  <td>
                    <span
                      className={`tag ${
                        isDone
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isDone ? "완료" : "대기"}
                    </span>
                  </td>
                  <td className={`text-right font-mono tabular-nums ${isSelected ? "font-semibold text-cyan-800" : "text-slate-700"}`}>
                    {pt.displayNumber}
                  </td>
                  <td className={isSelected ? "font-semibold text-slate-900" : "text-slate-800"}>
                    {pt.feature?.name}
                  </td>
                  <td>
                    <span className="tag bg-slate-100 font-mono text-slate-600">
                      {pt.feature?.type}
                    </span>
                  </td>
                  <td className="text-slate-700">
                    {pt.items?.[0]?.name || pt.feature?.name}
                  </td>
                  <td className="font-mono font-medium text-slate-900">
                    {pt.dimension?.formatted}
                  </td>
                  <td className="tabular-nums text-slate-600">
                    {pt.dimension?.tolerance} {pt.gdgt ? `| ${pt.gdgt}` : ""}
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-slate-500">
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
