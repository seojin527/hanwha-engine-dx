import React, { useEffect, useMemo, useRef, useState } from "react";
import { OcrLoadingOverlay } from "./OcrLoadingOverlay";
import { MeasurementMarker } from "./WorkerMeasurementMarker";
import { layoutMarkers } from "../lib/markerLayout";

// 기준점(글자 박스 가장자리)에서 마커를 어느 쪽으로 붙일지
const MARKER_GAP = "3px";
// 기하공차 틀의 줄별 마커 좌우 배치와 겹침 보정은 lib/markerLayout.ts 에서 계산한다.
const MARKER_TRANSFORM: Record<string, string> = {
  top: `translate(-50%, calc(-100% - ${MARKER_GAP}))`,
  bottom: `translate(-50%, ${MARKER_GAP})`,
  left: `translate(calc(-100% - ${MARKER_GAP}), -50%)`,
  right: `translate(${MARKER_GAP}, -50%)`,
  center: "translate(-50%, -50%)",
};

interface DrawingViewerProps {
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
  const markerLayout = useMemo(
    () =>
      layoutMarkers(
        points.map((point: any) => ({
          id: point.id ?? point.displayNumber,
          x: point.labelAnchor?.x ?? point.x,
          y: point.labelAnchor?.y ?? point.y,
          side: point.labelAnchor?.side ?? "center",
          rowIndex: point.rowIndex,
          sourceId: point.sourceId ?? point.source?.id,
          frameLeft: point.frameLeft,
          frameRight: point.frameRight,
        })),
        displayScale * (imageSize.width / (coordinateSize?.width || imageSize.width || 1)),
      ),
    [points, displayScale, imageSize.width, coordinateSize?.width],
  );
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

  // 번호 마커 숨기기: 도면만 보고 싶을 때. 단축키 M (입력창에서는 동작하지 않음)
  const [markersHidden, setMarkersHidden] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "m" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      setMarkersHidden((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 마우스 휠 확대·축소 (커서 위치 기준, 한 칸당 약 10%)
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  viewRef.current = { scale: displayScale, offset };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || isPdf) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { scale: s, offset: o } = viewRef.current;
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.max(0.02, Math.min(4, s * factor));
      if (next === s) return;
      const rect = stage.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      const ratio = next / s;
      setOffset({
        x: cx - (cx - o.x) * ratio,
        y: cy - (cy - o.y) * ratio,
      });
      setManualScale(next);
      setFitMode(false);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [drawingUrl, isPdf]);

  // 도면 변경 시 확대·이동 상태 초기화
  useEffect(() => {
    setFitMode(true);
    setManualScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    setMarkersHidden(false);
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

        <button
          type="button"
          disabled={!drawingUrl || isPdf}
          aria-pressed={markersHidden}
          onClick={() => setMarkersHidden((value) => !value)}
          title="번호 마커 숨기기/보기 (M)"
          className={`rounded px-2 py-1 disabled:opacity-40 ${markersHidden ? "bg-cyan-700" : "bg-slate-800"}`}
        >
          {markersHidden ? "마커 보기" : "마커 숨기기"}
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
          ref={stageRef}
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
              style={{
                width: imageSize.width ? imageSize.width*displayScale : '90%',
                height: imageSize.height ? imageSize.height*displayScale : undefined,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                visibility: imageSize.width ? 'visible' : 'hidden',
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
                <div role="alert" className="absolute left-2 top-2 bg-rose-950 p-2 text-xs text-white">JSON과 이미지의 크기가 달라 마커를 표시하지 않습니다.</div>}
              {!markersHidden && imageSize.width > 0 && (!coordinateSize || (coordinateSize.width === imageSize.width && coordinateSize.height === imageSize.height)) &&
                points.map((point) => {
                  const id = point.id ?? point.displayNumber;

                  // 글자 박스 바깥쪽 기준점이 있으면 그 옆에 붙이고, 없으면 기존처럼 좌표 중심에 표시한다.
                  const anchor = point.labelAnchor;
                  const markerX = anchor?.x ?? point.x;
                  const markerY = anchor?.y ?? point.y;

                  if (
                    !Number.isFinite(markerX) ||
                    !Number.isFinite(markerY)
                  ) {
                    return null;
                  }

                  const lay = markerLayout.get(id);
                  const shownX = lay?.x ?? markerX;
                  const shownY = lay?.y ?? markerY;
                  const shownSide = lay?.side ?? anchor?.side ?? "center";

                  return (
                    <div
                      key={id}
                      className="absolute z-10"
                      style={{
                        left: `${(shownX / (coordinateSize?.width || imageSize.width)) * 100}%`,
                        top: `${(shownY / (coordinateSize?.height || imageSize.height)) * 100}%`,
                        transform: MARKER_TRANSFORM[shownSide] + (lay ? ` translate(${lay.dx}px, ${lay.dy}px)` : ""),
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