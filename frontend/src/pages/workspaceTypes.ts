import type { ReactNode } from "react";
import type { Drawing } from "../lib/drawingAPI";
import type { OcrDocument, OcrPoint } from "../lib/ocr";
import type { MeasurementRecord, SavedMeasurement } from "../lib/measurementAPI";
import type { ReviewPreviewMarker } from "../lib/admin/drawingReviewAPI";

export { WORK_PURPOSES, type WorkPurpose } from "../lib/purpose";

/**
 * 작업 화면이 함께 받는 공통 상태와 동작 (도면 · OCR · 데모).
 * 상태·API 호출·저장은 App 한 곳에서 관리하고, 페이지는 화면 배치만 맡는다.
 */
export interface DrawingPageProps {
  demoMode: boolean;

  // ---------------------------------------------------------------- 등록 도면 · OCR
  selectedDrawing: Drawing | null;
  document: OcrDocument | null;
  ocrStatus: "idle" | "loading" | "applying" | "ready" | "error";
  ocrStage: string;
  /** 현재 OCR 결과 버전 */
  revision?: string;
  /** 도면 뷰어에 띄울 이미지 (OCR 결과 이미지 또는 원본) */
  resultUrl: string | null;
  ocrPoints: OcrPoint[];
  /** 상단 검색어로 거른 측정항목 */
  filteredOcrPoints: OcrPoint[];
  activeOcrPoint?: OcrPoint;
  onSelectOcrPoint: (id: number) => void;
  onNavigateOcr: (delta: number) => void;

  // ---------------------------------------------------------------- 데모 도면
  demo: {
    points: any[];
    selectedPointId: number;
    onSelectPoint: (id: number) => void;
    inspectionRecords: Record<number, any>;
    selectedItemId: string;
    onSelectItem: (pointId: number, itemId: string) => void;
    currentPoint: any;
    total: number;
    onNavigatePoint: (delta: number) => void;
    onSaveRecord: (record: any) => void;
    onSelectItemId: (itemId: string) => void;
  };
}

/** 작업자 페이지(부품제작·조립·검증)가 받는 값. */
export interface WorkspacePageProps extends DrawingPageProps {
  /** 마커 색 표시용 (point.id → 이 목적의 측정 상태) */
  ocrInspectionRecords: Record<number, { status: string }>;
  /** item_id → 이 목적에서 저장된 측정 결과 */
  measurementRecords: Record<string, MeasurementRecord>;
  onMeasurementSaved: (record: SavedMeasurement) => void;
  /** 다른 업무 페이지를 보는 중이면 true: 측정 입력·오류 등록을 잠그고 조회만 한다. */
  readOnly: boolean;
  /** 관리자 검토가 끝나지 않아 작업자 화면을 쓸 수 없는 상태 */
  workerBlocked: boolean;
}

/** 통합 관리자 페이지가 받는 값. */
export interface AdminPageProps extends DrawingPageProps {
  /** 관리자 검토 패널 (App 이 하나만 만든다). 검토할 OCR 결과가 없으면 null. */
  reviewPane: ReactNode | null;
  pickingPosition: boolean;
  onCancelPositionPick: () => void;
  onPlaceAt: (position: { x: number; y: number }) => void;
  reviewPreviewMarkers: ReviewPreviewMarker[];
}
