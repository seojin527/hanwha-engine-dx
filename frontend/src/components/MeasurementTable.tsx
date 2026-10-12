import React from "react";
import { MeasurementPoint } from "../data/mockData";
import { PointInspectionRecord, getPointStatus } from "../lib/inspection";
import { formatDeviation } from "../lib/utils";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

interface MeasurementTableProps {
  points: MeasurementPoint[];
  selectedPointId: number;
  onSelectPoint: (id: number) => void;
  inspectionRecords: Record<number, PointInspectionRecord>;
  selectedItemId?: string;
  onSelectItem?: (pointId: number, itemId: string) => void;
}

export const MeasurementTable: React.FC<MeasurementTableProps> = ({
  points,
  selectedPointId,
  onSelectPoint,
  inspectionRecords,
  selectedItemId,
  onSelectItem,
}) => {
  // Count points where all measurement items are completed
  const completedCount = points.filter(
    (p) => getPointStatus(p, inspectionRecords[p.id]).isCompleted
  ).length;
  const totalCount = points.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="flex flex-col bg-white border-t border-slate-300 min-h-[200px] max-h-[290px] select-none">
      {/* Table Header Bar */}
      <div className="h-9 px-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-slate-800 tracking-wide">
            피스톤 로드 측정 항목
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            (Piston Rod Inspection Sheet)
          </span>
        </div>

        {/* Progress status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-600 font-medium">검사 진행률:</span>
            <span className="font-mono font-bold text-slate-900 tabular-nums">
              {completedCount} / {totalCount} 완료
            </span>
            <span className="font-mono text-[11px] text-blue-600 font-semibold">
              ({progressPercent}%)
            </span>
          </div>

          <div className="w-28 h-2 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
            <div
              className={`h-full transition-all duration-300 ease-out ${
                completedCount === totalCount ? "bg-emerald-500" : "bg-blue-600"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Table Viewport with Horizontal Scroll support */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[760px]">
          <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200 sticky top-0 z-10 select-none">
            <tr>
              <th className="py-2 px-2.5 w-24 text-center">상태</th>
              <th className="py-2 px-2 w-12 text-center">번호</th>
              <th className="py-2 px-3 min-w-[90px]">측정 위치</th>
              <th className="py-2 px-2.5 w-20">Feature</th>
              <th className="py-2 px-3 min-w-[130px]">측정 항목</th>
              <th className="py-2 px-3 min-w-[110px]">도면 규격</th>
              <th className="py-2 px-3 min-w-[130px]">공차 / GD&T</th>
              <th className="py-2 px-3 min-w-[110px]">측정기</th>
              <th className="py-2 px-3 min-w-[140px] text-right font-mono">측정값 (항목별)</th>
              <th className="py-2 px-3 min-w-[80px] text-right font-mono">편차</th>
              <th className="py-2 px-3 w-20 text-center">판정</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-150">
            {points.map((point) => {
              const record = inspectionRecords[point.id];
              const isSelected = selectedPointId === point.id;
              const summary = getPointStatus(point, record);

              // Build measured values summary list
              const itemValues = point.items.map((it) => {
                const itRec = record?.items?.[it.id];
                const val = itRec?.measuredValue?.trim();
                const isItemActive = isSelected && selectedItemId === it.id;
                return {
                  id: it.id,
                  name: it.name,
                  val: val ? `${val}` : "-",
                  judgement: itRec?.judgement ?? "PENDING",
                  deviation: itRec?.deviation ?? null,
                  isCompleted: itRec?.isCompleted ?? false,
                  isItemActive,
                };
              });

              const primaryDev = itemValues.find((v) => v.deviation !== null)?.deviation ?? null;

              // Row status indicator
              let statusBadge = (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>대기</span>
                </span>
              );

              let judgementBadge = (
                <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-medium text-slate-500 bg-slate-100 border border-slate-200">
                  대기
                </span>
              );

              if (summary.status === "COMPLETED") {
                if (summary.overallJudgement === "OK") {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>완료</span>
                    </span>
                  );
                  judgementBadge = (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-300">
                      OK
                    </span>
                  );
                } else {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[11px] text-rose-700 font-semibold">
                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                      <span>완료 (NG)</span>
                    </span>
                  );
                  judgementBadge = (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold text-rose-800 bg-rose-50 border border-rose-300 animate-pulse">
                      NG
                    </span>
                  );
                }
              } else if (summary.status === "IN_PROGRESS") {
                statusBadge = (
                  <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 font-semibold">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    <span>진행중 ({summary.completedCount}/{summary.totalCount})</span>
                  </span>
                );
                if (summary.hasNG) {
                  judgementBadge = (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold text-rose-800 bg-rose-50 border border-rose-300">
                      NG
                    </span>
                  );
                } else {
                  judgementBadge = (
                    <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-200">
                      측정중
                    </span>
                  );
                }
              }

              return (
                <tr
                  key={point.id}
                  onClick={() => onSelectPoint(point.id)}
                  className={`cursor-pointer transition-colors duration-100 select-none ${
                    isSelected
                      ? "bg-blue-50/80 font-medium text-slate-900 border-l-4 border-l-blue-600 shadow-2xs"
                      : "hover:bg-slate-50 text-slate-700 border-l-4 border-l-transparent"
                  }`}
                >
                  {/* 상태 */}
                  <td className="py-2 px-2 text-center whitespace-nowrap">
                    {statusBadge}
                  </td>

                  {/* 번호 */}
                  <td className="py-2 px-2 text-center">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-mono text-[11px] font-bold ${
                        isSelected
                          ? "bg-blue-600 text-white"
                          : summary.status === "COMPLETED" && summary.overallJudgement === "OK"
                          ? "bg-emerald-600 text-white"
                          : summary.hasNG
                          ? "bg-rose-600 text-white"
                          : summary.status === "IN_PROGRESS"
                          ? "bg-blue-500 text-white"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {point.displayNumber}
                    </span>
                  </td>

                  {/* 측정 위치 */}
                  <td className="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">
                    {point.feature.name}
                  </td>

                  {/* Feature */}
                  <td className="py-2 px-2.5">
                    <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200">
                      {point.feature.type}
                    </span>
                  </td>

                  {/* 측정 항목 (인터랙티브 탭 연동) */}
                  <td className="py-2 px-3 text-slate-800">
                    <div className="flex items-center gap-1 flex-wrap">
                      {point.items.map((it) => {
                        const isThisActive = isSelected && selectedItemId === it.id;
                        return (
                          <button
                            key={it.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectPoint(point.id);
                              if (onSelectItem) {
                                onSelectItem(point.id, it.id);
                              }
                            }}
                            className={`px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                              isThisActive
                                ? "bg-blue-600 text-white font-bold"
                                : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                            }`}
                          >
                            {it.name}
                          </button>
                        );
                      })}
                    </div>
                  </td>

                  {/* 도면 규격 */}
                  <td className="py-2 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                    {point.dimension.formatted}
                  </td>

                  {/* 공차 / GD&T */}
                  <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                    <span>{point.dimensionalTolerance.formatted}</span>
                    {point.geometricTolerance && (
                      <span className="text-slate-500 text-[11px] ml-1">
                        / {point.geometricTolerance.formatted}
                      </span>
                    )}
                  </td>

                  {/* 측정기 */}
                  <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                    {point.measurement.equipment}
                  </td>

                  {/* 측정값 (항목별 요약) */}
                  <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {itemValues.map((iv, idx) => (
                        <button
                          key={iv.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPoint(point.id);
                            if (onSelectItem) {
                              onSelectItem(point.id, iv.id);
                            }
                          }}
                          className={`inline-flex items-center gap-0.5 text-[11px] px-1 py-0.2 rounded transition-colors cursor-pointer ${
                            iv.isItemActive
                              ? "bg-blue-100 text-blue-900 font-bold border border-blue-300"
                              : "hover:bg-slate-100"
                          }`}
                        >
                          <span className="text-[10px] text-slate-400 font-sans">{iv.name}:</span>
                          <span
                            className={
                              iv.judgement === "OK"
                                ? "text-emerald-700 font-bold"
                                : iv.judgement === "NG"
                                ? "text-rose-700 font-bold"
                                : "text-slate-500"
                            }
                          >
                            {iv.val}
                          </span>
                          {idx < itemValues.length - 1 && (
                            <span className="text-slate-300 ml-1">/</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </td>

                  {/* 편차 */}
                  <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                    {primaryDev !== null ? (
                      <span
                        className={
                          primaryDev === 0
                            ? "text-slate-500"
                            : primaryDev > 0
                            ? "text-blue-600"
                            : "text-amber-600"
                        }
                      >
                        {formatDeviation(primaryDev)}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>

                  {/* 판정 */}
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    {judgementBadge}
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
