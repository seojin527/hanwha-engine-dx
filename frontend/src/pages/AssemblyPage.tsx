/**
 * 조립 작업자 페이지.
 * 왼쪽 측정 · 가운데 도면/기존 측정표 · 오른쪽 오류 사례를 배치한다.
 * 상태·API·저장은 App 이 넘겨주는 props 를 쓰고, 화면 배치만 이 페이지가 맡는다.
 * 조립 작업자가 아니면 readOnly 로 열려 조회만 한다. 관리자 검토는 통합 관리자 페이지(AdminPage)에서 한다.
 */
import { DrawingViewer } from "../components/DrawingViewer";
import { MeasurementTable } from "../components/MeasurementTable";
import { MeasurementPanel } from "../components/MeasurementPanel";
import { OcrMeasurementTable } from "../components/OcrMeasurementTable";
import { WorkerWorkspace } from "../components/worker/WorkerWorkspace";
import { WorkerErrorPanel } from "../components/worker/WorkerErrorPanel";
import { AssemblyPanel } from "../components/AssemblyPanel";
import { reviewInfoOf } from "../lib/ocr";
import { WorkerBlockedNotice } from "./WorkspaceShared";
import type { WorkspacePageProps } from "./workspaceTypes";

export function AssemblyPage(props: WorkspacePageProps) {
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
    onMeasurementSaved,
    demo,
    readOnly,
    workerBlocked,
  } = props;

  if (workerBlocked) {
    return <WorkerBlockedNotice />;
  }

  return (
    <WorkerWorkspace
      support={!demoMode && document && selectedDrawing && revision ? (
        <WorkerErrorPanel
          purpose="assembly" drawingId={selectedDrawing.drawing_id} revision={revision}
          point={activeOcrPoint} readOnly={readOnly}
        />
      ) : <p className="p-4 text-sm text-slate-500">도면의 측정항목을 선택하면 주의사항과 오류 사례를 확인할 수 있습니다.</p>}
      left={<>
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
        inspectionRecords={demoMode ? demo.inspectionRecords : ocrInspectionRecords}
        isAnalyzing={!demoMode && ocrStatus === "applying"}
        analyzingStep={0}
        analyzingStage={ocrStage}
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
          compact
          points={filteredOcrPoints}
          selectedId={activeOcrPoint?.id || 0}
          onSelect={onSelectOcrPoint}
          title={document.part_name || "도면"}
          records={measurementRecords}
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
      {demoMode ? (
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
        <div className="flex min-h-full flex-col">
          <div className="min-w-0">
            <AssemblyPanel
              readOnly={readOnly}
              drawingId={selectedDrawing.drawing_id}
              revision={revision}
              point={activeOcrPoint}
              total={ocrPoints.length}
              onNavigate={onNavigateOcr}
              onNextUnmeasured={(() => {
                const index = ocrPoints.findIndex(p => p.id === activeOcrPoint?.id);
                const ordered = [...ocrPoints.slice(index + 1), ...ocrPoints.slice(0, Math.max(0, index))];
                const next = ordered.find(p => p.source.inspection_approved && (!measurementRecords[p.source.id] || measurementRecords[p.source.id].status === 'pending'));
                return next ? () => onSelectOcrPoint(next.id) : undefined;
              })()}
              onMeasurementSaved={onMeasurementSaved}
              records={measurementRecords}
              reviewInfo={reviewInfoOf(document)}
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
