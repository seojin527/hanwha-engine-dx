import React, { useState, useEffect, useMemo, useCallback } from "react";
import { MeasurementPoint, MeasurementItemDef } from "../data/mockData";
import { MOCK_ERROR_HISTORY } from "../data/mockHistory";
import {
  PointInspectionRecord,
  ItemInspectionRecord,
  evaluateItemMeasurement,
  getPointStatus,
} from "../lib/inspection";
import { formatDeviation } from "../lib/utils";
import { ErrorHistoryCard } from "./ErrorHistoryCard";
import { PreInspectionNotices } from "./PreInspectionNotices";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Clock,
  Gauge,
  AlertTriangle,
  Compass,
  FileText,
  CheckSquare,
} from "lucide-react";

interface MeasurementPanelProps {
  currentPoint: MeasurementPoint;
  totalPointsCount: number;
  onNavigatePoint: (delta: number) => void;
  record?: PointInspectionRecord;
  onSaveRecord: (updated: PointInspectionRecord) => void;
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
  // Accordion open/close states (independent, default: both closed for compact height)
  const [isNoticesOpen, setIsNoticesOpen] = useState(false);
  const [isSpecsOpen, setIsSpecsOpen] = useState(false);

  // Toggle for showing all historical errors when multiple exist
  const [showAllErrors, setShowAllErrors] = useState(false);

  // Ensure selectedItem is valid for currentPoint
  const selectedItem: MeasurementItemDef = useMemo(() => {
    return (
      currentPoint.items.find((it) => it.id === selectedItemId) ||
      currentPoint.items[0]
    );
  }, [currentPoint.items, selectedItemId]);

  // Current item record from storage
  const currentItemRecord: ItemInspectionRecord | undefined =
    record?.items?.[selectedItem.id];

  // Single measured input state
  const [measuredInput, setMeasuredInput] = useState<string>(
    currentItemRecord?.measuredValue || ""
  );

  // Notes state
  const [notesInput, setNotesInput] = useState<string>(record?.notes || "");

  // Sync measuredInput when selectedItem or record changes
  useEffect(() => {
    setMeasuredInput(currentItemRecord?.measuredValue || "");
  }, [selectedItem.id, currentItemRecord?.measuredValue]);

  // Sync notes when point changes
  useEffect(() => {
    setNotesInput(record?.notes || "");
  }, [currentPoint.id, record?.notes]);

  // Reset showAllErrors when point changes
  useEffect(() => {
    setShowAllErrors(false);
  }, [currentPoint.id]);

  // Live evaluation of current item input
  const currentEvaluation = useMemo(() => {
    return evaluateItemMeasurement(selectedItem, measuredInput);
  }, [selectedItem, measuredInput]);

  // Point status summary
  const pointStatus = useMemo(() => {
    return getPointStatus(currentPoint, record);
  }, [currentPoint, record]);

  // Filter historical errors related to this point or feature
  const relatedErrors = useMemo(() => {
    const directMatches = MOCK_ERROR_HISTORY.filter(
      (err) => err.pointId === currentPoint.id
    );
    if (directMatches.length > 0) return directMatches;
    return MOCK_ERROR_HISTORY.filter(
      (err) => err.featureType === currentPoint.feature.type
    ).slice(0, 2);
  }, [currentPoint]);

  // Save changes to current item
  const updateCurrentItem = useCallback(
    (newVal: string, isCompletedFlag?: boolean, notesVal?: string) => {
      const evalRes = evaluateItemMeasurement(selectedItem, newVal);
      const isCompleted =
        isCompletedFlag !== undefined
          ? isCompletedFlag
          : currentItemRecord?.isCompleted ?? false;

      const nowStr = new Date().toISOString().replace("T", " ").substring(0, 16);

      const updatedItemRec: ItemInspectionRecord = {
        itemId: selectedItem.id,
        measuredValue: newVal,
        judgement: evalRes.judgement,
        deviation: evalRes.deviation,
        limitDeviation: evalRes.limitDeviation,
        limitDeviationText: evalRes.limitDeviationText,
        isCompleted,
        updatedAt: nowStr,
        summaryText: evalRes.summaryText,
        reasons: evalRes.reasons,
      };

      const updatedPointRec: PointInspectionRecord = {
        pointId: currentPoint.id,
        notes: notesVal !== undefined ? notesVal : notesInput,
        updatedAt: nowStr,
        items: {
          ...(record?.items || {}),
          [selectedItem.id]: updatedItemRec,
        },
      };

      onSaveRecord(updatedPointRec);
    },
    [currentPoint.id, selectedItem, currentItemRecord, record, notesInput, onSaveRecord]
  );

  // Handle Mark as Completed button for current item
  const handleToggleItemComplete = useCallback(() => {
    const nextCompleted = !(currentItemRecord?.isCompleted ?? false);
    updateCurrentItem(measuredInput, nextCompleted);
  }, [currentItemRecord?.isCompleted, measuredInput, updateCurrentItem]);

  // Quick fill pass value
  const handleFillPassValue = () => {
    const val = selectedItem.defaultPassValue.toFixed(3);
    setMeasuredInput(val);
    updateCurrentItem(val, true);
  };

  // Quick fill NG Lower bound value
  const handleFillNGLowerValue = () => {
    let val: string;
    if (selectedItem.type === "DIMENSION") {
      const lower = selectedItem.lowerLimit ?? selectedItem.nominalValue ?? 250;
      val = (lower - 0.967).toFixed(3); // e.g. 249.023 for 250 dia
    } else {
      val = "-0.005";
    }
    setMeasuredInput(val);
    updateCurrentItem(val, true);
  };

  // Quick fill NG Upper bound value
  const handleFillNGUpperValue = () => {
    let val: string;
    if (selectedItem.type === "DIMENSION") {
      const upper = selectedItem.upperLimit ?? selectedItem.nominalValue ?? 250;
      val = (upper + 0.008).toFixed(3); // e.g. 250.018
    } else {
      const maxAllowed = selectedItem.maxAllowed ?? 0.01;
      val = (maxAllowed + 0.006).toFixed(3); // e.g. 0.016
    }
    setMeasuredInput(val);
    updateCurrentItem(val, true);
  };

  // Move to next item or next point
  const handleNextItemOrPoint = () => {
    const currentIndex = currentPoint.items.findIndex(
      (it) => it.id === selectedItemId
    );
    if (currentIndex < currentPoint.items.length - 1) {
      onSelectItemId(currentPoint.items[currentIndex + 1].id);
    } else {
      onNavigatePoint(1);
    }
  };

  const isCurrentItemCompleted = currentItemRecord?.isCompleted ?? false;
  const nominal = currentPoint.dimension.nominalValue;
  const lowerBound = (nominal + currentPoint.dimensionalTolerance.lower).toFixed(3);
  const upperBound = (nominal + currentPoint.dimensionalTolerance.upper).toFixed(3);

  return (
    <div className="w-full h-full bg-slate-50 flex flex-col min-w-0 overflow-hidden select-none">
      {/* ================= A. MEASUREMENT POINT HEADER ================= */}
      <div className="h-12 px-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0 shadow-xs border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Big Point Number */}
          <div className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center font-mono font-bold text-base border border-blue-400/40 shadow-inner shrink-0">
            {currentPoint.displayNumber.toString().padStart(2, "0")}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-xs text-slate-100 truncate">
                {currentPoint.feature.name}
              </h3>
              <span className="font-mono text-[9px] px-1 py-0.2 bg-slate-800 text-slate-300 rounded border border-slate-700 shrink-0">
                {currentPoint.feature.type}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 truncate leading-none mt-0.5">
              {currentPoint.feature.description}
            </p>
          </div>
        </div>

        {/* Status Badge & Prev/Next Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Point Overall Status Badge */}
          {pointStatus.status === "COMPLETED" ? (
            pointStatus.overallJudgement === "OK" ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>완료 (OK)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700 animate-pulse">
                <XCircle className="w-3 h-3 text-rose-400" />
                <span>완료 (NG)</span>
              </span>
            )
          ) : pointStatus.status === "IN_PROGRESS" ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-700">
              <Clock className="w-3 h-3 text-blue-400" />
              <span>측정 중 ({pointStatus.completedCount}/{pointStatus.totalCount})</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>측정 대기</span>
            </span>
          )}

          {/* Prev / Next navigation */}
          <div className="flex items-center bg-slate-800 rounded border border-slate-700 ml-0.5">
            <button
              onClick={() => onNavigatePoint(-1)}
              title="이전 검사 포인트"
              className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded-l transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono px-1 text-slate-400">
              {currentPoint.displayNumber}/{totalPointsCount}
            </span>
            <button
              onClick={() => onNavigatePoint(1)}
              title="다음 검사 포인트"
              className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded-r transition-colors cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Internal Independent Scrollable Viewport */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {/* ================= 1. 측정 결과 입력 (항상 펼침, 컴팩트 최적화) ================= */}
        <section className="bg-white border border-blue-300/80 rounded-md p-2.5 shadow-2xs space-y-2">
          {/* Card Header: Title & Quick Sample Fill Buttons */}
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-150">
            <div className="flex items-center gap-1.5">
              <div className="p-1 bg-blue-600 text-white rounded">
                <Gauge className="w-3.5 h-3.5" />
              </div>
              <h4 className="text-xs font-bold text-slate-900 tracking-tight">
                측정 결과 입력
              </h4>
            </div>

            {/* Quick Demo Sample Fill Actions */}
            <div className="flex items-center gap-1 text-[10px]">
              <button
                type="button"
                onClick={handleFillPassValue}
                className="px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold rounded border border-emerald-200 cursor-pointer transition-colors"
                title="합격 샘플값 자동 입력"
              >
                +합격
              </button>
              <button
                type="button"
                onClick={handleFillNGLowerValue}
                className="px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold rounded border border-rose-200 cursor-pointer transition-colors"
                title="하한 미달 불량값(249.023 mm 등) 자동 입력"
              >
                +NG(하한)
              </button>
              <button
                type="button"
                onClick={handleFillNGUpperValue}
                className="px-1.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold rounded border border-rose-200 cursor-pointer transition-colors"
                title="상한 초과 불량값(250.018 mm 등) 자동 입력"
              >
                +NG(상한)
              </button>
            </div>
          </div>

          {/* Item Selector Tabs (Compact, Zero-Clutter) */}
          <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 rounded border border-slate-200">
            {currentPoint.items.map((it) => {
              const itRec = record?.items?.[it.id];
              const isSelected = it.id === selectedItem.id;
              const isCompleted = itRec?.isCompleted ?? false;
              const judgement = itRec?.judgement ?? "PENDING";

              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onSelectItemId(it.id)}
                  className={`px-2 py-1 rounded text-xs font-semibold flex items-center justify-between gap-1 transition-all cursor-pointer ${
                    isSelected
                      ? "bg-white text-blue-900 shadow-2xs border border-blue-400/80 font-bold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                  }`}
                >
                  <span className="truncate">{it.name} 측정</span>
                  <span className="shrink-0">
                    {isCompleted ? (
                      judgement === "OK" ? (
                        <span className="inline-flex items-center text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                          OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[9px] font-bold text-rose-700 bg-rose-50 px-1 py-0.2 rounded border border-rose-200">
                          NG
                        </span>
                      )
                    ) : (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Unified Criteria & Tolerance Range (기준 치수 + 허용 범위 통합 컴팩트 블록) */}
          <div className="bg-slate-50 border border-slate-200 rounded p-2 flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0 pr-1">
              <span className="font-bold text-slate-800 block truncate">
                {selectedItem.standardDisplay}
              </span>
              <span className="text-[10px] font-mono text-slate-500 block truncate">
                계측기: {selectedItem.equipment}
              </span>
            </div>

            <div className="shrink-0 bg-blue-50/90 border border-blue-200 px-2 py-0.5 rounded text-right">
              <span className="text-[9px] font-bold text-blue-700 block uppercase leading-tight">
                {selectedItem.type === "DIMENSION" ? "허용 범위" : "허용 기준"}
              </span>
              <span className="font-mono text-sm font-extrabold text-blue-950 tabular-nums leading-tight">
                {selectedItem.toleranceDisplay}
              </span>
            </div>
          </div>

          {/* Single Measured Value Input Field */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[11px] font-bold text-slate-800">
                {selectedItem.name} 실측값 (Measured Value)
              </label>
              <span className="text-[10px] font-mono text-slate-400">
                단위: {selectedItem.unit}
              </span>
            </div>

            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                placeholder={`예: ${selectedItem.defaultPassValue.toFixed(3)}`}
                value={measuredInput}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setMeasuredInput(nextVal);
                  updateCurrentItem(nextVal);
                }}
                className="w-full h-9 px-3 pr-12 font-mono text-base font-bold text-slate-900 bg-white border border-slate-300 rounded focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition-colors tabular-nums"
              />
              <span className="absolute right-3 top-2 text-xs font-mono font-bold text-slate-400 pointer-events-none">
                {selectedItem.unit}
              </span>
            </div>
          </div>

          {/* OK/NG Decision Banner (실측값 입력 바로 아래 배치) */}
          <div
            className={`px-2.5 py-1.5 rounded border transition-all ${
              currentEvaluation.judgement === "OK"
                ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                : currentEvaluation.judgement === "NG"
                ? "bg-rose-50 border-rose-300 text-rose-950"
                : "bg-slate-100/70 border-slate-200 text-slate-700"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {currentEvaluation.judgement === "OK" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : currentEvaluation.judgement === "NG" ? (
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                )}

                <span
                  className={`text-xs font-extrabold tracking-tight ${
                    currentEvaluation.judgement === "OK"
                      ? "text-emerald-700"
                      : currentEvaluation.judgement === "NG"
                      ? "text-rose-700"
                      : "text-slate-600"
                  }`}
                >
                  {currentEvaluation.summaryText}
                </span>
              </div>

              {/* Exact Deviations Display */}
              <div className="text-right font-mono text-[11px] font-bold tabular-nums">
                <span className="text-slate-800">
                  편차: {formatDeviation(currentEvaluation.deviation)} mm
                </span>
                {currentEvaluation.limitDeviationText && (
                  <span className="text-rose-700 ml-1.5">
                    ({currentEvaluation.limitDeviationText})
                  </span>
                )}
              </div>
            </div>

            {/* Reason details (1 line if NG) */}
            {currentEvaluation.reasons.length > 0 && currentEvaluation.judgement === "NG" && (
              <div className="mt-1 pt-1 border-t border-rose-200/70 text-[10px] text-rose-800 leading-tight">
                {currentEvaluation.reasons[0]}
              </div>
            )}
          </div>

          {/* Remarks text (Compact) */}
          <div>
            <input
              type="text"
              placeholder="비고 / 검사 특이사항 (선택)..."
              value={notesInput}
              onChange={(e) => {
                const nextNotes = e.target.value;
                setNotesInput(nextNotes);
                updateCurrentItem(measuredInput, undefined, nextNotes);
              }}
              className="w-full h-7 px-2 text-[11px] bg-white border border-slate-300 rounded focus:border-blue-600 outline-none text-slate-800 transition-colors"
            />
          </div>

          {/* Complete Button & Next Helper (Compact 2-Column Grid) */}
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={handleToggleItemComplete}
              className={`h-8 px-2 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs ${
                isCurrentItemCompleted
                  ? "bg-slate-800 text-white hover:bg-slate-900"
                  : currentEvaluation.judgement === "NG"
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {isCurrentItemCompleted
                  ? `[${selectedItem.name}] 완료 해제`
                  : `[${selectedItem.name}] 완료 처리`}
              </span>
            </button>

            <button
              type="button"
              onClick={handleNextItemOrPoint}
              className="h-8 px-2 rounded text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
            >
              <span className="truncate">다음 항목 / 포인트</span>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          </div>
        </section>

        {/* ================= 2. 과거 오류 및 가공 불량 사례 (항상 펼침, NO Accordion) ================= */}
        <section className="bg-white border border-slate-200 rounded-md overflow-hidden shadow-2xs">
          {/* Card Header: Permanent, Always Visible */}
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="text-xs font-bold text-slate-800">
                과거 오류 및 가공 불량 사례
              </span>
              <span className="text-[10px] font-mono text-slate-500 font-semibold">
                | {relatedErrors.length > 0 ? `연관 ${relatedErrors.length}건` : "0건"}
              </span>
            </div>

            {/* Toggle to see remaining cases if multiple exist */}
            {relatedErrors.length > 1 && (
              <button
                type="button"
                onClick={() => setShowAllErrors(!showAllErrors)}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-0.5 cursor-pointer"
              >
                <span>{showAllErrors ? "주요 1건만 보기" : `전체 사례 보기 (${relatedErrors.length}건)`}</span>
                {showAllErrors ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            )}
          </div>

          {/* Card Body: Always Expanded */}
          <div className="p-2.5 space-y-2 bg-white">
            {relatedErrors.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-150">
                연관된 과거 오류 사례가 없습니다.
              </div>
            ) : (
              <>
                {/* Primary, most relevant error case is always shown */}
                <ErrorHistoryCard error={relatedErrors[0]} />

                {/* Additional cases shown if toggled */}
                {showAllErrors &&
                  relatedErrors.slice(1).map((err) => (
                    <ErrorHistoryCard key={err.id} error={err} />
                  ))}
              </>
            )}
          </div>
        </section>

        {/* ================= 3. 측정 전 확인 사항 (접기/펼치기 가능, 기본 접힘) ================= */}
        <section className="bg-white border border-slate-200 rounded-md overflow-hidden shadow-2xs">
          {/* Accordion Toggle Header */}
          <button
            type="button"
            onClick={() => setIsNoticesOpen(!isNoticesOpen)}
            className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between transition-colors border-b border-slate-200 cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="text-xs font-bold text-slate-800">
                측정 전 확인 사항
              </span>
              <span className="text-[10px] font-mono text-slate-500 font-semibold">
                | {currentPoint.notices.length}건
              </span>
            </div>

            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <span>{isNoticesOpen ? "접기" : "펼치기"}</span>
              {isNoticesOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
              )}
            </div>
          </button>

          {/* Accordion Body */}
          {isNoticesOpen && (
            <div className="p-2.5 bg-white">
              <PreInspectionNotices notices={currentPoint.notices} />
            </div>
          )}
        </section>

        {/* ================= 4. 기본 측정 규격 정보 (접기/펼치기 가능, 기본 접힘) ================= */}
        <section className="bg-white border border-slate-200 rounded-md overflow-hidden shadow-2xs">
          {/* Accordion Toggle Header */}
          <button
            type="button"
            onClick={() => setIsSpecsOpen(!isSpecsOpen)}
            className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between transition-colors border-b border-slate-200 cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="text-xs font-bold text-slate-800">
                기본 측정 규격 정보
              </span>
              <span className="text-[10px] font-mono text-slate-500 font-semibold">
                | 상세보기
              </span>
            </div>

            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <span>{isSpecsOpen ? "접기" : "펼치기"}</span>
              {isSpecsOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-600" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-600" />
              )}
            </div>
          </button>

          {/* Accordion Body */}
          {isSpecsOpen && (
            <div className="p-2.5 bg-white space-y-2 text-xs">
              {/* Row 1: Nominal & Tolerance */}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-500 block leading-tight">
                    도면 기준치 (Nominal)
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-900 block mt-0.5">
                    {currentPoint.dimension.formatted}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    단위: {currentPoint.dimension.unit}
                  </span>
                </div>

                <div className="bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-500 block leading-tight">
                    치수 허용 공차 (Tolerance)
                  </span>
                  <span className="font-mono text-xs font-bold text-blue-700 block mt-0.5">
                    {currentPoint.dimensionalTolerance.formatted}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {lowerBound} ~ {upperBound} mm
                  </span>
                </div>
              </div>

              {/* Row 2: GD&T & Datum */}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-500 block leading-tight">
                    기하공차 (GD&T)
                  </span>
                  {currentPoint.geometricTolerance ? (
                    <div className="mt-0.5">
                      <span className="font-mono font-bold text-xs text-slate-900">
                        {currentPoint.geometricTolerance.formatted}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {currentPoint.geometricTolerance.label}
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-400 text-xs mt-0.5 block">-</span>
                  )}
                </div>

                <div className="bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-500 block leading-tight">
                    기준면 (Datum)
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    {currentPoint.datumReferences.map((d) => (
                      <span
                        key={d}
                        className="inline-block px-1.5 py-0.2 font-mono font-bold text-xs bg-slate-900 text-white rounded"
                      >
                        {d}
                      </span>
                    ))}
                    <span className="text-[10px] text-slate-500 ml-1">
                      (공용 중심선 축)
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 3: Surface Finish & Equipment */}
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-500 block leading-tight">
                    표면거칠기 (Roughness)
                  </span>
                  <span className="font-mono font-semibold text-slate-800 block mt-0.5">
                    {currentPoint.surfaceFinish.parameter} {currentPoint.surfaceFinish.value} {currentPoint.surfaceFinish.unit}
                  </span>
                </div>

                <div className="bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="text-[10px] text-slate-500 block leading-tight">
                    권장 측정기 (Equipment)
                  </span>
                  <span className="font-medium text-slate-800 block mt-0.5 truncate" title={currentPoint.measurement.equipment}>
                    {currentPoint.measurement.equipment}
                  </span>
                </div>
              </div>

              {/* Sampling & Conditions */}
              <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200 space-y-0.5">
                <div className="flex items-start gap-1">
                  <span className="font-semibold text-slate-500 shrink-0">샘플링:</span>
                  <span className="text-slate-700 leading-tight">{currentPoint.measurement.samplingMethod}</span>
                </div>
                <div className="flex items-start gap-1">
                  <span className="font-semibold text-slate-500 shrink-0">환경 조건:</span>
                  <span className="text-slate-700 leading-tight">{currentPoint.measurement.temperatureCondition}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
