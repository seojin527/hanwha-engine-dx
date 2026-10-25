/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { DrawingLibrary } from "./components/DrawingLibrary";
import { DrawingViewer } from "./components/DrawingViewer";
import { MeasurementTable } from "./components/MeasurementTable";
import { MeasurementPanel } from "./components/MeasurementPanel";
import { MOCK_MEASUREMENT_POINTS } from "./data/mockData";
import { DEFAULT_INITIAL_RESULTS, STORAGE_KEYS } from "./lib/inspection";
import { apiUrl } from './lib/drawingAPI';
import { useDrawingOcr } from './hooks/useDrawingOcr';
import { reviewInfoOf, toOcrPoints } from './lib/ocr';
import { OcrMeasurementTable } from './components/OcrMeasurementTable';
import { OcrDetailPanel } from './components/OcrDetailPanel';
import type { Drawing } from "./lib/drawingAPI";
import DrawingReviewHistory from "./components/DrawingReviewHistory";

import { ResizablePanels } from "./components/ResizablePanels";

import {
  fetchMeasurements,
  type MeasurementRecord,
  type SavedMeasurement,
} from "./lib/measurementAPI";


import DrawingReviewPanel from "./components/DrawingReviewPanel";
import {
  fetchDrawingReview,
  type DrawingReviewSource,
  type ReviewPreviewMarker,
  fetchDrawingReviewFiles,
  type ReviewResultFile,
} from "./lib/admin/drawingReviewAPI";

export function App() {
  const [selectedPointId, setSelectedPointId] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState("p1-item");
  const [searchQuery, setSearchQuery] = useState("");

  const [demoMode, setDemoMode] = useState(true);
  const [selectedDrawing, setSelectedDrawing] =
    useState<Drawing | null>(null);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);

  const [uploadRequest, setUploadRequest] = useState(0);
  const ocr = useDrawingOcr(demoMode ? null : selectedDrawing?.drawing_id || null);
  const document = ocr.snapshot?.result || null;
  const ocrPoints = document ? toOcrPoints(document) : [];
  const activeOcrPoint = ocrPoints.find((point) => point.id === selectedPointId) || ocrPoints[0];
  const filteredOcrPoints = ocrPoints.filter((point) => {
    const query = searchQuery.toLowerCase();
    return `${point.displayNumber} ${point.source.raw_text} ${point.feature.name} ${point.source.id}`.toLowerCase().includes(query);
  });
  const resultUrl = document && ocr.snapshot?.image_url ? apiUrl(ocr.snapshot.image_url) : drawingUrl;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSource, setReviewSource] =
    useState<DrawingReviewSource | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewFiles, setReviewFiles] = useState<ReviewResultFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState("");
  const [measurementData, setMeasurementData] = useState<{
    target: string;
    records: Record<string, MeasurementRecord>;
  }>({ target: "", records: {} });

  const [measurementError, setMeasurementError] = useState("");
  const [previewFile, setPreviewFile] = useState<ReviewResultFile | null>(null);
  const filePreviewDialog = useRef<HTMLDialogElement>(null);
  const [pickingPosition, setPickingPosition] = useState(false);
  const [reviewPreviewMarkers, setReviewPreviewMarkers] =
    useState<ReviewPreviewMarker[]>([]);

  const positionResolver = useRef<
    ((position: { x: number; y: number } | null) => void) | null
  >(null);

  function finishPositionPick(
    position: { x: number; y: number } | null,
  ) {
    const resolve = positionResolver.current;
    positionResolver.current = null;
    setPickingPosition(false);
    resolve?.(position);
  }

  function requestPositionPick(): Promise<{
    x: number;
    y: number;
  } | null> {
    // 이전 선택 요청이 남아 있다면 취소한다.
    positionResolver.current?.(null);

    return new Promise((resolve) => {
      positionResolver.current = resolve;
      setPickingPosition(true);
    });
  }

  const reviewDrawingId = demoMode
    ? null
    : selectedDrawing?.drawing_id || null;
  const reviewRevision = ocr.snapshot?.revision;
  
  const measurementTarget = `${reviewDrawingId}:${reviewRevision}`;
  const activeMeasurementTarget = useRef(measurementTarget);
  activeMeasurementTarget.current = measurementTarget;

  const measurementRecords =
    measurementData.target === measurementTarget
      ? measurementData.records
      : {};

  useEffect(() => {
    const controller = new AbortController();
    setMeasurementError("");

    if (!reviewDrawingId || !reviewRevision) return;

    const target = `${reviewDrawingId}:${reviewRevision}`;

    fetchMeasurements(
      reviewDrawingId,
      reviewRevision,
      controller.signal,
    )
      .then((response) => {
        if (
          controller.signal.aborted ||
          activeMeasurementTarget.current !== target
        ) {
          return;
        }

        if (
          response.drawing_id !== reviewDrawingId ||
          response.revision !== reviewRevision
        ) {
          throw new Error("측정 결과의 버전이 일치하지 않습니다.");
        }

        const records = Object.fromEntries(
          response.records.map((record) => [record.item_id, record]),
        );

        setMeasurementData((previous) => ({
          target,
          records: {
            ...records,
            ...(previous.target === target ? previous.records : {}),
          },
        }));
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted &&
          activeMeasurementTarget.current === target
        ) {
          setMeasurementError(
            cause instanceof Error ? cause.message : "측정 결과 조회 실패",
          );
        }
      });

    return () => controller.abort();
  }, [reviewDrawingId, reviewRevision]);

  function handleMeasurementSaved(record: SavedMeasurement) {
    const target = `${record.drawing_id}:${record.revision}`;

    if (activeMeasurementTarget.current !== target) return;

    setMeasurementData((previous) => ({
      target,
      records: {
        ...(previous.target === target ? previous.records : {}),
        [record.item_id]: record,
      },
    }));
  }

  const ocrInspectionRecords = Object.fromEntries(
    ocrPoints.map((point) => {
      const record = measurementRecords[point.source.id];

      return [
        point.id,
        {
          status:
            document?.review_status !== "reviewed"
              ? "review_required"
              : record?.status ?? "pending",
        },
      ];
    }),
  );
  const workerBlocked =
    !demoMode &&
    !reviewOpen &&
    !!document &&
    document.review_status !== "reviewed";
  // 검토 완료 때 서버가 결과 파일을 자동으로 만든다. 저장할 때마다 revision 이 바뀌므로 다시 불러온다.
  const documentReviewed = document?.review_status === "reviewed";
  useEffect(() => {
    setReviewFiles([]);
    setFileError("");
    if (!reviewDrawingId || !reviewRevision || !documentReviewed) return;

    const controller = new AbortController();
    setLoadingFiles(true);
    fetchDrawingReviewFiles(reviewDrawingId, reviewRevision, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setReviewFiles(result.files);
        setFileError(result.error ?? "");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setFileError(cause instanceof Error ? cause.message : "결과 파일 조회 실패");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFiles(false);
      });
    return () => controller.abort();
  }, [reviewDrawingId, reviewRevision, documentReviewed]);

    // 다른 도면·버전으로 이동하거나 검토 패널을 닫으면 선택을 취소한다.
  useEffect(() => {
    setPickingPosition(false);

    return () => {
      positionResolver.current?.(null);
      positionResolver.current = null;
    };
  }, [reviewOpen, reviewDrawingId, reviewRevision]);

  useEffect(() => {
    if (!pickingPosition) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        finishPositionPick(null);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [pickingPosition]);

  // 도면을 바꾸면 관리자 패널과 이전 알림을 닫는다.
  useEffect(() => {
    setReviewOpen(false);
    setHistoryOpen(false);
    setReviewSource(null);
    setReviewError("");
    setReviewNotice("");
  }, [reviewDrawingId]);

  useEffect(() => {
    setReviewSource(null);
    setReviewError("");

    if (!reviewOpen || !reviewDrawingId || !reviewRevision) {
      setReviewLoading(false);
      return;
    }

  

    const controller = new AbortController();
    setReviewLoading(true);

    fetchDrawingReview(reviewDrawingId, controller.signal)
      .then((source) => {
        if (controller.signal.aborted) return;
        if (
          source.drawing_id !== reviewDrawingId ||
          source.revision !== reviewRevision
        ) {
          throw new Error(
            "OCR 결과가 변경됐습니다. 패널을 닫고 결과를 다시 조회해주세요.",
          );
        }
        setReviewSource(source);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setReviewError(
          cause instanceof Error ? cause.message : "검수 정보 조회 실패",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setReviewLoading(false);
      });

    return () => controller.abort();
  }, [reviewOpen, reviewDrawingId, reviewRevision]);

  useEffect(() => {
    const dialog = filePreviewDialog.current;
    if (!previewFile || !dialog) return;

    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [previewFile]);

  useEffect(() => {
    setPreviewFile(null);
  }, [reviewDrawingId, reviewRevision]);

  const activeReviewSource =
    reviewSource?.drawing_id === reviewDrawingId &&
    reviewSource?.revision === reviewRevision
      ? reviewSource
      : null;


  function navigateOcr(delta: number) {
    if (!ocrPoints.length) return;
    const index = ocrPoints.findIndex((point) => point.id === activeOcrPoint?.id);
    setSelectedPointId(ocrPoints[(index + delta + ocrPoints.length) % ocrPoints.length].id);
  }

  async function runSelectedOcr() {
    setSelectedPointId(1);
    await ocr.run();
  }

  // 기존 데모 검사 기록 유지
  const [inspectionRecords, setInspectionRecords] =
    useState<Record<number, any>>(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.RESULTS);
        if (saved) return JSON.parse(saved);
      } catch (error) {
        console.error(error);
      }
      return DEFAULT_INITIAL_RESULTS;
    });

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.RESULTS,
        JSON.stringify(inspectionRecords)
      );
    } catch (error) {
      console.error(error);
    }
  }, [inspectionRecords]);

  function selectPoint(id: number) {
    const point = MOCK_MEASUREMENT_POINTS.find(
      (entry) => (entry.id || entry.displayNumber) === id
    );

    setSelectedPointId(id);
    setSelectedItemId(point?.items?.[0]?.id || `p${id}-item`);
  }

  function handleResetData() {
    if (!window.confirm("데모 검사 기록을 초기화하시겠습니까?")) return;

    setInspectionRecords(DEFAULT_INITIAL_RESULTS);
    selectPoint(1);
  }

  const filteredPoints = MOCK_MEASUREMENT_POINTS.filter((point) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      (point.feature?.name || "").toLowerCase().includes(query) ||
      (point.dimension?.formatted || "").toLowerCase().includes(query) ||
      String(point.displayNumber).includes(query)
    );
  });

  const currentPoint =
    MOCK_MEASUREMENT_POINTS.find(
      (point) => (point.id || point.displayNumber) === selectedPointId
    ) || MOCK_MEASUREMENT_POINTS[0];

  function handleNavigatePoint(delta: number) {
    const total = MOCK_MEASUREMENT_POINTS.length;
    if (!total) return;

    const currentIndex = MOCK_MEASUREMENT_POINTS.findIndex(
      (point) => (point.id || point.displayNumber) === selectedPointId
    );

    const nextIndex = (currentIndex + delta + total) % total;
    const next = MOCK_MEASUREMENT_POINTS[nextIndex];
    selectPoint(next.id || next.displayNumber);
  }

  function handleSaveRecord(updatedRecord: any) {
    setInspectionRecords((previous) => ({
      ...previous,
      [selectedPointId]: updatedRecord,
    }));
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans">
      <Header
        displayInfo={demoMode ? undefined : { partName: document?.part_name || "등록 부품", drawingName: selectedDrawing?.original_filename || "선택 대기" }}
        onUploadDrawing={() => setUploadRequest((value) => value + 1)}
        onResetData={handleResetData}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <DrawingLibrary
        uploadRequest={uploadRequest}
        onSelectDrawing={(drawing, url) => {
          setSelectedPointId(1);
          setSelectedDrawing(drawing);
          setDrawingUrl(url);
          setDemoMode(false);
        }}
        onClearDrawing={() => {
          setSelectedDrawing(null);
          setDrawingUrl(null);
          setDemoMode(false);
        }}
      />

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-1.5 text-xs">
        <span className="min-w-0 truncate text-slate-300">
          {demoMode
            ? "데모 도면 · 샘플 측정항목"
            : selectedDrawing
            ? `${selectedDrawing.original_filename} · ${document ? `OCR 추출 ${ocrPoints.length}건` : ocr.status === "applying" ? "OCR 분석 중…" : "OCR 미실행"}`
            : "등록된 도면을 선택해주세요"}
        </span>

                  {!demoMode && selectedDrawing && document && (
          <div className="flex shrink-0 overflow-hidden rounded border border-slate-600">
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              className={`px-3 py-1 ${
                !reviewOpen
                  ? "bg-cyan-600 font-bold text-white"
                  : "bg-slate-800 text-slate-300"
              }`}
            >
              작업자
            </button>

            <button
              type="button"
              disabled={ocr.status !== "ready"}
              onClick={() => {
                setReviewNotice("");
                setReviewOpen(true);
              }}
              className={`px-3 py-1 disabled:opacity-40 ${
                reviewOpen
                  ? "bg-cyan-600 font-bold text-white"
                  : "bg-slate-800 text-slate-300"
              }`}
            >
              관리자
            </button>
          </div>
        )}

          {!demoMode && selectedDrawing && (
          <button
            type="button"
            disabled={ocr.status === "loading" || ocr.status === "applying"}
            onClick={() => void runSelectedOcr()}
            className="shrink-0 rounded border border-cyan-700 bg-cyan-950 px-3 py-1 text-cyan-200 disabled:opacity-40"
          >
            {ocr.status === "applying"
              ? ocr.stage || "OCR 분석 중…"
              : document
                ? "OCR 결과 다시 조회"
                : ocr.status === "error"
                  ? "OCR 재시도"
                  : "OCR 실행"}
          </button>
        )}

          {!demoMode && document && (
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="shrink-0 rounded border border-slate-500 px-3 py-1 text-slate-200"
          >
            수정 이력
          </button>
        )}

        {!demoMode && (
          <button
            type="button"
            onClick={() => setDemoMode(true)}
            className="shrink-0 text-cyan-300 hover:text-cyan-200"
          >
            데모 화면 보기
          </button>
        )}

        {demoMode && selectedDrawing && (
          <button
            type="button"
            onClick={() => setDemoMode(false)}
            className="shrink-0 text-cyan-300 hover:text-cyan-200"
          >
            선택한 등록 도면 보기
          </button>
        )}
      </div>

      {!demoMode && ocr.error && <p role="alert" className="shrink-0 bg-rose-950 px-4 py-2 text-xs text-rose-200">{ocr.error}</p>}
            {!demoMode && measurementError && (
        <p
          role="alert"
          className="shrink-0 bg-rose-950 px-4 py-2 text-xs text-rose-200"
        >
          측정 결과 조회 실패: {measurementError}
        </p>
      )}
      {!demoMode && document?.image.coordinate_status === 'UNVERIFIED' && <p className="shrink-0 bg-amber-950 px-4 py-1 text-[11px] text-amber-200">좌표 기준 확인 필요: Frame offset 정보가 없어 입력 좌표를 그대로 표시합니다.</p>}
      {!demoMode && reviewNotice && (
        <p
          role="status"
          className="shrink-0 bg-emerald-950 px-4 py-2 text-xs text-emerald-200"
        >
          {reviewNotice}
        </p>
      )}

      {!demoMode && historyOpen && document && (
        <DrawingReviewHistory
          key={document.drawing_id}
          history={document.review_history ?? []}
          selectedItemId={activeOcrPoint?.source.id}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {!demoMode && reviewOpen && pickingPosition && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 bg-cyan-950 px-4 py-2 text-xs text-cyan-100"
        >
          <span>
            추가할 치수의 위치를 도면에서 클릭해주세요. Esc로 취소할 수 있습니다.
          </span>
          <button
            type="button"
            onClick={() => finishPositionPick(null)}
            className="shrink-0 rounded border border-cyan-500 px-2 py-1"
          >
            위치 선택 취소
          </button>
        </div>
      )}

            {!demoMode && document && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-900 px-4 py-2 text-xs">
          <span className="text-slate-400">
            {document.review_status !== "reviewed"
              ? "검수 결과 파일은 관리자 검토 완료 때 자동으로 만들어집니다."
              : loadingFiles
                ? "검수 결과 파일 불러오는 중…"
                : reviewFiles.length
                  ? "검수 결과:"
                  : ""}
          </span>

          {reviewFiles.map((file) => file.kind === "history_csv" ? (
            <a
              key={file.kind}
              href={apiUrl(file.url)}
              download
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-slate-200 transition hover:border-cyan-400 hover:bg-slate-700 hover:text-white"
            >
              {file.label} ⬇
            </a>
          ) : (
            <button
              key={file.kind}
              type="button"
              onClick={() => setPreviewFile(file)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-slate-200 transition hover:border-cyan-400 hover:bg-slate-700 hover:text-white"
            >
              {file.label}
            </button>
          ))}

          {fileError && (
            <p role="alert" className="w-full text-rose-300">
              {fileError}
            </p>
          )}
        </div>
      )}

            {workerBlocked ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-6">
          <section className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 text-center">
            <h2 className="text-sm font-bold text-white">
              관리자 검토가 끝나지 않은 도면입니다
            </h2>

            <p className="mt-3 text-xs leading-relaxed text-slate-300">
              관리자가 OCR 추출 항목을 확인하고
              「검토 완료 및 서버 저장」을 누른 뒤에
              작업자 화면에서 사용할 수 있습니다.
            </p>

            <button
              type="button"
              disabled={ocr.status !== "ready"}
              onClick={() => setReviewOpen(true)}
              className="mt-4 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              관리자 모드로 전환
            </button>
          </section>
        </div>
      ) : (
                <ResizablePanels left={<>
          {!demoMode && reviewOpen && pickingPosition && (
            <div
              role="status"
              className="shrink-0 border-b-2 border-cyan-500 bg-cyan-50 px-4 py-4 text-center"
            >
              <p className="text-base font-bold text-cyan-900">
                👇 추가할 치수의 위치를 아래 도면에서 클릭하세요!
              </p>
              <p className="mt-1 text-xs text-cyan-800">
                클릭하면 임시 번호가 표시됩니다. 위치 확인 후
                오른쪽에서 「측정 위치 확정」을 눌러주세요.
              </p>
              <button
                type="button"
                onClick={() => finishPositionPick(null)}
                className="mt-2 rounded-lg border border-cyan-300 bg-white px-3 py-1 text-xs font-semibold text-cyan-800 hover:bg-cyan-100"
              >
                위치 선택 취소 · Esc
              </button>
            </div>
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
            points={demoMode ? filteredPoints : filteredOcrPoints}
            coordinateSize={!demoMode && document ? { width: document.image.width_px, height: document.image.height_px } : undefined}
            selectedPointId={demoMode ? selectedPointId : activeOcrPoint?.id || 0}
            onSelectPoint={demoMode ? selectPoint : setSelectedPointId}
            inspectionRecords={demoMode ? inspectionRecords : ocrInspectionRecords}
            isAnalyzing={!demoMode && ocr.status === "applying"}
            analyzingStep={0}
            analyzingStage={ocr.stage}
            previewMarkers={
              !demoMode && reviewOpen ? reviewPreviewMarkers : []
            }
            onPlaceAt={
              !demoMode && reviewOpen && pickingPosition
                ? (position) => finishPositionPick(position)
                : undefined
            }
          />

          {demoMode ? (
            <MeasurementTable
              points={filteredPoints}
              selectedPointId={selectedPointId}
              onSelectPoint={selectPoint}
              inspectionRecords={inspectionRecords}
              selectedItemId={selectedItemId}
              onSelectItem={(pointId, itemId) => {
                setSelectedPointId(pointId);
                setSelectedItemId(itemId);
              }}
            />
          ) : document ? (
            <OcrMeasurementTable
              points={filteredOcrPoints}
              selectedId={activeOcrPoint?.id || 0}
              onSelect={setSelectedPointId}
              title={document.part_name || "도면"}
              records={measurementRecords}
              reviewed={document.review_status === "reviewed"}
            />
            
              
          ) : (
            <section className="shrink-0 border-t border-slate-700 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold text-white">
                측정항목
              </h2>
              <p className="mt-2 text-xs text-slate-400">
                {selectedDrawing
                  ? (ocr.status === "applying" ? "OCR 분석 중…" : "원본 도면입니다. OCR 실행을 누르면 분석 후 번호와 측정항목이 표시됩니다.")
                  : "도면을 선택하거나 등록해주세요."}
              </p>
            </section>
          )}
        </>} right={<>
          {!demoMode && reviewOpen ? (
            <div className="h-full overflow-y-auto bg-white">
              {reviewLoading ? (
                <p className="p-4 text-sm text-slate-600">
                  검수 정보를 불러오는 중…
                </p>
              ) : reviewError ? (
                <p
                  role="alert"
                  className="whitespace-pre-wrap p-4 text-sm text-red-700"
                >
                  {reviewError}
                </p>
              ) : activeReviewSource ? (
                <DrawingReviewPanel
                  key={`${activeReviewSource.drawing_id}:${activeReviewSource.revision}`}
                  source={activeReviewSource}
                  selectedItemId={activeOcrPoint?.source.id ?? null}
                  imageUrl={resultUrl}
                  onPickPosition={requestPositionPick}
                  onPreviewChange={setReviewPreviewMarkers}
                  onSelectItem={(itemId) => {
                    const point = ocrPoints.find(
                      (entry) => entry.source.id === itemId,
                    );
                    if (point) {
                      setSearchQuery("");
                      setSelectedPointId(point.id);
                    }
                  }}
                  onSaved={() => {
                    setReviewOpen(false);
                    setReviewSource(null);
                    setReviewNotice(
                      "검수 결과를 서버에 저장했습니다. 최신 결과를 불러옵니다.",
                    );
                    ocr.refresh();
                  }}
                />
              ) : (
                <p className="p-4 text-sm text-slate-600">
                  OCR 결과 조회가 끝나면 검수 정보를 표시합니다.
                </p>
              )}
            </div>
          ) : demoMode ? (
            <MeasurementPanel
              currentPoint={currentPoint}
              totalPointsCount={MOCK_MEASUREMENT_POINTS.length}
              onNavigatePoint={handleNavigatePoint}
              record={inspectionRecords[selectedPointId] || {}}
              onSaveRecord={handleSaveRecord}
              selectedItemId={selectedItemId}
              onSelectItemId={setSelectedItemId}
            />
          ) : document && selectedDrawing && ocr.snapshot?.revision ? (
            <OcrDetailPanel
              drawingId={selectedDrawing.drawing_id}
              revision={ocr.snapshot.revision}
              point={activeOcrPoint}
              total={ocrPoints.length}
              onNavigate={navigateOcr}
              onMeasurementSaved={handleMeasurementSaved}
              records={measurementRecords}
              reviewInfo={reviewInfoOf(document)}
            />
          ) : (
            <section className="space-y-4 p-5">
              <h2 className="text-sm font-bold text-slate-900">
                도면 정보
              </h2>

              {selectedDrawing ? (
                <>
                  <div className="text-xs">
                    <p className="text-slate-500">파일명</p>
                    <p className="mt-1 break-all text-slate-900">
                      {selectedDrawing.original_filename}
                    </p>
                  </div>

                  <div className="text-xs">
                    <p className="text-slate-500">파일 크기</p>
                    <p className="mt-1 text-slate-900">
                      {(
                        selectedDrawing.size_bytes /
                        1024 /
                        1024
                      ).toFixed(2)}{" "}
                      MB
                    </p>
                  </div>

                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                    {ocr.status === "applying" ? "CPU OCR 분석 중입니다. 완료 후 측정항목을 표시하고 관련 오류·주의사항을 검색합니다." : "OCR 실행 대기 중입니다. 새 업로드는 자동 분석되며 기존 도면은 OCR 실행을 눌러주세요."}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  부품에서 도면을 선택해주세요.
                </p>
              )}
            </section>
          )}
        </>} />
      )}

            {previewFile && (
        <dialog
          ref={filePreviewDialog}
          aria-labelledby="review-file-preview-title"
          onCancel={(event) => {
            event.preventDefault();
            setPreviewFile(null);
          }}
          onClose={() => setPreviewFile(null)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();

            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            ) {
              setPreviewFile(null);
            }
          }}
          className="fixed inset-0 m-auto h-[min(760px,85dvh)] w-[min(960px,92vw)] max-w-none overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
        >
          <div className="flex h-full flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setPreviewFile(null)}
                  className="mb-1 rounded px-1 py-1 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-50 hover:text-cyan-900"
                >
                  ← 관리자 화면으로
                </button>

                <h2
                  id="review-file-preview-title"
                  className="truncate text-sm font-bold"
                >
                  {previewFile.label}
                </h2>
              </div>

              <button
                type="button"
                aria-label="파일 미리보기 닫기"
                onClick={() => setPreviewFile(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 bg-slate-100 p-3">
                            {["reviewed_jpg", "edits_log_jpg"].includes(previewFile.kind) ? (
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
                  <img
                    key={previewFile.url}
                    src={apiUrl(previewFile.url)}
                    alt={previewFile.label}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <iframe
                  key={previewFile.url}
                  title={`${previewFile.label} 미리보기`}
                  src={apiUrl(previewFile.url)}
                  className="h-full w-full rounded-lg border border-slate-200 bg-white"
                />
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
              <span className="text-xs text-slate-500">
                Esc 또는 바깥 배경을 눌러 닫을 수 있습니다.
              </span>

              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="shrink-0 rounded-lg bg-cyan-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-cyan-800"
              >
                관리자 화면으로 돌아가기
              </button>
            </footer>
          </div>
        </dialog>
      )}
    </div>
  );
}

export default App;