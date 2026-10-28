/**
 * 부품제작 작업자 페이지.
 * 왼쪽 작업 패널(제품 번호·단계 → 이번 단계 항목 목록 → 기준·입력·판정 → 하단 고정 버튼),
 * 오른쪽 도면(크게) + 아래 접을 수 있는 「측정 전 주의사항 / 오류 사례」.
 * 상태·API·저장은 App 이 넘겨주는 props 를 쓰고, 화면 배치만 이 페이지가 맡는다.
 * 부품제작 작업자가 아니면 readOnly 로 열려 조회만 한다. 관리자 검토는 통합 관리자 페이지(AdminPage)에서 한다.
 */
import { DrawingViewer } from "../components/DrawingViewer";
import { MeasurementTable } from "../components/MeasurementTable";
import { MeasurementPanel } from "../components/MeasurementPanel";
import { ResizablePanels } from "../components/ResizablePanels";
import { ManufacturingPanel } from "../components/ManufacturingPanel";
import { PointErrorForm } from "../components/PointErrorForm";
import { WorkAssistPanel, useCaseSearch } from "../components/work/WorkParts";
import type { OcrPoint } from "../lib/ocr";
import { useEffect, useState } from "react";
import { fetchStageErrors, useMachining } from "../lib/machiningAPI";
import { NoDocument } from "./MeasureWorkPage";
import { WorkerBlockedNotice } from "./WorkspaceShared";
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
    readOnly,
    workerBlocked,
  } = props;

  // ---------------------------------------------------------------- 가공 단계 (황삭·중삭·정삭)
  const machining = useMachining(
    demoMode || !document ? null : selectedDrawing?.drawing_id ?? null,
    revision,
  );
  const stageOn =
    !demoMode && document?.review_status === "reviewed" && machining.stageItemIds !== null;
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

  // 관련 오류 사례: 이번 단계(황삭 후·중삭 후·정삭 후)와 '가공 공통' 사례만 찾는다.
  const drawingId = selectedDrawing?.drawing_id ?? "";
  const item = activeOcrPoint?.source;
  const working = !demoMode && !!document && !!selectedDrawing && !!revision;
  const caseKey = `manufacturing/${drawingId}/${revision}/${machining.serial}/${machining.stage}/${item?.id}`;
  const search = useCaseSearch(caseKey, working && !!item, async (signal) =>
    (await fetchStageErrors(drawingId, item!.id, machining.stage, signal)).errors,
  );
  const [linkedCount, setLinkedCount] = useState<number | null>(null);

  if (workerBlocked) {
    return <WorkerBlockedNotice />;
  }

  const viewer = (
    <DrawingViewer
      key={demoMode ? "demo" : selectedDrawing?.drawing_id || "empty"}
      drawingUrl={demoMode ? "/images/1_image.png" : resultUrl}
      mediaType={demoMode ? "image/png" : document ? "image/jpeg" : selectedDrawing?.media_type}
      points={demoMode ? demo.points : filteredOcrPoints}
      coordinateSize={!demoMode && document ? { width: document.image.width_px, height: document.image.height_px } : undefined}
      selectedPointId={demoMode ? demo.selectedPointId : activeOcrPoint?.id || 0}
      onSelectPoint={demoMode ? demo.onSelectPoint : onSelectOcrPoint}
      inspectionRecords={demoMode ? demo.inspectionRecords : stageMarkerRecords}
      isAnalyzing={!demoMode && ocrStatus === "applying"}
      analyzingStep={0}
      analyzingStage={ocrStage}
    />
  );

  if (demoMode) {
    return (
      <ResizablePanels
        left={<>{viewer}<MeasurementTable points={demo.points} selectedPointId={demo.selectedPointId} onSelectPoint={demo.onSelectPoint} inspectionRecords={demo.inspectionRecords} selectedItemId={demo.selectedItemId} onSelectItem={demo.onSelectItem} /></>}
        right={<MeasurementPanel currentPoint={demo.currentPoint} totalPointsCount={demo.total} onNavigatePoint={demo.onNavigatePoint} record={demo.inspectionRecords[demo.selectedPointId] || {}} onSaveRecord={demo.onSaveRecord} selectedItemId={demo.selectedItemId} onSelectItemId={demo.onSelectItemId} />}
      />
    );
  }

  return (
    <ResizablePanels
      left={
        <>
          {viewer}
          {working && activeOcrPoint && (
            <WorkAssistPanel
              search={search}
              linkedCount={linkedCount}
              emptyNote={`${["", "황삭", "중삭", "정삭"][Number(machining.stage)]} 측정 전에 확인할 내용입니다.`}
              linked={
                <PointErrorForm
                  key={`cases-${caseKey}`}
                  purpose="manufacturing"
                  readOnly={readOnly}
                  drawingId={drawingId}
                  revision={revision!}
                  item={activeOcrPoint.source}
                  number={activeOcrPoint.displayNumber}
                  onIndexed={search.retry}
                  onCount={setLinkedCount}
                />
              }
            />
          )}
        </>
      }
      right={
        working ? (
          <ManufacturingPanel
            readOnly={readOnly}
            drawingId={drawingId}
            revision={revision!}
            point={activeOcrPoint}
            points={stageTablePoints}
            onSelect={onSelectOcrPoint}
            onNavigate={navigateStage}
            machining={machining}
            unit={document!.unit || "mm"}
          />
        ) : (
          <NoDocument selected={!!selectedDrawing} name={selectedDrawing?.original_filename} analyzing={ocrStatus === "applying"} />
        )
      }
    />
  );
}
