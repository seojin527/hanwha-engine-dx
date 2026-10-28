/**
 * 휴대폰 도면 보기. 데스크톱 DrawingViewer 와 별도로, 작은 화면에서 도면을 가리지 않게 만든다.
 * - 기본 배율에서는 번호 대신 작은 점, 확대하면 작은 번호. 선택한 항목만 크게 강조한다.
 * - 마커는 작아도 터치 영역은 32px.
 * - 한 손가락 이동(8px 넘게 움직일 때만, 탭은 마커 선택), 두 손가락 확대·축소, 마우스 끌기·휠.
 * - 선택 항목이 바뀌면 확대 중일 때 배율은 그대로 두고 그 항목이 가운데 오도록 옮긴다 (맞춤 상태면 강조만).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { OcrPoint } from "../../lib/ocr";

export type MarkerTone = "todo" | "done" | "fail" | "muted" | "stage";

const TONE: Record<MarkerTone, string> = {
  todo: "bg-cyan-600 text-white",
  stage: "bg-orange-500 text-white",
  done: "bg-emerald-600 text-white",
  fail: "bg-red-600 text-white",
  muted: "bg-slate-400 text-white opacity-70",
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const MIN_SCALE = 0.02;
const MAX_SCALE = 3;

export function MobileDrawingView({
  url,
  coordinateSize,
  points,
  selectedId,
  onSelect,
  toneOf,
  focusOnStart = false,
  onPickAt,
  className = "",
}: {
  url: string | null;
  coordinateSize?: { width: number; height: number };
  points: OcrPoint[];
  selectedId?: number;
  onSelect?: (id: number) => void;
  toneOf?: (point: OcrPoint) => MarkerTone;
  /** 처음 열 때 선택 항목 주변을 확대해서 보여준다 (작업 화면) */
  focusOnStart?: boolean;
  /** 관리자 '놓친 치수 추가': 도면을 누른 위치(이미지 픽셀)를 돌려준다. 이때 번호 마커는 누를 수 없다 */
  onPickAt?: (position: { x: number; y: number }) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState({ url: "", width: 0, height: 0 });
  const [view, setView] = useState<{ fit: boolean; scale: number; x: number; y: number }>({ fit: true, scale: 1, x: 0, y: 0 });
  const [failed, setFailed] = useState("");
  const started = useRef("");

  const imgW = image.url === url ? image.width : 0;
  const imgH = image.url === url ? image.height : 0;
  const coordW = coordinateSize?.width || imgW;
  const coordH = coordinateSize?.height || imgH;
  const markersValid = imgW > 0 && (!coordinateSize || (coordinateSize.width === imgW && coordinateSize.height === imgH));
  const fitScale = imgW && viewport.width ? Math.max(MIN_SCALE, Math.min((viewport.width - 16) / imgW, (viewport.height - 16) / imgH)) : 1;
  const scale = view.fit ? fitScale : view.scale;
  const offset = view.fit ? { x: 0, y: 0 } : { x: view.x, y: view.y };
  const width = imgW * scale;
  const height = imgH * scale;
  const left = viewport.width / 2 - width / 2 + offset.x;
  const top = viewport.height / 2 - height / 2 + offset.y;
  const selected = points.find((point) => point.id === selectedId);

  useLayoutEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  /** 이미지 좌표(px,py)가 화면 가운데 오도록 하는 이동량 */
  function centerOn(point: OcrPoint, nextScale: number) {
    const px = (point.x / coordW) * imgW * nextScale;
    const py = (point.y / coordH) * imgH * nextScale;
    return { x: (imgW * nextScale) / 2 - px, y: (imgH * nextScale) / 2 - py };
  }

  // 처음 열 때(작업 화면): 선택 항목 주변을 읽을 수 있는 배율로
  useEffect(() => {
    if (!focusOnStart || !selected || !imgW || !viewport.width || !markersValid) return;
    const key = `${url}`;
    if (started.current === key) return;
    started.current = key;
    const next = clamp(fitScale * 3, fitScale, 0.9);
    setView({ fit: false, scale: next, ...centerOn(selected, next) });
  }, [focusOnStart, selected, imgW, viewport.width, markersValid, url]); // eslint-disable-line react-hooks/exhaustive-deps

  // 항목 이동: 확대 중이면 배율 유지하고 그 항목으로 옮긴다. 맞춤 상태면 그대로 (강조만 바뀐다).
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    if (lastSelected.current === selectedId) return;
    lastSelected.current = selectedId;
    if (!selected || !markersValid) return;
    setView((current) => (current.fit ? current : { ...current, ...centerOn(selected, current.scale) }));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- 제스처
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; active: boolean } | null>(null);
  const pinch = useRef<{ d: number; mx: number; my: number; scale: number; ox: number; oy: number } | null>(null);

  function begin() {
    // 맞춤 상태에서 조작을 시작하면 현재 모습을 그대로 수동 상태로 옮긴다.
    if (view.fit) setView({ fit: false, scale: fitScale, x: 0, y: 0 });
    return { scale, x: offset.x, y: offset.y };
  }

  function pinchInfo() {
    const [a, b] = [...pointers.current.values()];
    const rect = box.current!.getBoundingClientRect();
    return {
      d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mx: (a.x + b.x) / 2 - (rect.left + rect.width / 2),
      my: (a.y + b.y) / 2 - (rect.top + rect.height / 2),
    };
  }

  function zoomBy(factor: number) {
    const base = begin();
    const next = clamp(base.scale * factor, MIN_SCALE, MAX_SCALE);
    const ratio = next / base.scale;
    setView({ fit: false, scale: next, x: base.x * ratio, y: base.y * ratio });
  }

  return (
    <div className={`relative overflow-hidden bg-slate-950 ${className}`}>
      <div
        ref={box}
        className="absolute inset-0 touch-none select-none"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2) {
            pan.current = null;
            const base = begin();
            pinch.current = { ...pinchInfo(), scale: base.scale, ox: base.x, oy: base.y };
          } else if (pointers.current.size === 1) {
            pan.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: offset.x, oy: offset.y, active: false };
          }
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const start = pinch.current;
          if (start && pointers.current.size >= 2) {
            const now = pinchInfo();
            const next = clamp((start.scale * now.d) / start.d, MIN_SCALE, MAX_SCALE);
            const f = next / start.scale;
            setView({ fit: false, scale: next, x: now.mx - (start.mx - start.ox) * f, y: now.my - (start.my - start.oy) * f });
            return;
          }
          const p = pan.current;
          if (!p || p.id !== event.pointerId) return;
          const dx = event.clientX - p.sx;
          const dy = event.clientY - p.sy;
          if (!p.active) {
            if (Math.hypot(dx, dy) < 8) return;
            p.active = true;
            if (view.fit) {
              setView({ fit: false, scale: fitScale, x: 0, y: 0 });
              p.ox = 0;
              p.oy = 0;
            }
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* 이미 끝난 포인터 */
            }
          }
          setView((current) => ({ ...current, fit: false, x: p.ox + dx, y: p.oy + dy }));
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (pan.current?.id === event.pointerId) pan.current = null;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          pinch.current = null;
          pan.current = null;
        }}
        onWheel={(event) => zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15)}
      >
        {url && !failed && (
          <div
            className="absolute"
            style={{ left, top, width: width || "90%", height: height || undefined, visibility: imgW ? "visible" : "hidden", cursor: onPickAt ? "crosshair" : undefined }}
            onClick={(event) => {
              if (!onPickAt || !markersValid) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * coordW;
              const y = ((event.clientY - rect.top) / rect.height) * coordH;
              if (x < 0 || y < 0 || x >= coordW || y >= coordH) return;
              onPickAt({ x: Math.round(x), y: Math.round(y) });
            }}
          >
            <img
              key={url}
              src={url}
              alt="도면"
              draggable={false}
              onLoad={(event) => setImage({ url, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setFailed(url)}
              className="pointer-events-none block h-full w-full bg-white"
            />
            {markersValid &&
              points.map((point) => {
                if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
                const isSelected = point.id === selectedId;
                const tone = TONE[toneOf?.(point) ?? "todo"];
                // 확대해서 번호가 겹치지 않을 만큼 커지면 번호를 보인다.
                const showNumber = isSelected || scale >= 0.32;
                return (
                  <button
                    key={point.id}
                    type="button"
                    aria-label={`${point.displayNumber}번 ${point.feature.name}`}
                    aria-pressed={isSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect?.(point.id);
                    }}
                    className={`absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${isSelected ? "z-30" : "z-10"} ${onPickAt ? "pointer-events-none" : ""}`}
                    style={{ left: `${(point.x / coordW) * 100}%`, top: `${(point.y / coordH) * 100}%` }}
                  >
                    {isSelected ? (
                      <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[13px] font-bold shadow-lg ring-[3px] ring-white outline outline-2 outline-slate-950 ${tone}`}>
                        {point.displayNumber}
                      </span>
                    ) : showNumber ? (
                      <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-0.5 text-[10px] font-semibold opacity-85 ring-1 ring-white/80 ${tone}`}>
                        {point.displayNumber}
                      </span>
                    ) : (
                      <span className={`h-2.5 w-2.5 rounded-full ring-1 ring-white ${tone}`} />
                    )}
                  </button>
                );
              })}
          </div>
        )}
        {failed && <p role="alert" className="p-4 text-sm text-rose-300">도면 이미지를 불러오지 못했습니다.</p>}
        {imgW > 0 && coordinateSize && !markersValid && (
          <p role="alert" className="absolute left-2 top-2 rounded bg-rose-950/90 px-2 py-1 text-xs text-white">이미지와 좌표 크기가 달라 번호를 표시하지 않습니다.</p>
        )}
      </div>

      <div className="absolute bottom-2 right-2 z-40 flex flex-col overflow-hidden rounded-lg border border-white/15 bg-slate-900/90 shadow-lg">
        <button type="button" aria-label="확대" onClick={() => zoomBy(1.4)} className="flex h-10 w-10 items-center justify-center text-white active:bg-white/10">
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
        <button type="button" aria-label="축소" onClick={() => zoomBy(1 / 1.4)} className="flex h-10 w-10 items-center justify-center border-t border-white/10 text-white active:bg-white/10">
          <Minus aria-hidden="true" className="h-4 w-4" />
        </button>
        <button type="button" aria-label="도면 전체 보기" onClick={() => setView({ fit: true, scale: 1, x: 0, y: 0 })} className="flex h-10 w-10 items-center justify-center border-t border-white/10 text-white active:bg-white/10">
          <Maximize aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
