/**
 * 조립·검증 작업자 화면 (두 업무는 저장소·문구만 다르고 배치는 같다).
 *
 * 왼쪽 작업 패널: 진행률·필터·측정 항목 목록 → 선택 항목의 검사 기준·측정 입력·판정 → 하단 고정 버튼
 * 오른쪽: 도면(크게, 선택 항목 강조) → 아래 접을 수 있는 「측정 전 주의사항 / 오류 사례」
 * 저장 API·판정 규칙은 OcrMeasurementEntry 그대로. 담당이 아니면 readOnly(조회 전용).
 */
import { useState } from "react";
import { DrawingViewer } from "../components/DrawingViewer";
import { MeasurementTable } from "../components/MeasurementTable";
import { MeasurementPanel } from "../components/MeasurementPanel";
import { ResizablePanels } from "../components/ResizablePanels";
import OcrMeasurementEntry from "../components/OcrMeasurementEntry";
import { PointErrorForm } from "../components/PointErrorForm";
import { CriteriaSummary, WorkAssistPanel, WorkItemHeading, WorkItemList, useCaseSearch, workStatusOf } from "../components/work/WorkParts";
import { fetchItemErrors } from "../lib/drawingAPI";
import { WORK_PURPOSES, type WorkPurpose } from "../lib/purpose";
import { WorkerBlockedNotice } from "./WorkspaceShared";
import type { WorkspacePageProps } from "./workspaceTypes";

export function MeasureWorkPage({ purpose, ...props }: WorkspacePageProps & { purpose: Exclude<WorkPurpose, "manufacturing"> }) {
  const {
    demoMode,
    selectedDrawing,
    document,
    ocrStatus,
    ocrStage,
    revision,
    resultUrl,
    filteredOcrPoints,
    activeOcrPoint,
    ocrInspectionRecords,
    measurementRecords,
    onSelectOcrPoint,
    onNavigateOcr,
    onMeasurementSaved,
    demo,
    readOnly,
    workerBlocked,
  } = props;
  const label = WORK_PURPOSES.find((entry) => entry.value === purpose)?.label ?? purpose;
  const drawingId = selectedDrawing?.drawing_id ?? "";
  const item = activeOcrPoint?.source;
  const key = `${purpose}/${drawingId}/${revision}/${item?.id}`;
  const working = !demoMode && !!document && !!selectedDrawing && !!revision;

  // 관련 오류 사례 검색 (이 업무 저장소만). 왼쪽 패널과 오른쪽 보조 영역이 함께 쓴다.
  const search = useCaseSearch(key, working && !!item, async (signal) => {
    const response = await fetchItemErrors(purpose, drawingId, item!.id, signal);
    if (response.drawing_id !== drawingId || response.item_id !== item!.id || response.revision !== revision) {
      throw new Error("도면 결과가 변경됐습니다. 도면을 다시 선택해주세요.");
    }
    return response.errors;
  });
  const [linkedCount, setLinkedCount] = useState<number | null>(null);

  if (workerBlocked) return <WorkerBlockedNotice />;

  const viewer = (
    <DrawingViewer
      key={demoMode ? "demo" : selectedDrawing?.drawing_id || "empty"}
      drawingUrl={demoMode ? "/images/1_image.png" : resultUrl}
      mediaType={demoMode ? "image/png" : document ? "image/jpeg" : selectedDrawing?.media_type}
      points={demoMode ? demo.points : filteredOcrPoints}
      coordinateSize={!demoMode && document ? { width: document.image.width_px, height: document.image.height_px } : undefined}
      selectedPointId={demoMode ? demo.selectedPointId : activeOcrPoint?.id || 0}
      onSelectPoint={demoMode ? demo.onSelectPoint : onSelectOcrPoint}
      inspectionRecords={demoMode ? demo.inspectionRecords : ocrInspectionRecords}
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
              linked={
                <PointErrorForm
                  key={`cases-${key}`}
                  purpose={purpose}
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
          <div className="flex h-full min-h-0 flex-col bg-dx-panel text-dx-text">
            <WorkItemList
              points={filteredOcrPoints}
              selectedId={activeOcrPoint?.id || 0}
              onSelect={onSelectOcrPoint}
              statusOf={(point) => workStatusOf(measurementRecords[point.source.id])}
              progressLabel={`${label} 측정 완료${readOnly ? " · 조회 전용" : ""}`}
            />
            {activeOcrPoint ? (
              <>
                <WorkItemHeading
                  point={activeOcrPoint}
                  title={activeOcrPoint.feature.name}
                  status={workStatusOf(measurementRecords[activeOcrPoint.source.id])}
                />
                <OcrMeasurementEntry
                  key={`measurement-${key}`}
                  purpose={purpose}
                  readOnly={readOnly}
                  drawingId={drawingId}
                  revision={revision!}
                  item={activeOcrPoint.source}
                  onSaved={onMeasurementSaved}
                  onNavigate={onNavigateOcr}
                  criteria={<CriteriaSummary item={activeOcrPoint.source} />}
                />
              </>
            ) : (
              <p className="p-4 text-sm text-dx-muted">위 목록이나 도면 번호에서 측정 항목을 고르세요.</p>
            )}
          </div>
        ) : (
          <NoDocument selected={!!selectedDrawing} name={selectedDrawing?.original_filename} analyzing={ocrStatus === "applying"} />
        )
      }
    />
  );
}

/** OCR 결과가 없는 도면 (작업할 측정 항목이 아직 없음) */
export function NoDocument({ selected, name, analyzing }: { selected: boolean; name?: string; analyzing: boolean }) {
  return (
    <section className="space-y-2 bg-dx-panel p-4 text-xs text-dx-text">
      <h2 className="text-[13px] font-semibold text-white">{selected ? name : "도면을 선택해주세요"}</h2>
      <p className="text-dx-muted">
        {!selected
          ? "상단에서 부품과 도면을 선택해주세요."
          : analyzing
            ? "OCR 분석 중입니다. 끝나면 측정 항목이 표시됩니다."
            : "OCR 결과와 관리자 검토가 있어야 측정을 시작할 수 있습니다. 관리자에게 요청해주세요."}
      </p>
    </section>
  );
}
