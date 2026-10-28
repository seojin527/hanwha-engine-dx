import React, { useEffect, useRef, useState } from "react";
import { OcrLoadingOverlay } from "./OcrLoadingOverlay";
import { MeasurementMarker } from "./MeasurementMarker";
import { Hand, Maximize, Minus, MousePointer2, Plus } from "lucide-react";
import type { ReviewPreviewMarker } from "../lib/admin/drawingReviewAPI";

interface DrawingViewerProps {
  previewMarkers?: ReviewPreviewMarker[];
  onPlaceAt?: (position: { x: number; y: number }) => void;
  points: any[];
  coordinateSize?: { width: number; height: number };
  selectedPointId: number;
  onSelectPoint: (id: number) => void;
  inspectionRecords: Record<number, any>;
  isAnalyzing: boolean;
  analyzingStep: number;
  analyzingStage?: string;
  drawingUrl?: string | null;
  mediaType?: string;
  onDrawingUploaded?: (url: string) => void;
}

export const DrawingViewer: React.FC<DrawingViewerProps> = ({
  points = [],
  selectedPointId,
  onSelectPoint,
  inspectionRecords = {},
  drawingUrl,
  mediaType,
  coordinateSize,
  isAnalyzing,
  analyzingStage,
  onPlaceAt,
  previewMarkers = [],
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const [fitMode, setFitMode] = useState(true);
  const [manualScale, setManualScale] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loadedImage, setLoadedImage] = useState({ url: '', width: 0, height: 0 });
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const imageSize = loadedImage.url === drawingUrl ? loadedImage : { width: 0, height: 0 };
  const imageError = !!drawingUrl && errorUrl === drawingUrl;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  // 터치: 한 손가락 이동(선택 모드에서는 8px 넘게 움직일 때만), 두 손가락 확대·축소
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const touchPan = useRef<{ pointerId: number; startX: number; startY: number; initialX: number; initialY: number; active: boolean } | null>(null);
  const pinch = useRef<{ distance: number; midX: number; midY: number; scale: number; offsetX: number; offsetY: number } | null>(null);

  const isPdf = mediaType === "application/pdf";
  const fitScale = imageSize.width && imageSize.height && viewport.width && viewport.height
    ? Math.max(0.001, Math.min(1, (viewport.width-32)/imageSize.width, (viewport.height-76)/imageSize.height)) : 1;
  const displayScale = fitMode ? fitScale : manualScale;
  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver(entries => {
      const {width, height} = entries[0].contentRect;
      setViewport({width, height});
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);
  function changeZoom(delta: number) {
    setManualScale(Math.max(0.02, Math.min(4, displayScale+delta)));
    setFitMode(false);
  }

  // 도면 변경 시 확대·이동 상태 초기화
  useEffect(() => {
    setFitMode(true);
    setManualScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    dragRef.current = null;
  }, [drawingUrl]);

  function capture(element: HTMLElement, pointerId: number) {
    // 손가락이 영역 밖으로 나가도 이동이 이어지게. 이미 끝난 포인터면 무시한다.
    try { element.setPointerCapture(pointerId); } catch { /* 포인터가 이미 사라짐 */ }
  }

  function pinchState(rect: DOMRect) {
    const [a, b] = [...touches.current.values()];
    return {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      // 화면 중앙 기준 좌표 (도면은 가운데 정렬 + offset 이동)
      midX: (a.x + b.x) / 2 - (rect.left + rect.width / 2),
      midY: (a.y + b.y) / 2 - (rect.top + rect.height / 2),
    };
  }

  function touchDown(event: React.PointerEvent<HTMLDivElement>) {
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size === 2) {
      touchPan.current = null;
      setManualScale(displayScale);
      setFitMode(false);
      pinch.current = { ...pinchState(event.currentTarget.getBoundingClientRect()), scale: displayScale, offsetX: offset.x, offsetY: offset.y };
    } else if (touches.current.size === 1) {
      touchPan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initialX: offset.x, initialY: offset.y, active: panMode };
      if (panMode) capture(event.currentTarget, event.pointerId);
    }
  }

  function touchMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = pinch.current;
    if (start && touches.current.size >= 2) {
      const now = pinchState(event.currentTarget.getBoundingClientRect());
      const scale = Math.max(0.02, Math.min(4, start.scale * now.distance / start.distance));
      const factor = scale / start.scale;
      // 손가락 사이 지점이 가리키는 도면 위치를 그대로 두고 확대한다.
      setManualScale(scale);
      setOffset({ x: now.midX - (start.midX - start.offsetX) * factor, y: now.midY - (start.midY - start.offsetY) * factor });
      return;
    }
    const pan = touchPan.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.active) {
      if (Math.hypot(dx, dy) < 8) return;
      pan.active = true;
      capture(event.currentTarget, event.pointerId);
    }
    if (fitMode) {
      setManualScale(displayScale);
      setFitMode(false);
    }
    setOffset({ x: pan.initialX + dx, y: pan.initialY + dy });
  }

  function touchUp(event: React.PointerEvent<HTMLDivElement>) {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (touchPan.current?.pointerId === event.pointerId) touchPan.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function stopDragging(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return touchUp(event);
    if (dragRef.current?.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div ref={viewportRef} aria-busy={isAnalyzing} className="dx-drawing-surround relative flex min-h-[120px] min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
      <div className="z-20 flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-800 bg-slate-900 px-3 text-xs text-slate-200">
        <div role="group" aria-label="도면 조작 모드" className="seg-dark">
          <button
            type="button"
            aria-pressed={!panMode}
            disabled={!drawingUrl || isPdf}
            onClick={() => setPanMode(false)}
            className="seg-item gap-1 px-2"
          >
            <MousePointer2 aria-hidden="true" className="h-3.5 w-3.5" />
            선택
          </button>
          <button
            type="button"
            aria-pressed={panMode}
            disabled={!drawingUrl || isPdf}
            onClick={() => setPanMode(true)}
            className="seg-item gap-1 px-2"
          >
            <Hand aria-hidden="true" className="h-3.5 w-3.5" />
            이동
          </button>
        </div>

        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-slate-700" />

        <div role="group" aria-label="확대·축소" className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="축소"
            disabled={!drawingUrl || isPdf}
            onClick={() => changeZoom(-0.1)}
            className="btn btn-dark-ghost btn-icon h-6"
          >
            <Minus aria-hidden="true" className="h-3.5 w-3.5" />
          </button>

          <span className="min-w-[68px] text-center font-mono text-[11px] tabular-nums text-slate-300">{isPdf ? "PDF" : `${fitMode ? "맞춤 " : ""}${Math.round(displayScale*100)}%`}</span>

          <button
            type="button"
            aria-label="확대"
            disabled={!drawingUrl || isPdf}
            onClick={() => changeZoom(0.1)}
            className="btn btn-dark-ghost btn-icon h-6"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          disabled={!drawingUrl || isPdf || (fitMode && offset.x === 0 && offset.y === 0)}
          onClick={() => {
            setFitMode(true);
            setManualScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="btn btn-dark-ghost h-6"
        >
          <Maximize aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="compact:sr-only">화면에 맞춤</span>
        </button>

        {isPdf && (
          <span className="truncate text-[11px] text-slate-400">
            PDF는 뷰어의 페이지 맞춤·확대 도구를 사용하세요.
          </span>
        )}
      </div>

      {isAnalyzing && <OcrLoadingOverlay stage={analyzingStage} />}
      {!drawingUrl ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-400">
          부품에서 도면을 선택하거나 새 도면을 등록해주세요.
        </div>
      ) : isPdf ? (
        <iframe
          key={drawingUrl}
          src={drawingUrl.includes("#") ? drawingUrl : `${drawingUrl}#view=Fit`}
          title="등록된 PDF 도면"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <div
          className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
          style={{
            cursor: panMode
              ? dragging
                ? "grabbing"
                : "grab"
              : "default",
          }}

          onPointerDown={(event) => {
            if (onPlaceAt) return;
            if (event.pointerType === "touch") return touchDown(event);
            if (!panMode || event.button !== 0) return;

            event.preventDefault();
            setManualScale(displayScale);
            setFitMode(false);
            event.currentTarget.setPointerCapture(event.pointerId);

            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              initialX: offset.x,
              initialY: offset.y,
            };

            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "touch") return touchMove(event);
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;

            setOffset({
              x: drag.initialX + event.clientX - drag.startX,
              y: drag.initialY + event.clientY - drag.startY,
            });
          }}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onLostPointerCapture={(event) => {
            if (event.pointerType === "touch") return;
            dragRef.current = null;
            setDragging(false);
          }}
        >
          {imageError ? (
            <p role="alert" className="p-4 text-sm text-rose-300">
              도면 이미지를 불러오지 못했습니다.
            </p>
          ) : (
            <div
              className="relative shrink-0"
              onClickCapture={(event) => {
                if (!onPlaceAt || isAnalyzing) return;

                // 번호 마커를 눌러도 위치 선택으로 처리한다.
                event.preventDefault();
                event.stopPropagation();

                const width = coordinateSize?.width || imageSize.width;
                const height = coordinateSize?.height || imageSize.height;

                if (!width || !height) return;

                // 좌표계와 실제 이미지가 다르면 위치를 저장하지 않는다.
                if (
                  coordinateSize &&
                  (coordinateSize.width !== imageSize.width ||
                    coordinateSize.height !== imageSize.height)
                ) {
                  return;
                }

                const rect = event.currentTarget.getBoundingClientRect();
                if (!rect.width || !rect.height) return;

                // 확대·이동된 화면 좌표를 원본 이미지 픽셀로 변환한다.
                const x = ((event.clientX - rect.left) / rect.width) * width;
                const y = ((event.clientY - rect.top) / rect.height) * height;

                if (x < 0 || y < 0 || x >= width || y >= height) return;

                onPlaceAt({
                  x: Math.min(width - 1, Math.max(0, Math.round(x))),
                  y: Math.min(height - 1, Math.max(0, Math.round(y))),
                });
              }}
              style={{
                width: imageSize.width ? imageSize.width*displayScale : '90%',
                height: imageSize.height ? imageSize.height*displayScale : undefined,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                visibility: imageSize.width ? 'visible' : 'hidden',
                transformOrigin: "center",
                cursor: onPlaceAt ? "crosshair" : undefined,
              }}
            >
              <img
                key={drawingUrl}
                src={drawingUrl}
                alt="선택한 도면"
                draggable={false}
                onLoad={(event) => {
                  setLoadedImage({
                    url: drawingUrl,
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                }}
                onError={() => setErrorUrl(drawingUrl)}
                className="pointer-events-none block h-auto w-full bg-white"
              />

                {imageSize.width > 0 &&
                (!coordinateSize ||
                  (coordinateSize.width === imageSize.width &&
                    coordinateSize.height === imageSize.height)) &&
                previewMarkers.map((marker) => (
                  <div
                    key={`preview-${marker.id}`}
                    className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
                    style={{
                      left: `${(marker.x / imageSize.width) * 100}%`,
                      top: `${(marker.y / imageSize.height) * 100}%`,
                      marginTop: -20,
                    }}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-xs font-bold text-slate-950 shadow-lg">
                      {marker.number}
                    </div>

                    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-950 shadow">
                    {marker.text || "추가 치수"} · 저장 전
                  </span>
                  
                  </div>
                ))}

              {coordinateSize && imageSize.width > 0 && (coordinateSize.width !== imageSize.width || coordinateSize.height !== imageSize.height) &&
                <div role="alert" className="absolute left-2 top-2 bg-rose-950 p-2 text-xs text-white">JSON과 이미지의 크기가 달라 마커를 표시하지 않습니다.</div>}
              {imageSize.width > 0 && (!coordinateSize || (coordinateSize.width === imageSize.width && coordinateSize.height === imageSize.height)) &&
                points.map((point) => {
                  const id = point.id ?? point.displayNumber;

                  if (
                    !Number.isFinite(point.x) ||
                    !Number.isFinite(point.y)
                  ) {
                    return null;
                  }

                  return (
                    <div
                      key={id}
                      className="absolute z-10 -translate-x-1/2 -translate-y-full"
                      style={{
                        left: `${(point.x / (coordinateSize?.width || imageSize.width)) * 100}%`,
                        top: `${(point.y / (coordinateSize?.height || imageSize.height)) * 100}%`,
                        marginTop: -20,
                        pointerEvents: panMode ? "none" : "auto",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 top-full h-3 w-px -translate-x-1/2 bg-cyan-600/70"
                      />

                      <MeasurementMarker
                        point={point}
                        isSelected={id === selectedPointId}
                        onClick={() => onSelectPoint(id)}
                        status={inspectionRecords[id]?.status || "pending"}
                      />
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};