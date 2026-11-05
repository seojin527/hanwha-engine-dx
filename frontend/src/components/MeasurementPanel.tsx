/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

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
    <div className="flex h-full flex-col space-y-3 overflow-y-auto bg-slate-50 p-3 text-slate-800">
      {/* Top Header & Navigation */}
      <div className="-mx-3 -mt-3 flex items-start justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-px shrink-0 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[13px] font-semibold tabular-nums text-white">
            {displayNumber < 10 ? `0${displayNumber}` : displayNumber}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-snug text-slate-900">{featureName}</h2>
            <span className="text-[11px] text-slate-500">키콤부 몸체 - 조립 시 상대 부품과 끼워지는 주 외경부</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" aria-label="이전 항목" onClick={() => onNavigatePoint(-1)} className="btn btn-secondary btn-icon h-6 w-6"><ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <span className="min-w-[44px] text-center font-mono text-[11px] tabular-nums text-slate-500"><b className="font-semibold text-slate-900">{displayNumber}</b>/{totalPointsCount}</span>
          <button type="button" aria-label="다음 항목" onClick={() => onNavigatePoint(1)} className="btn btn-secondary btn-icon h-6 w-6"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* Measurement Result Input Card */}
      <div className="card space-y-3 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-900">측정 결과 및 판정</span>
          <span className="text-[11px] text-slate-500">계측기: {measuringTool}</span>
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] text-slate-400">기준 치수 및 허용 범위</div>
          <div className="text-sm font-mono font-bold text-slate-900 mt-0.5">
            {dimensionFormatted} mm
          </div>
          <div className="mt-1 text-xs tabular-nums text-slate-700">
            허용 범위: {lowerLimit} ~ {upperLimit} mm
          </div>
        </div>

        <div>
          <label className="field-label mb-1">
            실측값
          </label>
          <input
            type="text"
            value={currentRecord.measuredValue || ''}
            onChange={handleValueChange}
            placeholder="실측값을 입력하세요..."
            className="field h-9 font-mono text-sm"
          />
        </div>

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-500">판정 상태:</span>
          <span className={`tag ${currentRecord.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {currentRecord.status === 'completed' ? 'OK — 규격 적합' : '측정 대기중'}
          </span>
        </div>
      </div>

      {/* RAG: 측정 전 확인 사항 (AI 생성) */}
      <div className="card border-amber-300">
        <div className="card-header border-amber-200 bg-amber-50">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            측정 전 확인 사항
          </span>
          <span className="tag bg-amber-100 text-amber-900">AI 생성·RAG</span>
        </div>
        <p className="p-3 text-xs leading-relaxed text-slate-800">
          {ragGuide}
        </p>
      </div>

      {/* 과거 오류 사례 패널 */}
      <div className="card">
        <div className="card-header">
          <span className="text-xs font-semibold text-slate-900">과거 오류 사례</span>
          <span className="text-[11px] text-slate-500">유사 사례 상위 {errorCases.length || 1}건</span>
        </div>
        <div className="divide-y divide-slate-100">
        {errorCases.length > 0 ? (
          errorCases.map((err: any, idx: number) => (
            <div key={idx} className="space-y-1.5 p-3 text-xs">
              <div className="text-[13px] font-semibold text-slate-900">{err.title}</div>
              <div className="text-[11px] text-slate-500">발생일: {err.date} | 유사도: {err.similarity}</div>
              <div className="text-slate-800">
                <span className="mr-1 text-slate-500">원인</span>{err.cause}
              </div>
              <div className="note note-ok">
                <b className="mr-1 font-semibold">조치 및 재발 방지</b>{err.solution}
              </div>
            </div>
          ))
        ) : (
          <div className="p-3 text-center text-xs text-slate-500">
            해당 포인트에 등록된 치명적 과거 오류 사례가 없습니다. (안전 구간)
          </div>
        )}
        </div>
      </div>
    </div>
  );
};