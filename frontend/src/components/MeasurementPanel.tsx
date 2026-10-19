/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { CollapseToggle } from "./CollapseToggle";
import { judgeMeasurement } from "../lib/inspection";

interface MeasurementPanelProps {
  currentPoint: any;
  totalPointsCount: number;
  onNavigatePoint: (delta: number) => void;
  record: any;
  onSaveRecord: (updatedRecord: any) => void;
  selectedItemId: string;
  onSelectItemId: (itemId: string) => void;
}

export const MeasurementPanel: React.FC<MeasurementPanelProps> = ({
  currentPoint,
  totalPointsCount,
  onNavigatePoint,
  record,
  onSaveRecord,
  selectedItemId,
  onSelectItemId,
}) => {
  // 섹션별 접기 상태 (항목을 바꿔도 유지)
  const [collapsed, setCollapsed] = useState({ result: false, guide: false, history: false });
  const toggle = (key: keyof typeof collapsed) =>
    setCollapsed((previous) => ({ ...previous, [key]: !previous[key] }));

  if (!currentPoint) return <div className="p-6 text-slate-500">선택된 포인트가 없습니다.</div>;

  const pointId = currentPoint.id || 1;
  const displayNumber = currentPoint.displayNumber || pointId;
  const featureName = currentPoint.feature?.name || "측정 항목";
  const dimensionFormatted = currentPoint.dimension?.formatted || "-";
  const lowerLimit = currentPoint.dimension?.lower ?? 0;
  const upperLimit = currentPoint.dimension?.upper ?? 0;
  const measuringTool = currentPoint.measuringTool || "버니어 캘리퍼스";
  const ragGuide = currentPoint.ragGuide || "표준 측정 가이드를 준수하십시오.";
  const errorCases = currentPoint.errorCases || [];

  const currentRecord = record || {
    pointId,
    status: 'pending',
    measuredValue: '',
  };

  const isGdt = currentPoint.feature?.type === "GD&T";
  const hasRange =
    typeof currentPoint.dimension?.lower === "number" &&
    typeof currentPoint.dimension?.upper === "number";

  // 실측값 입력 → 허용 범위와 비교해 OK / NG 판정
  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const result = judgeMeasurement(val, currentPoint.dimension || {}, isGdt);
    onSaveRecord({ ...currentRecord, pointId, measuredValue: val, ...result });
  };

  // 허용 범위가 없는 항목(나사 등): 게이지 통과/정지 판정
  const handleGaugeJudge = (pass: boolean) => {
    onSaveRecord({
      ...currentRecord,
      pointId,
      measuredValue: pass ? "GO (통과)" : "NO-GO (정지)",
      status: pass ? "completed" : "flagged",
      judgement: pass ? "OK" : "NG",
      deviation: null,
      message: pass ? "게이지 통과" : "게이지 불합격",
    });
  };

  const verdict =
    currentRecord.status === "completed"
      ? { short: "OK", long: `OK — ${currentRecord.message || "규격 적합"}`, cls: "bg-emerald-100 text-emerald-800" }
      : currentRecord.status === "flagged"
      ? { short: "NG", long: `NG — ${currentRecord.message || "규격 이탈"}`, cls: "bg-rose-100 text-rose-800" }
      : { short: "대기", long: "측정 대기중", cls: "bg-amber-100 text-amber-800" };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-5 space-y-5 bg-white text-slate-800">
      {/* Top Header & Navigation */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="bg-slate-900 text-cyan-400 font-extrabold px-2.5 py-1 rounded text-xs">
            {displayNumber < 10 ? `0${displayNumber}` : displayNumber}
          </span>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">{featureName}</h2>
            <span className="text-[11px] text-slate-500">{currentPoint.description || "도면 추출 측정 항목"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onNavigatePoint(-1)} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-bold">◀</button>
          <span className="text-xs font-mono text-slate-600 px-1">{displayNumber}/{totalPointsCount}</span>
          <button onClick={() => onNavigatePoint(1)} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-bold">▶</button>
        </div>
      </div>

      {/* Measurement Result Input Card */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3 shadow-sm">
        <div
          onClick={() => toggle("result")}
          className="flex cursor-pointer items-center justify-between gap-2"
        >
          <span className="text-xs font-bold text-slate-700">측정 결과 및 판정</span>
          <div className="flex min-w-0 items-center gap-2">
            {collapsed.result ? (
              // 접힌 상태에서도 실측값과 판정은 보이게
              <span className="truncate text-[11px] font-mono text-slate-600">
                {currentRecord.measuredValue || "—"} mm
                <span className={`ml-2 rounded px-1.5 py-0.5 font-sans font-bold ${verdict.cls}`}>
                  {verdict.short}
                </span>
              </span>
            ) : (
              <span className="truncate text-[11px] text-slate-500">계측기: {measuringTool}</span>
            )}
            <CollapseToggle collapsed={collapsed.result} onToggle={() => toggle("result")} label="측정 결과 및 판정" />
          </div>
        </div>

        {!collapsed.result && (<>
        <div className="bg-white p-3 rounded-lg border border-slate-200">
          <div className="text-[11px] text-slate-400">기준 치수 및 허용 범위</div>
          <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">
            {dimensionFormatted} mm
          </div>
          <div className="text-xs font-mono text-cyan-700 mt-1">
            허용 범위: {currentPoint.dimension?.rangeText || `${lowerLimit} ~ ${upperLimit} mm`}
          </div>
        </div>

        {hasRange ? (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isGdt ? "기하공차 측정값 입력 (Measured Deviation)" : "실측값 입력 (Measured Value)"}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={currentRecord.measuredValue || ''}
              onChange={handleValueChange}
              placeholder={isGdt ? "측정된 편차량을 입력하세요 (예: 0.002)" : "실측값을 입력하세요..."}
              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono focus:outline-none bg-white ${
                currentRecord.status === 'flagged'
                  ? 'border-rose-400 focus:border-rose-500'
                  : 'border-slate-300 focus:border-cyan-500'
              }`}
            />
            {currentRecord.status === 'pending' && currentRecord.message && (
              <p className="mt-1 text-[11px] text-amber-700">{currentRecord.message}</p>
            )}
          </div>
        ) : (
          <div>
            <span className="block text-xs font-bold text-slate-700 mb-1">게이지 판정</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => handleGaugeJudge(true)}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100">
                GO · 통과 (OK)
              </button>
              <button type="button" onClick={() => handleGaugeJudge(false)}
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100">
                NO-GO · 정지 (NG)
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-500">판정 상태:</span>
          <div className="flex items-center gap-2">
            {typeof currentRecord.deviation === 'number' && currentRecord.status !== 'pending' && (
              <span className="font-mono text-slate-600">
                편차: <b className={currentRecord.status === 'flagged' ? 'text-rose-700' : 'text-slate-900'}>
                  {currentRecord.deviation >= 0 ? '+' : ''}{currentRecord.deviation} mm
                </b>
              </span>
            )}
            <span className={`font-bold px-2.5 py-1 rounded ${verdict.cls}`}>
              {verdict.long}
            </span>
          </div>
        </div>
        </>)}
      </div>

      {/* RAG: 측정 전 확인 사항 (AI 생성) */}
      <div className="bg-amber-50/70 rounded-xl p-4 border border-amber-200 space-y-2">
        <div
          onClick={() => toggle("guide")}
          className="flex cursor-pointer items-center justify-between gap-2"
        >
          <span className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
            ⚡ 측정 전 확인 사항 <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.2 rounded font-normal">AI 생성·RAG</span>
          </span>
          <CollapseToggle collapsed={collapsed.guide} onToggle={() => toggle("guide")} label="측정 전 확인 사항" />
        </div>
        {!collapsed.guide && (
          <p className="text-xs text-amber-950 leading-relaxed font-medium">
            • {ragGuide}
          </p>
        )}
      </div>

      {/* 과거 오류 사례 패널 */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
        <div
          onClick={() => toggle("history")}
          className="flex cursor-pointer items-center justify-between gap-2"
        >
          <span className="text-xs font-extrabold text-slate-700">
            ⚠️ 과거 오류 사례 | 유사 사례 Top {errorCases.length || 1}
            {collapsed.history && (
              <span className="ml-2 font-normal text-slate-500">({errorCases.length}건)</span>
            )}
          </span>
          <CollapseToggle collapsed={collapsed.history} onToggle={() => toggle("history")} label="과거 오류 사례" />
        </div>
        {collapsed.history ? null : errorCases.length > 0 ? (
          errorCases.map((err: any, idx: number) => (
            <div key={idx} className="bg-white p-3 rounded-lg border border-rose-200 text-xs space-y-1.5">
              <div className="font-bold text-rose-800">{err.title}</div>
              <div className="text-slate-600 font-mono text-[11px]">{err.meta || `발생일: ${err.date} | 유사도: ${err.similarity}`}</div>
              <div className="text-slate-700 bg-slate-50 p-2 rounded">
                <span className="font-bold text-slate-900">원인:</span> {err.cause}
              </div>
              <div className="text-emerald-800 bg-emerald-50 p-2 rounded">
                <span className="font-bold">조치 및 재발 방지:</span> {err.solution}
              </div>
            </div>
          ))
        ) : (
          <div className="text-xs text-slate-500 text-center py-2">
            해당 포인트에 등록된 치명적 과거 오류 사례가 없습니다. (안전 구간)
          </div>
        )}
      </div>
    </div>
  );
};