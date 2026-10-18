import React, { useEffect, useRef, useState } from "react";
import { MeasurementMarker } from "./MeasurementMarker";

interface DrawingViewerProps {
  points: any[];
  coordinateSize?: { width: number; height: number };
  selectedPointId: number;
  onSelectPoint: (id: number) => void;
  inspectionRecords: Record<number, any>;
  isAnalyzing: boolean;
  analyzingStep: number;
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
}) => {
  const [zoom, setZoom] = useState(100);
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

  // 도면 변경 시 확대·이동 상태 초기화
  useEffect(() => {
    setZoom(100);
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
    <div className="relative flex min-h-[160px] flex-1 flex-col overflow-hidden bg-slate-950">
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
          onClick={() => setZoom((value) => Math.max(25, value - 25))}
          className="px-2 disabled:opacity-40"
        >
          −
        </button>

        <span>{isPdf ? "PDF" : `${zoom}%`}</span>

        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          onClick={() => setZoom((value) => Math.min(400, value + 25))}
          className="px-2 disabled:opacity-40"
        >
          +
        </button>

        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          onClick={() => {
            setZoom(100);
            setOffset({ x: 0, y: 0 });
          }}
          className="rounded bg-slate-800 px-2 py-1 disabled:opacity-40"
        >
          보기 초기화
        </button>

        {isPdf && (
          <span className="text-slate-400">
            PDF 확대·이동은 PDF 뷰어 도구를 사용하세요.
          </span>
        )}
      </div>

      {isAnalyzing && <div role="status" className="absolute left-3 top-14 z-30 rounded border border-cyan-600 bg-slate-900/95 px-4 py-2 text-xs text-cyan-200">OCR 추출 결과 적용 중…</div>}
      {!drawingUrl ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-400">
          부품에서 도면을 선택하거나 새 도면을 등록해주세요.
        </div>
      ) : isPdf ? (
        <iframe
          key={drawingUrl}
          src={drawingUrl}
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
            if (!panMode || event.button !== 0) return;

            event.preventDefault();
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
              className="relative w-[90%] max-w-[1300px] shrink-0"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom / 100})`,
                transformOrigin: "center",
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

              {coordinateSize && imageSize.width > 0 && (coordinateSize.width !== imageSize.width || coordinateSize.height !== imageSize.height) &&
                <div role="alert" className="absolute left-2 top-2 bg-rose-950 p-2 text-xs text-white">JSON과 PNG의 크기가 달라 마커를 표시하지 않습니다.</div>}
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
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                      style={{
                        left: `${(point.x / (coordinateSize?.width || imageSize.width)) * 100}%`,
                        top: `${(point.y / (coordinateSize?.height || imageSize.height)) * 100}%`,
                        pointerEvents: panMode ? "none" : "auto",
                      }}
                    >
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