/**
 * 부품제작 작업 페이지.
 * 도면 뷰어 · 마커 · 하단 측정표 · 오른쪽 패널을 이 파일에서 직접 배치한다.
 * 상태·API·저장은 App 이 넘겨주는 props 를 쓰고, 화면 배치만 이 페이지가 맡는다.
 */
import { DrawingViewer } from "../components/DrawingViewer";
import { MeasurementTable } from "../components/MeasurementTable";
import { MeasurementPanel } from "../components/MeasurementPanel";
import { OcrMeasurementTable } from "../components/OcrMeasurementTable";
import { ResizablePanels } from "../components/ResizablePanels";
import { ManufacturingPanel } from "../components/ManufacturingPanel";
import { reviewInfoOf, type OcrPoint } from "../lib/ocr";
import { useEffect } from "react";
import { useMachining } from "../lib/machiningAPI";
import { PositionPickBanner, WorkerBlockedNotice } from "./WorkspaceShared";
import type { WorkspacePageProps } from "./workspaceTypes";

export function ManufacturingPage(props: WorkspacePageProps) {
  const {
    demoMode,
    selectedDrawing,
    document,
    ocrStatus,
    ocrStage,
    revision,
    resultUrl,
    ocrPoints,
    filteredOcrPoints,
    activeOcrPoint,
    ocrInspectionRecords,
    measurementRecords,
    onSelectOcrPoint,
    onNavigateOcr,
    demo,
    reviewOpen,
    pickingPosition,
    onCancelPositionPick,
    onPlaceAt,
    reviewPreviewMarkers,
    reviewPane,
    workerBlocked,
    canOpenReview,
    onOpenReview,
  } = props;

  // ---------------------------------------------------------------- 가공 단계 (황삭·중삭·정삭)
  const machining = useMachining(
    demoMode || !document ? null : selectedDrawing?.drawing_id ?? null,
    revision,
  );
  const stageOn =
    !demoMode && !reviewOpen && document?.review_status === "reviewed" && machining.stageItemIds !== null;
  const stageIds = machining.stageItemIds;
  // 이번 단계에서 잴 항목 (이전·다음 이동과 하단 표)
  const stagePoints = stageOn ? ocrPoints.filter((point) => stageIds!.has(point.source.id)) : ocrPoints;
  const stageTablePoints: OcrPoint[] = stageOn
    ? filteredOcrPoints
        .filter((point) => stageIds!.has(point.source.id))
        .map((point) => {
          // 황삭·중삭 여유 확인 항목은 도면 공차 대신 단계 목표 범위를 보여준다.
          const criteria = machining.itemPlan(point.source.id)?.stages[machining.stage];
          if (criteria?.role !== "allowance" || criteria.lower_limit === null || criteria.upper_limit === null) return point;
          const window = (criteria.upper_limit - criteria.lower_limit) / 2;
          return {
            ...point,
            source: {
              ...point.source,
              nominal_value: criteria.target ?? undefined,
              upper_deviation: window,
              lower_deviation: -window,
              lower_limit: criteria.lower_limit,
              upper_limit: criteria.upper_limit,
              tolerance_source: undefined,
            },
          };
        })
    : filteredOcrPoints;
  // 도면 번호 색: 이번 단계 = 단계 색(측정하면 합격·재측정 색), 다른 단계 = 회색
  const stageMarkerRecords: Record<number, { status: string }> = stageOn
    ? Object.fromEntries(
        ocrPoints.map((point) => {
          const record = machining.stageRecords[point.source.id];
          const status = !stageIds!.has(point.source.id)
            ? "stage-other"
            : record && record.status !== "pending"
              ? record.status
              : `stage-${machining.stage}`;
          return [point.id, { status }];
        }),
      )
    : ocrInspectionRecords;
  const stageIndex = stagePoints.findIndex((point) => point.id === activeOcrPoint?.id);
  const navigateStage = (delta: number) => {
    if (!stageOn) return onNavigateOcr(delta);
    if (!stagePoints.length) return;
    const index = stageIndex < 0 ? (delta > 0 ? -1 : 0) : stageIndex;
    onSelectOcrPoint(stagePoints[(index + delta + stagePoints.length) % stagePoints.length].id);
  };
  // 단계가 바뀌면 그 단계의 첫 항목으로 이동한다.
  const stageListKey = stageOn ? `${machining.stage}:${stagePoints.map((point) => point.id).join(",")}` : "";
  useEffect(() => {
    if (!stageListKey || !stagePoints.length) return;
    if (!stagePoints.some((point) => point.id === activeOcrPoint?.id)) onSelectOcrPoint(stagePoints[0].id);
  }, [stageListKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (workerBlocked) {
    return <WorkerBlockedNotice canOpenReview={canOpenReview} onOpenReview={onOpenReview} />;
  }

  return (
    <ResizablePanels left={<>
      {!demoMode && reviewOpen && pickingPosition && (
        <PositionPickBanner onCancel={onCancelPositionPick} />
      )}

      <DrawingViewer
        key={
          demoMode
            ? "demo"
            : selectedDrawing?.drawing_id || "empty"
        }
        drawingUrl={
          demoMode ? "/images/1_image.png" : resultUrl
        }
        mediaType={
          demoMode ? "image/png" : document ? "image/jpeg" : selectedDrawing?.media_type
        }
        points={demoMode ? demo.points : filteredOcrPoints}
        coordinateSize={!demoMode && document ? { width: document.image.width_px, height: document.image.height_px } : undefined}
        selectedPointId={demoMode ? demo.selectedPointId : activeOcrPoint?.id || 0}
        onSelectPoint={demoMode ? demo.onSelectPoint : onSelectOcrPoint}
        inspectionRecords={demoMode ? demo.inspectionRecords : stageMarkerRecords}
        isAnalyzing={!demoMode && ocrStatus === "applying"}
        analyzingStep={0}
        analyzingStage={ocrStage}
        previewMarkers={
          !demoMode && reviewOpen ? reviewPreviewMarkers : []
        }
        onPlaceAt={
          !demoMode && reviewOpen && pickingPosition
            ? onPlaceAt
            : undefined
        }
      />

      {demoMode ? (
        <MeasurementTable
          points={demo.points}
          selectedPointId={demo.selectedPointId}
          onSelectPoint={demo.onSelectPoint}
          inspectionRecords={demo.inspectionRecords}
          selectedItemId={demo.selectedItemId}
          onSelectItem={demo.onSelectItem}
        />
      ) : document ? (
        <OcrMeasurementTable
          points={stageTablePoints}
          selectedId={activeOcrPoint?.id || 0}
          onSelect={onSelectOcrPoint}
          title={stageOn ? `${document.part_name || "도면"} · ${machining.serial} ${["", "황삭", "중삭", "정삭"][Number(machining.stage)]}` : document.part_name || "도면"}
          records={stageOn ? machining.stageRecords : measurementRecords}
          reviewed={document.review_status === "reviewed"}
        />
      ) : (
        <section className="flex shrink-0 items-baseline gap-3 border-t border-slate-800 bg-slate-900 px-3 py-2">
          <h2 className="text-xs font-semibold text-slate-200">
            측정항목
          </h2>
          <p className="min-w-0 text-[11px] text-slate-400">
            {selectedDrawing
              ? (ocrStatus === "applying" ? "OCR 분석 중…" : "원본 도면입니다. OCR 실행을 누르면 분석 후 번호와 측정항목이 표시됩니다.")
              : "도면을 선택하거나 등록해주세요."}
          </p>
        </section>
      )}
    </>} right={<>
      {!demoMode && reviewOpen ? (
        reviewPane
      ) : demoMode ? (
        <MeasurementPanel
          currentPoint={demo.currentPoint}
          totalPointsCount={demo.total}
          onNavigatePoint={demo.onNavigatePoint}
          record={demo.inspectionRecords[demo.selectedPointId] || {}}
          onSaveRecord={demo.onSaveRecord}
          selectedItemId={demo.selectedItemId}
          onSelectItemId={demo.onSelectItemId}
        />
      ) : document && selectedDrawing && revision ? (
        <div className="flex h-full min-h-0 flex-col bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ManufacturingPanel
              drawingId={selectedDrawing.drawing_id}
              revision={revision}
              point={activeOcrPoint}
              position={stageIndex + 1}
              total={stagePoints.length}
              labelTotal={ocrPoints.length}
              onNavigate={navigateStage}
              reviewInfo={reviewInfoOf(document)}
              machining={machining}
              unit={document.unit || "mm"}
            />
          </div>
        </div>
      ) : (
        <section className="space-y-3 p-4">
          <h2 className="card-title">
            도면 정보
          </h2>

          {selectedDrawing ? (
            <>
              <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-slate-500">파일명</dt>
                <dd className="break-all text-slate-900">
                  {selectedDrawing.original_filename}
                </dd>
                <dt className="text-slate-500">파일 크기</dt>
                <dd className="font-mono text-slate-900">
                  {(
                    selectedDrawing.size_bytes /
                    1024 /
                    1024
                  ).toFixed(2)}{" "}
                  MB
                </dd>
              </dl>

              <p className={`note ${ocrStatus === "applying" ? "note-info" : "note-warn"}`}>
                {ocrStatus === "applying" ? "CPU OCR 분석 중입니다. 완료 후 측정항목을 표시하고 관련 오류·주의사항을 검색합니다." : "OCR 실행 대기 중입니다. 새 업로드는 자동 분석되며 기존 도면은 상단의 OCR 실행을 눌러주세요."}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              상단에서 부품과 도면을 선택해주세요.
            </p>
          )}
        </section>
      )}
    </>} />
  );
}
