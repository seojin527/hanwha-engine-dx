import type { ReactNode } from "react";
import type { Drawing } from "../lib/drawingAPI";
import type { OcrDocument, OcrPoint } from "../lib/ocr";
import type { MeasurementRecord, SavedMeasurement } from "../lib/measurementAPI";
import type { ReviewPreviewMarker } from "../lib/admin/drawingReviewAPI";

export type WorkPurpose = "manufacturing" | "assembly" | "verification";

export const WORK_PURPOSES: { value: WorkPurpose; label: string }[] = [
  { value: "manufacturing", label: "부품제작" },
  { value: "assembly", label: "조립" },
  { value: "verification", label: "검증" },
];

/**
 * 세 작업 페이지(부품제작·조립·검증)가 함께 받는 공통 상태와 동작.
 * 상태·API 호출·저장은 App 한 곳에서 관리하고, 페이지는 화면 배치만 맡는다.
 */
export interface WorkspacePageProps {
  demoMode: boolean;

  // ---------------------------------------------------------------- 등록 도면 · OCR
  selectedDrawing: Drawing | null;
  document: OcrDocument | null;
  ocrStatus: "idle" | "loading" | "applying" | "ready" | "error";
  ocrStage: string;
  /** 현재 OCR 결과 버전 (측정 저장에 쓴다) */
  revision?: string;
  /** 도면 뷰어에 띄울 이미지 (OCR 결과 이미지 또는 원본) */
  resultUrl: string | null;
  ocrPoints: OcrPoint[];
  /** 상단 검색어로 거른 측정항목 */
  filteredOcrPoints: OcrPoint[];
  activeOcrPoint?: OcrPoint;
  /** 마커 색 표시용 (point.id → 상태) */
  ocrInspectionRecords: Record<number, { status: string }>;
  /** item_id → 저장된 측정 결과 */
  measurementRecords: Record<string, MeasurementRecord>;
  onSelectOcrPoint: (id: number) => void;
  onNavigateOcr: (delta: number) => void;
  onMeasurementSaved: (record: SavedMeasurement) => void;

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

  // ---------------------------------------------------------------- 관리자 검토 (공통 흐름)
  reviewOpen: boolean;
  pickingPosition: boolean;
  onCancelPositionPick: () => void;
  onPlaceAt: (position: { x: number; y: number }) => void;
  reviewPreviewMarkers: ReviewPreviewMarker[];
  /** 관리자 검토 패널. App 이 하나만 만들어 넘긴다. */
  reviewPane: ReactNode;
  /** 검토가 끝나지 않아 작업자 화면을 쓸 수 없는 상태 */
  workerBlocked: boolean;
  canOpenReview: boolean;
  onOpenReview: () => void;
}
