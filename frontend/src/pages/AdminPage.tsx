/**
 * 통합 관리자 페이지 (하나만 둔다).
 * 공통 부품·도면·OCR 결과를 관리하고 관리자 검토를 한다. 작업 목적(부품제작·조립·검증)으로 나누지 않는다.
 * 목적별 측정 결과·오류사례는 작업자 페이지가 다룬다.
 */
import { DrawingViewer } from "../components/DrawingViewer";
import { MeasurementTable } from "../components/MeasurementTable";
import { OcrMeasurementTable } from "../components/OcrMeasurementTable";
import { ResizablePanels } from "../components/ResizablePanels";
import { PositionPickBanner } from "./WorkspaceShared";
import type { AdminPageProps } from "./workspaceTypes";

export function AdminPage(props: AdminPageProps) {
  const {
    demoMode,
    selectedDrawing,
    document,
    ocrStatus,
    ocrStage,
    resultUrl,
    ocrPoints,
    filteredOcrPoints,
    activeOcrPoint,
    onSelectOcrPoint,
    demo,
    reviewPane,
    pickingPosition,
    onCancelPositionPick,
    onPlaceAt,
    reviewPreviewMarkers,
  } = props;

  const reviewing = !demoMode && reviewPane !== null;
  // 관리자 화면의 마커는 검토 상태만 보여준다 (목적별 측정 상태는 작업자 페이지에서 본다).
  const reviewMarkers = Object.fromEntries(
    ocrPoints.map((point) => [
      point.id,
      { status: document?.review_status === "reviewed" ? "pending" : "review_required" },
    ]),
  );

  return (
    <ResizablePanels left={<>
      {reviewing && pickingPosition && (
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
        inspectionRecords={demoMode ? demo.inspectionRecords : reviewMarkers}
        isAnalyzing={!demoMode && ocrStatus === "applying"}
        analyzingStep={0}
        analyzingStage={ocrStage}
        previewMarkers={reviewing ? reviewPreviewMarkers : []}
        onPlaceAt={reviewing && pickingPosition ? onPlaceAt : undefined}
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
          points={filteredOcrPoints}
          selectedId={activeOcrPoint?.id || 0}
          onSelect={onSelectOcrPoint}
          title={document.part_name || "도면"}
          records={{}}
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
        <section className="space-y-3 p-4">
          <h2 className="card-title">관리자 화면</h2>
          <p className="note note-info">
            데모 도면은 샘플이라 관리자 검토 대상이 아닙니다. 상단 「선택한 도면으로」 또는 「도면 목록으로」에서 등록 도면을 여세요.
          </p>
        </section>
      ) : reviewPane !== null ? (
        reviewPane
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
                {ocrStatus === "applying"
                  ? "CPU OCR 분석 중입니다. 완료되면 이 화면에서 바로 관리자 검토를 시작합니다."
                  : ocrStatus === "loading"
                    ? "OCR 결과를 불러오는 중입니다."
                    : "OCR 실행 대기 중입니다. 새 업로드는 자동 분석되며 기존 도면은 상단의 OCR 실행을 눌러주세요."}
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
