import React, { useEffect, useRef, useState } from "react";
import { OcrLoadingOverlay } from "./OcrLoadingOverlay";
import { MeasurementMarker } from "./MeasurementMarker";
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

  const isPdf = mediaType === "application/pdf";
  const fitScale = imageSize.width && imageSize.height && viewport.width && viewport.height
    ? Math.max(0.001, Math.min(1, (viewport.width-32)/imageSize.width, (viewport.height-82)/imageSize.height)) : 1;
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

  function stopDragging(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div ref={viewportRef} aria-busy={isAnalyzing} className="relative flex min-h-[120px] min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
      <div className="z-20 flex shrink-0 items-center gap-2 border-b border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white">
        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          onClick={() => setPanMode(false)}
          className={`rounded px-2 py-1 disabled:opacity-40 ${
            !panMode ? "bg-cyan-700" : "bg-slate-800"
          }`}
        >
          선택
        </button>

        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          onClick={() => setPanMode(true)}
          className={`rounded px-2 py-1 disabled:opacity-40 ${
            panMode ? "bg-cyan-700" : "bg-slate-800"
          }`}
        >
          손바닥 이동
        </button>

        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          onClick={() => changeZoom(-0.1)}
          className="px-2 disabled:opacity-40"
        >
          −
        </button>

        <span className="min-w-[76px] text-center tabular-nums">{isPdf ? "PDF" : `${fitMode ? "맞춤 · " : ""}${Math.round(displayScale*100)}%`}</span>

        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          onClick={() => changeZoom(0.1)}
          className="px-2 disabled:opacity-40"
        >
          +
        </button>

        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          onClick={() => {
            setFitMode(true);
    setManualScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="rounded bg-slate-800 px-2 py-1 disabled:opacity-40"
        >
          화면에 맞춤
        </button>

        {isPdf && (
          <span className="text-slate-400">
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
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;

            setOffset({
              x: drag.initialX + event.clientX - drag.startX,
              y: drag.initialY + event.clientY - drag.startY,
            });
          }}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onLostPointerCapture={() => {
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