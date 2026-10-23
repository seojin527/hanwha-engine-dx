/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

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

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onSaveRecord({
      ...currentRecord,
      pointId,
      measuredValue: val,
      status: val.trim() !== '' ? 'completed' : 'pending',
    });
  };

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
            <span className="text-[11px] text-slate-500">키콤부 몸체 - 조립 시 상대 부품과 끼워지는 주 외경부</span>
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
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700">측정 결과 및 판정</span>
          <span className="text-[11px] text-slate-500">계측기: {measuringTool}</span>
        </div>

        <div className="bg-white p-3 rounded-lg border border-slate-200">
          <div className="text-[11px] text-slate-400">기준 치수 및 허용 범위</div>
          <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">
            {dimensionFormatted} mm
          </div>
          <div className="text-xs font-mono text-cyan-700 mt-1">
            허용 범위: {lowerLimit} ~ {upperLimit} mm
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            실측값 입력 (Measured Value)
          </label>
          <input
            type="text"
            value={currentRecord.measuredValue || ''}
            onChange={handleValueChange}
            placeholder="실측값을 입력하세요..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:border-cyan-500 bg-white"
          />
        </div>

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-500">판정 상태:</span>
          <span className={`font-bold px-2.5 py-1 rounded ${currentRecord.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {currentRecord.status === 'completed' ? 'OK — 규격 적합' : '측정 대기중'}
          </span>
        </div>
      </div>

      {/* RAG: 측정 전 확인 사항 (AI 생성) */}
      <div className="bg-amber-50/70 rounded-xl p-4 border border-amber-200 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
            ⚡ 측정 전 확인 사항 <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.2 rounded font-normal">AI 생성·RAG</span>
          </span>
        </div>
        <p className="text-xs text-amber-950 leading-relaxed font-medium">
          • {ragGuide}
        </p>
      </div>

      {/* 과거 오류 사례 패널 */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-700">
            ⚠️ 과거 오류 사례 | 유사 사례 Top {errorCases.length || 1}
          </span>
        </div>
        {errorCases.length > 0 ? (
          errorCases.map((err: any, idx: number) => (
            <div key={idx} className="bg-white p-3 rounded-lg border border-rose-200 text-xs space-y-1.5">
              <div className="font-bold text-rose-800">{err.title}</div>
              <div className="text-slate-600 font-mono text-[11px]">발생일: {err.date} | 유사도: {err.similarity}</div>
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