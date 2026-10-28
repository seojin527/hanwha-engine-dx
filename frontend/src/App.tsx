/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import { Activity, Box, Download, History, Loader2, RotateCcw, ScanText, Upload, X } from "lucide-react";
import { EngineViewer3D, type EngineModelInfo } from "./components/shell/EngineViewer3D";
import { EngineExplorerPanel, type EngineSelection } from "./components/shell/EngineExplorerPanel";
import { DrawingContextHeader, ShellRail, ShellTopBar, type ShellView } from "./components/shell/ShellChrome";
import { PanelLayoutContext } from "./components/ResizablePanels";
import { MobileShell } from "./components/mobile/MobileShell";
import { useCompactLayout } from "./hooks/useCompactLayout";
import { useDeployMode } from "./hooks/useDeployMode";
import { MoveDrawingDialog } from "./components/shell/MoveDrawingDialog";
import { ENGINE_PART_LABEL, type EnginePartKey } from "./lib/engineParts";
import { DrawingLibrary } from "./components/DrawingLibrary";
import { MOCK_MEASUREMENT_POINTS } from "./data/mockData";
import { DEFAULT_INITIAL_RESULTS, STORAGE_KEYS } from "./lib/inspection";
import { apiUrl, drawingFileUrl, fetchDrawings, fetchParts, moveDrawingToPart } from './lib/drawingAPI';
import { LoginScreen } from './components/entry/LoginScreen';
import { DrawingSelectScreen, type AdminView } from './components/entry/DrawingSelectScreen';
import { ErrorDbManager } from './components/admin/errorDb/ErrorDbManager';
import { WorkflowProgress } from './components/admin/WorkflowProgress';
import type { LocationTarget } from './components/admin/adminUi';
import { useDrawingOcr } from './hooks/useDrawingOcr';
import { toOcrPoints } from './lib/ocr';
import { ManufacturingPage } from './pages/ManufacturingPage';
import { AssemblyPage } from './pages/AssemblyPage';
import { VerificationPage } from './pages/VerificationPage';
import { AdminPage } from './pages/AdminPage';
import { WORK_PURPOSES, type AdminPageProps, type DrawingPageProps, type WorkPurpose, type WorkspacePageProps } from './pages/workspaceTypes';
import { roleLabel, type UserRole } from './lib/role';
import { UnsavedChangesProvider, type UnsavedRegistry } from './lib/unsavedChanges';
import type { Drawing, Part } from "./lib/drawingAPI";
import DrawingReviewHistory from "./components/DrawingReviewHistory";

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
  // 진입 흐름: 시연용 로그인 → 전체 엔진 3D(engine) → 부품 선택 → 도면 작업(workspace).
  // select 는 셸 안의 목록·관리 화면(부품·도면 목록 · 작업 진행 현황 · 오류 DB)이다.
  const [stage, setStage] = useState<"login" | "engine" | "select" | "workspace">("login");
  // 시연용 계정 이름. 화면 표시용으로 메모리에만 둔다 (인증 아님).
  const [userLabel, setUserLabel] = useState("");
  // 화면 역할 (인증 아님). 관리자는 통합 관리자 화면, 작업자는 자기 업무 페이지에서 입력한다.
  const [role, setRole] = useState<UserRole | null>(null);
  // 관람객 주소(서버 읽기 전용)에서는 관리자 화면·도구를 열지 않는다. 서버도 변경 요청을 막는다.
  const deployMode = useDeployMode();
  const visitor = deployMode.readOnly;
  const isAdmin = role?.kind === "admin" && !visitor;
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
  // 관리자 메뉴(부품·도면 관리 · 오류 DB 관리 · 작업 진행 현황)와 선택 화면에서 고른 도면.
  // 메뉴를 바꿔도 선택은 선택 화면이 유지하고, 작업 현황은 이 도면을 본다.
  const [adminView, setAdminView] = useState<AdminView>("drawings");
  const [pickedDrawing, setPickedDrawing] = useState<Drawing | null>(null);
  // 오류 DB·작업 현황에서 도면 위치를 열 때 도면을 연 뒤 선택할 항목 (revision 이 없으면 현재 버전)
  const [pendingFocus, setPendingFocus] = useState<{ drawingId: string; itemId: string; revision?: string } | null>(null);
  // 3D 메인: 선택한 3D 부품 종류·등록 부품·도면. 도면 작업에서 돌아와도 유지한다.
  const [engineSelection, setEngineSelection] = useState<EngineSelection>({ engineKey: null, partId: null, drawingId: null });
  const [engineModel, setEngineModel] = useState<EngineModelInfo | null>(null);
  // 휴대폰은 별도 흐름(components/mobile)으로 그린다: 3D → 부품 → 대표 도면 → 업무 → 한 항목씩 작업
  const compact = useCompactLayout();
  const [allParts, setAllParts] = useState<Part[]>([]);
  // 도면 등록·검토 저장 뒤 부품·도면 목록(검토 상태 포함)을 다시 불러오게 한다.
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [siblingDrawings, setSiblingDrawings] = useState<Drawing[]>([]);
  // 도면 작업 중 「소속 부품 변경」 창
  const [moveOpen, setMoveOpen] = useState(false);
  // 작업 진행 현황·오류 DB 는 한 번 연 뒤 숨기기만 한다 → 도면을 열었다 돌아와도 필터·선택이 그대로다.
  // 이 화면들의 미저장 입력은 따로 모은다 (숨겨도 입력이 사라지지 않으므로 다른 화면 이동을 막지 않는다).
  const adminRegistry = useRef<UnsavedRegistry>(new Set()).current;
  const [visited, setVisited] = useState<{ progress: boolean; errors: boolean }>({ progress: false, errors: false });
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
    setPreviewFile(null);
  }

  function startWorkspace(drawing: Drawing) {
    closeWorkspaceOverlays();
    setSearchQuery("");
    setSelectedPointId(1);
    setSelectedDrawing(drawing);
    setDrawingUrl(drawingFileUrl(drawing));
    setActivePartId(drawing.part_id);
    setPickedDrawing(drawing);
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

  /** 화면을 바꾸면 사라지는 입력이 있으면 사용자에게 확인한다 (관리자 검토 · 측정값 · 오류사례 · 도면 등록 입력). */
  function confirmLeave(destination: string) {
    if (unsavedRegistry.size === 0) return true;
    if (!demoMode && reviewOpen) {
      return window.confirm(`관리자 검토 중 저장하지 않은 내용은 사라집니다. ${destination}할까요?`);
    }
    return window.confirm(`저장하지 않은 측정값 또는 오류사례 입력이 있습니다. ${destination}하면 입력한 내용이 사라집니다. 계속할까요?`);
  }

  const shellView: ShellView =
    stage === "engine" ? "engine"
      : stage === "workspace" ? "drawing"
        : adminView === "errors" ? "errors"
          : adminView === "progress" ? "progress"
            : "library";

  function isModelKey(key?: string | null) {
    return !!key && (engineModel ? engineModel.parts.some((part) => part.key === key) : key in ENGINE_PART_LABEL);
  }

  function modelPartName(key?: string | null) {
    if (!key) return null;
    return engineModel?.parts.find((part) => part.key === key)?.name ?? ENGINE_PART_LABEL[key as EnginePartKey] ?? null;
  }

  /** 셸 메뉴 이동. 도면 작업을 떠날 때는 미저장 확인, 3D로 돌아갈 때는 연 도면의 부품을 선택해 둔다. */
  function navigate(next: ShellView) {
    if (next === shellView) return;
    if (!confirmLeave(next === "engine" ? "3D 화면으로 이동" : "다른 화면으로 이동")) return;
    if (stage === "workspace") {
      closeWorkspaceOverlays();
      if (next === "engine" && !demoMode && selectedDrawing) {
        const part = allParts.find((entry) => entry.part_id === selectedDrawing.part_id);
        setEngineSelection({
          engineKey: isModelKey(part?.engine_part_key) ? part!.engine_part_key! : null,
          partId: selectedDrawing.part_id,
          drawingId: selectedDrawing.drawing_id,
        });
      }
    }
    if (next === "engine") setStage("engine");
    else if (next === "drawing") setStage("workspace");
    else {
      setAdminView(next === "library" ? "drawings" : next);
      if (next === "progress" || next === "errors") setVisited((previous) => ({ ...previous, [next]: true }));
      if (next === "progress" && !pickedDrawing) setPickedDrawing(selectedDrawing);
      setStage("select");
    }
  }

  function backTo3D() {
    navigate("engine");
  }

  /** 도면 소속 부품을 바꾼 뒤: 열린 도면·경로·목록을 새 소속으로 갱신한다 (작업 상태는 그대로). */
  function handleDrawingMoved(drawing: Drawing) {
    if (selectedDrawing?.drawing_id === drawing.drawing_id) {
      setSelectedDrawing((current) => (current ? { ...current, part_id: drawing.part_id } : current));
      setActivePartId(drawing.part_id);
    }
    if (pickedDrawing?.drawing_id === drawing.drawing_id) setPickedDrawing({ ...pickedDrawing, part_id: drawing.part_id });
    setLibraryVersion((value) => value + 1);
    fetchParts().then((data) => setAllParts(data.parts)).catch(() => {});
  }

  function partPathOf(part: Part | undefined) {
    return part ? `${modelPartName(part.engine_part_key) ?? "3D 미연결"} › ${part.name}` : "알 수 없는 부품";
  }

  function logout() {
    if ((unsavedRegistry.size > 0 || adminRegistry.size > 0) &&
      !window.confirm("저장하지 않은 입력이 있습니다. 처음 화면으로 이동하면 입력한 내용이 사라집니다. 계속할까요?")) return;
    closeWorkspaceOverlays();
    setUserLabel("");
    setRole(null);
    setAdminView("drawings");
    setVisited({ progress: false, errors: false });
    setEngineSelection({ engineKey: null, partId: null, drawingId: null });
    setStage("login");
  }

  /** 3D 화면(트리·연결 도면)에서 도면을 연다. 도면을 열기 전까지 중앙은 3D 그대로다. */
  function openDrawingFromExplorer(drawing: Drawing) {
    if (!confirmLeave("도면을 열기")) return;
    startWorkspace(drawing);
  }

  // 도면 작업 중: 같은 부품의 다른 도면 목록 (맥락 머리글의 도면 바꾸기)
  useEffect(() => {
    setSiblingDrawings([]);
    const partId = selectedDrawing?.part_id;
    if (stage !== "workspace" || demoMode || !partId) return;
    const controller = new AbortController();
    fetchDrawings(partId, controller.signal)
      .then((data) => !controller.signal.aborted && setSiblingDrawings(data.drawings))
      .catch(() => {});
    return () => controller.abort();
  }, [stage, demoMode, selectedDrawing?.part_id, libraryVersion]);

  // 새로 고침·탭 닫기: 앱 안 이동과 달리 브라우저 기본 확인 창을 쓴다.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (unsavedRegistry.size === 0 && adminRegistry.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsavedRegistry, adminRegistry]);

  /** 관리자 검토 화면 → 이 도면의 작업 진행 현황 */
  function openProgressFromWorkspace() {
    if (!confirmLeave("작업 현황으로 이동")) return;
    closeWorkspaceOverlays();
    setPickedDrawing(selectedDrawing);
    setVisited((previous) => ({ ...previous, progress: true }));
    setAdminView("progress");
    setStage("select");
  }

  /** 관리자 메뉴에서 도면을 관리자 검토 화면으로 연다 (itemId 가 있으면 그 항목을 선택). */
  function openDrawingFromAdmin(drawing: Drawing, itemId?: string, revision?: string) {
    if (!confirmLeave("도면을 열기")) return;
    setPendingFocus(itemId ? { drawingId: drawing.drawing_id, itemId, revision } : null);
    startWorkspace(drawing);
  }

  async function openLocation(target: LocationTarget) {
    try {
      const { drawings } = await fetchDrawings(target.part_id);
      const drawing = drawings.find((entry) => entry.drawing_id === target.drawing_id);
      if (!drawing) {
        window.alert("도면을 찾을 수 없습니다. 삭제됐거나 다른 부품으로 옮겨졌을 수 있습니다.");
        return;
      }
      openDrawingFromAdmin(drawing, target.item_id, target.revision);
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "도면 조회 실패");
    }
  }

  function switchPurpose(next: WorkPurpose) {
    if (next === purpose) return;
    const label = WORK_PURPOSES.find((entry) => entry.value === next)?.label ?? "";
    if (!confirmLeave(`${label} 페이지로 이동`)) return;
    // 위치 선택 중이었다면 취소한다 (관리자 검토 상태는 그대로 둔다).
    if (positionResolver.current) finishPositionPick(null);
    setPurpose(next);
  }

  // 관리자 메뉴에서 연 항목 위치: OCR 결과가 도착하면 그 항목을 선택한다. 버전이 다르면 위치를 고르지 않는다.
  useEffect(() => {
    if (!pendingFocus || stage !== "workspace" || demoMode) return;
    if (selectedDrawing?.drawing_id !== pendingFocus.drawingId) {
      setPendingFocus(null);
      return;
    }
    const snapshot = ocr.snapshot;
    if (!snapshot || snapshot.drawing_id !== pendingFocus.drawingId || !snapshot.result || !snapshot.revision) return;
    if (pendingFocus.revision && snapshot.revision !== pendingFocus.revision) {
      setReviewNotice("연결 당시 OCR 버전과 현재 버전이 달라 항목 위치를 선택하지 않았습니다.");
    } else {
      const point = toOcrPoints(snapshot.result).find((entry) => entry.source.id === pendingFocus.itemId);
      if (point) {
        setSearchQuery("");
        setSelectedPointId(point.id);
      } else {
        setReviewNotice("현재 OCR 결과에서 해당 항목을 찾지 못했습니다.");
      }
    }
    setPendingFocus(null);
  }, [pendingFocus, stage, demoMode, selectedDrawing, ocr.snapshot]);

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

          {isAdmin && (
            <button
              type="button"
              onClick={openProgressFromWorkspace}
              className="btn btn-dark"
            >
              <Activity aria-hidden="true" className="h-3.5 w-3.5" />
              이 도면의 작업 현황
            </button>
          )}
        </>
      )}

      {!demoMode && selectedDrawing && divider}

      <button
        type="button"
        onClick={backTo3D}
        title="전체 엔진 3D 화면으로 돌아가 이 도면의 부품을 선택합니다"
        className="btn btn-dark"
      >
        <Box aria-hidden="true" className="h-3.5 w-3.5" />
        3D에서 보기
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
          defaultReviewer={userLabel}
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
            // 저장 뒤에도 관리자 화면에 머문다 (작업자 화면으로 옮기지 않음). 도면 목록의 검토 상태는 다시 불러온다.
            setReviewSource(null);
            setReviewNotice(
              "검수 결과를 서버에 저장했습니다. 이 도면은 이제 작업자가 측정할 수 있습니다. 최신 결과를 불러옵니다.",
            );
            ocr.refresh();
            setLibraryVersion((value) => value + 1);
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
    // 자기 업무 페이지가 아니면 조회만. 관람객 주소의 데스크톱 화면도 조회만 (휴대폰은 저장 없는 체험)
    readOnly: purpose !== ownPurpose || visitor,
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
    // 서버 정책(관람객 주소 여부)을 받기 전에는 로그인 칸을 그리지 않는다. 관리자 역할이 잠깐 보였다 사라지지 않게.
    if (!deployMode.loaded) return <main className="dx-shell h-dvh w-screen bg-[#0b1522]" aria-busy="true" />;
    return (
      <LoginScreen
        visitor={visitor}
        compact={compact}
        onLogin={(account, nextRole) => {
          setUserLabel(account);
          enterWithRole(nextRole);
          setStage("engine");
        }}
        onDemo={(nextRole) => {
          setUserLabel("데모 체험");
          enterWithRole(nextRole);
          enterDemo();
        }}
      />
    );
  }

  if (compact) {
    return (
      <MobileShell
        userLabel={userLabel}
        roleText={visitor ? "관람객 체험" : roleLabel(role)}
        isAdmin={isAdmin}
        trial={visitor}
        ownPurpose={visitor ? null : ownPurpose}
        onLogout={logout}
        inWorkspace={stage === "workspace" && !demoMode}
        engineModel={engineModel}
        onEngineReady={setEngineModel}
        selection={engineSelection}
        onSelect={setEngineSelection}
        onOpenDrawing={openDrawingFromExplorer}
        onBackTo3D={backTo3D}
        selectedDrawing={selectedDrawing}
        siblingDrawings={siblingDrawings}
        document={document}
        ocrStatus={ocr.status}
        revision={reviewRevision}
        resultUrl={resultUrl}
        points={ocrPoints}
        activePoint={activeOcrPoint}
        onSelectPoint={setSelectedPointId}
        purpose={purpose}
        onPurpose={switchPurpose}
        measurementRecords={measurementRecords}
        onMeasurementSaved={handleMeasurementSaved}
        reviewFiles={reviewFiles}
        reviewPane={reviewPane}
        picking={pickingPosition}
        onPickAt={(position) => finishPositionPick(position)}
        onCancelPick={() => finishPositionPick(null)}
      />
    );
  }

  const engineTitle = engineModel?.title || "엔진 조립품";
  const workspacePart = allParts.find((part) => part.part_id === selectedDrawing?.part_id);
  const explorerPart = allParts.find((part) => part.part_id === engineSelection.partId);
  const menuLabel: Record<ShellView, string> = {
    engine: "3D 엔진 탐색",
    drawing: "도면 작업",
    library: "부품·도면 목록",
    progress: "작업 진행 현황",
    errors: "오류 DB 관리",
  };
  const shellPath: { label: string; onClick?: () => void }[] =
    shellView === "engine"
      ? [
          { label: engineTitle, onClick: engineSelection.engineKey || engineSelection.partId ? () => setEngineSelection({ engineKey: null, partId: null, drawingId: null }) : undefined },
          ...(engineSelection.engineKey ? [{ label: modelPartName(engineSelection.engineKey) ?? engineSelection.engineKey }] : []),
          ...(explorerPart ? [{ label: explorerPart.name }] : []),
        ]
      : shellView === "drawing"
        ? demoMode
          ? [{ label: engineTitle, onClick: backTo3D }, { label: "데모 도면 (샘플)" }]
          : [
              { label: engineTitle, onClick: backTo3D },
              { label: modelPartName(workspacePart?.engine_part_key) ?? "3D 미연결" },
              { label: workspacePart?.name ?? document?.part_name ?? "등록 부품" },
              { label: selectedDrawing?.original_filename || "도면 선택 대기" },
            ]
        : [{ label: engineTitle, onClick: () => navigate("engine") }, { label: menuLabel[shellView] }];

  // 도면 작업 중 왼쪽 작업 패널 위에 붙는 맥락 (엔진·부품·도면 · 같은 부품의 다른 도면 · 3D 복귀)
  const drawingContext = demoMode ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-dx-line bg-dx-panel px-3 py-2.5 text-xs text-dx-text">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-dx-faint">데모</p>
        <p className="truncate text-[13px] font-semibold text-white">샘플 도면 · 샘플 측정항목</p>
      </div>
      <button type="button" onClick={backTo3D} className="dx-btn"><Box aria-hidden="true" className="h-3.5 w-3.5" />3D로</button>
    </div>
  ) : selectedDrawing ? (
    <DrawingContextHeader
      enginePartName={modelPartName(workspacePart?.engine_part_key)}
      partName={workspacePart?.name ?? document?.part_name ?? "등록 부품"}
      drawing={selectedDrawing}
      revision={ocr.snapshot?.revision}
      reviewed={documentReviewed}
      siblings={siblingDrawings}
      onSwitchDrawing={(next) => {
        if (next.drawing_id === selectedDrawing.drawing_id || !confirmLeave("다른 도면으로 이동")) return;
        startWorkspace(next);
      }}
      onBackTo3D={backTo3D}
      extra={isAdmin && (
        <button
          type="button"
          className="dx-btn w-full"
          onClick={() => {
            if (!allParts.length) fetchParts().then((data) => setAllParts(data.parts)).catch(() => {});
            setMoveOpen(true);
          }}
        >
          소속 부품 변경
        </button>
      )}
    />
  ) : null;

  const railNav = (
    <ShellRail
      view={shellView}
      isAdmin={isAdmin}
      drawingAvailable={demoMode || !!selectedDrawing}
      onNavigate={navigate}
      onLogout={logout}
    />
  );
  const explorerPanel = () => (
    <EngineExplorerPanel
      model={engineModel}
      selection={engineSelection}
      onSelect={setEngineSelection}
      canManage={isAdmin}
      refreshKey={libraryVersion}
      onOpenDrawing={openDrawingFromExplorer}
      onUploaded={(drawing) => {
        setLibraryVersion((value) => value + 1);
        startWorkspace(drawing);
      }}
      onPartsLoaded={setAllParts}
      onDrawingMoved={handleDrawingMoved}
    />
  );

  return (
    <UnsavedChangesProvider registry={unsavedRegistry}>
    <div className="dx-shell flex h-dvh w-screen overflow-hidden font-sans">
      {railNav}
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellTopBar
          path={shellPath}
          userLabel={userLabel}
          roleLabel={roleLabel(role)}
          search={shellView === "drawing" ? { value: searchQuery, onChange: setSearchQuery } : undefined}
        />
        <div className="relative flex min-h-0 flex-1">
          {stage === "engine" && explorerPanel()}
          {/* 3D 는 한 번 만든 뒤 숨기기만 한다 (카메라·선택·분해 상태 유지) */}
          <EngineViewer3D
            visible={stage === "engine"}
            selectedKey={engineSelection.engineKey}
            onSelect={(key) => setEngineSelection({ engineKey: key, partId: null, drawingId: null })}
            onReady={setEngineModel}
          />

          {stage === "select" && adminView === "drawings" && (
            <DrawingSelectScreen
              embedded
              userLabel={userDisplay}
              initialPartId={activePartId}
              initialDrawingId={selectedDrawing?.part_id === activePartId ? selectedDrawing.drawing_id : ""}
              onStart={openDrawingFromExplorer}
              onRegister={!isAdmin ? undefined : (partId) => {
                // 도면 없이 관리자 도면 화면을 열고 부품·도면 관리 영역을 펼친다.
                setActivePartId(partId);
                setSelectedDrawing(null);
                setDrawingUrl(null);
                setDemoMode(false);
                setLibraryOpenOnEnter(true);
                setStage("workspace");
              }}
              onDemo={enterDemo}
              onExit={logout}
              onSelectionChange={(partId, drawing) => {
                setActivePartId(partId);
                setPickedDrawing(drawing);
              }}
            />
          )}
          {isAdmin && (
            <UnsavedChangesProvider registry={adminRegistry}>
              {visited.progress && (
                <div className={`entry-gray min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 ${stage === "select" && adminView === "progress" ? "flex" : "hidden"}`}>
                  <WorkflowProgress
                    drawing={pickedDrawing}
                    onOpenDrawing={(drawing, itemId) => openDrawingFromAdmin(drawing, itemId)}
                    onChooseDrawing={() => navigate("library")}
                  />
                </div>
              )}
              {visited.errors && (
                <div className={`entry-gray min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 ${stage === "select" && adminView === "errors" ? "flex" : "hidden"}`}>
                  <ErrorDbManager onOpenLocation={(target) => void openLocation(target)} />
                </div>
              )}
            </UnsavedChangesProvider>
          )}

          {moveOpen && selectedDrawing && (
            <MoveDrawingDialog
              drawing={selectedDrawing}
              parts={allParts}
              partPath={partPathOf}
              onCancel={() => setMoveOpen(false)}
              onConfirm={async (target) => {
                try {
                  const result = await moveDrawingToPart(selectedDrawing.drawing_id, target.part_id, selectedDrawing.part_id);
                  setMoveOpen(false);
                  handleDrawingMoved(result.drawing);
                  setReviewNotice(`소속 부품을 바꿨습니다: ${partPathOf(allParts.find((p) => p.part_id === result.from_part_id))} → ${partPathOf(target)}. 검토·측정 기록은 그대로입니다.`);
                  return null;
                } catch (cause) {
                  return `이동하지 못했습니다. 원래 소속을 유지합니다. 이유: ${cause instanceof Error ? cause.message : "알 수 없는 오류"}`;
                }
              }}
            />
          )}
          {stage === "workspace" && (
    <PanelLayoutContext.Provider value={{ side: "left", header: drawingContext }}>
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
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
    </PanelLayoutContext.Provider>
          )}
        </div>
      </div>
    </div>
    </UnsavedChangesProvider>
  );
}

export default App;