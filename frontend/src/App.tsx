/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Box, Download, History, Loader2, RotateCcw, ScanText, Upload, X } from "lucide-react";
import { Header } from "./components/Header";
import { DrawingLibrary } from "./components/DrawingLibrary";
import { MOCK_MEASUREMENT_POINTS } from "./data/mockData";
import { DEFAULT_INITIAL_RESULTS, STORAGE_KEYS } from "./lib/inspection";
import { apiUrl, drawingFileUrl } from './lib/drawingAPI';
import { LoginScreen } from './components/entry/LoginScreen';
import { DrawingSelectScreen } from './components/entry/DrawingSelectScreen';
import { useDrawingOcr } from './hooks/useDrawingOcr';
import { toOcrPoints } from './lib/ocr';
import { ManufacturingPage } from './pages/ManufacturingPage';
import { AssemblyPage } from './pages/AssemblyPage';
import { VerificationPage } from './pages/VerificationPage';
import { AdminPage } from './pages/AdminPage';
import { WORK_PURPOSES, type AdminPageProps, type DrawingPageProps, type WorkPurpose, type WorkspacePageProps } from './pages/workspaceTypes';
import { roleLabel, type UserRole } from './lib/role';
import { UnsavedChangesProvider, type UnsavedRegistry } from './lib/unsavedChanges';
import type { Drawing } from "./lib/drawingAPI";
import DrawingReviewHistory from "./components/DrawingReviewHistory";
import { EngineViewerModal } from "./components/EngineViewerModal";

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
  const [engineViewerOpen, setEngineViewerOpen] = useState(false);

  const [demoMode, setDemoMode] = useState(true);
  // 진입 흐름: 시연용 로그인 → 부품·도면 선택 → 작업 화면
  const [stage, setStage] = useState<"login" | "select" | "workspace">("login");
  // 시연용 계정 이름. 화면 표시용으로 메모리에만 둔다 (인증 아님).
  const [userLabel, setUserLabel] = useState("");
  // 화면 역할 (인증 아님). 관리자는 통합 관리자 화면, 작업자는 자기 업무 페이지에서 입력한다.
  const [role, setRole] = useState<UserRole | null>(null);
  const isAdmin = role?.kind === "admin";
  const ownPurpose: WorkPurpose | null = role?.kind === "worker" ? role.purpose : null;
  const userDisplay = role ? `${userLabel} · ${roleLabel(role)}` : userLabel;
  // 선택 화면과 작업 화면의 DrawingLibrary 가 함께 쓰는 현재 부품
  const [activePartId, setActivePartId] = useState("");
  const [libraryOpenOnEnter, setLibraryOpenOnEnter] = useState(false);
  // 작업 페이지(부품제작·조립·검증). 선택 도면과 저장 데이터는 세 페이지가 함께 쓴다.
  const [purpose, setPurpose] = useState<WorkPurpose>("manufacturing");
  // 입력 컴포넌트가 '저장하지 않은 입력 있음'을 등록하는 곳
  const unsavedRegistry = useRef<UnsavedRegistry>(new Set()).current;
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
  const reviewOpen =
    isAdmin && stage === "workspace" && !demoMode && !!document && ocr.status === "ready";
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
  
  // 측정 기록은 도면·OCR 버전·작업 목적마다 따로 보관한다. 페이지를 바꾸면 대상이 바뀌어
  // 이전 목적의 값은 보이지 않고, 늦게 도착한 이전 목적의 응답도 버린다.
  const measurementTarget = `${reviewDrawingId}:${reviewRevision}:${purpose}`;
  const activeMeasurementTarget = useRef(measurementTarget);
  activeMeasurementTarget.current = measurementTarget;

  const measurementRecords =
    measurementData.target === measurementTarget
      ? measurementData.records
      : {};

  useEffect(() => {
    const controller = new AbortController();
    setMeasurementError("");

    // 측정 결과는 작업자 화면만 쓴다 (관리자 화면은 목적별 측정을 보여주지 않는다).
    if (!reviewDrawingId || !reviewRevision || isAdmin) return;

    const target = `${reviewDrawingId}:${reviewRevision}:${purpose}`;

    fetchMeasurements(
      purpose,
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
          response.revision !== reviewRevision ||
          response.work_purpose !== purpose
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
  }, [reviewDrawingId, reviewRevision, purpose, isAdmin]);

  function handleMeasurementSaved(record: SavedMeasurement) {
    const target = `${record.drawing_id}:${record.revision}:${record.work_purpose}`;

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
    !isAdmin &&
    !demoMode &&
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

  function closeWorkspaceOverlays() {
    if (positionResolver.current) finishPositionPick(null);
    setHistoryOpen(false);
    setEngineViewerOpen(false);
    setPreviewFile(null);
  }

  function startWorkspace(drawing: Drawing) {
    closeWorkspaceOverlays();
    setSearchQuery("");
    setSelectedPointId(1);
    setSelectedDrawing(drawing);
    setDrawingUrl(drawingFileUrl(drawing));
    setActivePartId(drawing.part_id);
    setDemoMode(false);
    setLibraryOpenOnEnter(false);
    setStage("workspace");
  }

  function enterDemo() {
    closeWorkspaceOverlays();
    setSearchQuery("");
    selectPoint(1);
    setDemoMode(true);
    setLibraryOpenOnEnter(false);
    setStage("workspace");
  }

  /** 화면을 바꾸면 사라지는 입력이 있으면 사용자에게 확인한다. */
  function confirmLeave(destination: string) {
    if (!demoMode && reviewOpen) {
      return window.confirm(`관리자 검토 중 저장하지 않은 내용은 사라집니다. ${destination}할까요?`);
    }
    if (unsavedRegistry.size > 0) {
      return window.confirm(`저장하지 않은 측정값 또는 오류사례 입력이 있습니다. ${destination}하면 입력한 내용이 사라집니다. 계속할까요?`);
    }
    return true;
  }

  function backToList() {
    if (!confirmLeave("도면 목록으로 이동")) return;
    closeWorkspaceOverlays();
    setStage("select");
  }

  function switchPurpose(next: WorkPurpose) {
    if (next === purpose) return;
    const label = WORK_PURPOSES.find((entry) => entry.value === next)?.label ?? "";
    if (!confirmLeave(`${label} 페이지로 이동`)) return;
    // 위치 선택 중이었다면 취소한다 (관리자 검토 상태는 그대로 둔다).
    if (positionResolver.current) finishPositionPick(null);
    setPurpose(next);
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

  const ocrBusy = ocr.status === "loading" || ocr.status === "applying";
  const showFileBar =
    isAdmin &&
    !demoMode &&
    !!document &&
    (documentReviewed
      ? loadingFiles || reviewFiles.length > 0 || !!fileError
      : reviewOpen);

  const toolbarStatus = demoMode ? (
    <>
      <span className="tag bg-slate-700 text-slate-200">데모</span>
      <span className="truncate">샘플 도면 · 샘플 측정항목</span>
    </>
  ) : selectedDrawing ? (
    <>
      {document ? (
        documentReviewed ? (
          <span className="tag bg-emerald-900/70 text-emerald-200">검토 완료</span>
        ) : (
          <span className="tag bg-amber-900/70 text-amber-200">검토 전</span>
        )
      ) : null}
      <span className="truncate">
        {document
          ? `OCR 추출 ${ocrPoints.length}건`
          : ocr.status === "applying"
            ? "OCR 분석 중…"
            : "OCR 미실행"}
      </span>
    </>
  ) : (
    <span className="truncate">등록된 도면을 선택해주세요</span>
  );

  const divider = <span aria-hidden="true" className="hidden h-4 w-px bg-slate-700 sm:block" />;

  const toolbarActions = (
    <>
      {isAdmin ? (
        <span className="tag bg-cyan-900/70 text-cyan-100">통합 관리자</span>
      ) : (
        <div role="group" aria-label="작업 페이지" className="seg-dark">
          {WORK_PURPOSES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={purpose === entry.value}
              onClick={() => switchPurpose(entry.value)}
              title={entry.value === ownPurpose ? "내 업무 (입력 가능)" : "다른 업무 (조회만)"}
              className="seg-item"
            >
              {entry.label}
              {entry.value !== ownPurpose && <span className="ml-1 text-[10px] opacity-70">조회</span>}
            </button>
          ))}
        </div>
      )}

      {divider}

      {!demoMode && selectedDrawing && (
        <>
          {isAdmin && (
          <button
            type="button"
            disabled={ocrBusy}
            onClick={() => void runSelectedOcr()}
            className={`btn ${document ? "btn-dark" : "btn-primary"}`}
          >
            {ocr.status === "applying" ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ScanText aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            <span className="max-w-[180px] truncate">
              {ocr.status === "applying"
                ? ocr.stage || "OCR 분석 중…"
                : document
                  ? "OCR 결과 다시 조회"
                  : ocr.status === "error"
                    ? "OCR 재시도"
                    : "OCR 실행"}
            </span>
          </button>
          )}

          {document && (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="btn btn-dark"
            >
              <History aria-hidden="true" className="h-3.5 w-3.5" />
              수정 이력
            </button>
          )}
        </>
      )}

      {!demoMode && selectedDrawing && divider}

      <button
        type="button"
        onClick={() => setEngineViewerOpen(true)}
        className="btn btn-dark"
      >
        <Box aria-hidden="true" className="h-3.5 w-3.5" />
        3D 뷰어
      </button>

      {isAdmin && (
        <button
          type="button"
          onClick={() => setUploadRequest((value) => value + 1)}
          className={`btn ${selectedDrawing && !demoMode ? "btn-dark" : "btn-primary"}`}
        >
          <Upload aria-hidden="true" className="h-3.5 w-3.5" />
          도면 업로드
        </button>
      )}

      {(demoMode || selectedDrawing) && divider}

      {!demoMode && (
        <button
          type="button"
          onClick={() => setDemoMode(true)}
          className="btn btn-dark-ghost"
        >
          데모 화면
        </button>
      )}

      {demoMode && selectedDrawing && (
        <button
          type="button"
          onClick={() => setDemoMode(false)}
          className="btn btn-dark-ghost"
        >
          선택한 도면으로
        </button>
      )}

      {demoMode && (
        <button
          type="button"
          onClick={handleResetData}
          title="데모 검사 기록 초기화"
          className="btn btn-dark-ghost"
        >
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          초기화
        </button>
      )}
    </>
  );

  // 관리자 검토 패널: 통합 관리자 화면에서만 만든다 (목적별로 나누지 않는다).
  const reviewPane = !reviewOpen ? null : (
    <div className="h-full overflow-y-auto bg-white">
      {reviewLoading ? (
        <p role="status" className="flex items-center gap-2 p-4 text-xs text-slate-600">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          검수 정보를 불러오는 중…
        </p>
      ) : reviewError ? (
        <p
          role="alert"
          className="note note-error m-3 whitespace-pre-wrap"
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
            setReviewSource(null);
            setReviewNotice(
              "검수 결과를 서버에 저장했습니다. 최신 결과를 불러옵니다.",
            );
            ocr.refresh();
          }}
        />
      ) : (
        <p className="p-4 text-xs text-slate-600">
          OCR 결과 조회가 끝나면 검수 정보를 표시합니다.
        </p>
      )}
    </div>
  );

  const drawingPageProps: DrawingPageProps = {
    demoMode,
    selectedDrawing,
    document,
    ocrStatus: ocr.status,
    ocrStage: ocr.stage,
    revision: ocr.snapshot?.revision,
    resultUrl,
    ocrPoints,
    filteredOcrPoints,
    activeOcrPoint,
    onSelectOcrPoint: setSelectedPointId,
    onNavigateOcr: navigateOcr,
    demo: {
      points: filteredPoints,
      selectedPointId,
      onSelectPoint: selectPoint,
      inspectionRecords,
      selectedItemId,
      onSelectItem: (pointId, itemId) => {
        setSelectedPointId(pointId);
        setSelectedItemId(itemId);
      },
      currentPoint,
      total: MOCK_MEASUREMENT_POINTS.length,
      onNavigatePoint: handleNavigatePoint,
      onSaveRecord: handleSaveRecord,
      onSelectItemId: setSelectedItemId,
    },
  };

  const workerPageProps: WorkspacePageProps = {
    ...drawingPageProps,
    ocrInspectionRecords,
    measurementRecords,
    onMeasurementSaved: handleMeasurementSaved,
    // 자기 업무 페이지가 아니면 조회만
    readOnly: purpose !== ownPurpose,
    workerBlocked,
  };

  const adminPageProps: AdminPageProps = {
    ...drawingPageProps,
    reviewPane,
    pickingPosition,
    onCancelPositionPick: () => finishPositionPick(null),
    onPlaceAt: (position) => finishPositionPick(position),
    reviewPreviewMarkers,
  };

  function enterWithRole(next: UserRole) {
    setRole(next);
    // 작업자는 자기 업무 페이지에서 시작한다.
    if (next.kind === "worker") setPurpose(next.purpose);
  }

  if (stage === "login") {
    return (
      <LoginScreen
        onLogin={(account, nextRole) => {
          setUserLabel(account);
          enterWithRole(nextRole);
          setStage("select");
        }}
        onDemo={(nextRole) => {
          setUserLabel("데모 체험");
          enterWithRole(nextRole);
          enterDemo();
        }}
      />
    );
  }

  if (stage === "select") {
    return (
      <DrawingSelectScreen
        userLabel={userDisplay}
        initialPartId={activePartId}
        initialDrawingId={selectedDrawing?.part_id === activePartId ? selectedDrawing.drawing_id : ""}
        onStart={startWorkspace}
        onRegister={!isAdmin ? undefined : (partId) => {
          // 도면 없이 관리자 화면을 열고 부품·도면 관리 영역을 펼친다.
          setActivePartId(partId);
          setSelectedDrawing(null);
          setDrawingUrl(null);
          setDemoMode(false);
          setLibraryOpenOnEnter(true);
          setStage("workspace");
        }}
        onDemo={enterDemo}
        onExit={() => {
          setUserLabel("");
          setRole(null);
          setStage("login");
        }}
      />
    );
  }

  return (
    <UnsavedChangesProvider registry={unsavedRegistry}>
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans">
      <Header
        displayInfo={demoMode ? undefined : { partName: document?.part_name || "등록 부품", drawingName: selectedDrawing?.original_filename || "선택 대기" }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        userLabel={userDisplay}
        onBackToList={backToList}
      />

      {engineViewerOpen && (
        <EngineViewerModal
          partName={
            demoMode
              ? "PISTON ROD"
              : document?.part_name || selectedDrawing?.name
          }
          isMockName={demoMode}
          onClose={() => setEngineViewerOpen(false)}
        />
      )}

      <DrawingLibrary
        uploadRequest={uploadRequest}
        status={toolbarStatus}
        actions={toolbarActions}
        initialPartId={activePartId}
        initialDrawingId={selectedDrawing?.part_id === activePartId ? selectedDrawing.drawing_id : ""}
        initialOpen={libraryOpenOnEnter}
        canManage={isAdmin}
        onSelectPart={setActivePartId}
        onSelectDrawing={(drawing, url) => {
          setSelectedPointId(1);
          setSelectedDrawing(drawing);
          setDrawingUrl(url);
          setActivePartId(drawing.part_id);
          setDemoMode(false);
        }}
        onClearDrawing={() => {
          setSelectedDrawing(null);
          setDrawingUrl(null);
          setDemoMode(false);
        }}
      />

      {!demoMode && ocr.error && (
        <p role="alert" className="banner banner-error">
          {ocr.error}
        </p>
      )}
      {!demoMode && measurementError && (
        <p role="alert" className="banner banner-error">
          측정 결과 조회 실패: {measurementError}
        </p>
      )}
      {!demoMode && document?.image.coordinate_status === "UNVERIFIED" && (
        <p className="banner banner-warn">
          좌표 기준 확인 필요: Frame offset 정보가 없어 입력 좌표를 그대로 표시합니다.
        </p>
      )}
      {!demoMode && reviewNotice && (
        <p role="status" className="banner banner-ok">
          <span className="min-w-0 flex-1">{reviewNotice}</span>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => setReviewNotice("")}
            className="btn btn-dark-ghost btn-icon h-6"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
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

      {showFileBar && (
        <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-800 bg-slate-900 px-3 py-1 text-xs">
          <span className="text-[11px] text-slate-400">
            {!documentReviewed
              ? "검수 결과 파일은 관리자 검토 완료 때 자동으로 만들어집니다."
              : loadingFiles
                ? "검수 결과 파일 불러오는 중…"
                : reviewFiles.length
                  ? "검수 결과 파일"
                  : ""}
          </span>

          {reviewFiles.map((file) => file.kind === "history_csv" ? (
            <a
              key={file.kind}
              href={apiUrl(file.url)}
              download
              className="btn btn-dark h-6"
            >
              <Download aria-hidden="true" className="h-3 w-3" />
              {file.label}
            </a>
          ) : (
            <button
              key={file.kind}
              type="button"
              onClick={() => setPreviewFile(file)}
              className="btn btn-dark h-6"
            >
              {file.label}
            </button>
          ))}

          {fileError && (
            <p role="alert" className="w-full text-[11px] text-rose-300">
              {fileError}
            </p>
          )}
        </div>
      )}

      {isAdmin ? (
        <AdminPage {...adminPageProps} />
      ) : (() => {
        const Page =
          purpose === "assembly"
            ? AssemblyPage
            : purpose === "verification"
              ? VerificationPage
              : ManufacturingPage;
        return <Page {...workerPageProps} />;
      })()}

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
          className="fixed inset-0 m-auto h-[min(760px,85dvh)] w-[min(960px,92vw)] max-w-none overflow-hidden rounded-md border border-slate-300 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
        >
          <div className="flex h-full flex-col">
            <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4">
              <h2
                id="review-file-preview-title"
                className="card-title min-w-0 truncate"
              >
                {previewFile.label}
              </h2>

              <button
                type="button"
                aria-label="파일 미리보기 닫기"
                onClick={() => setPreviewFile(null)}
                className="btn btn-ghost btn-icon"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 bg-slate-100 p-3">
              {["reviewed_jpg", "edits_log_jpg"].includes(previewFile.kind) ? (
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded border border-slate-200 bg-white p-2">
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
                  className="h-full w-full rounded border border-slate-200 bg-white"
                />
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2.5">
              <span className="text-[11px] text-slate-500">
                Esc 또는 바깥 배경을 눌러 닫을 수 있습니다.
              </span>

              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="btn btn-primary"
              >
                관리자 화면으로 돌아가기
              </button>
            </footer>
          </div>
        </dialog>
      )}
    </div>
    </UnsavedChangesProvider>
  );
}

export default App;