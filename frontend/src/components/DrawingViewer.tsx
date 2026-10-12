import React, { useState, useRef, useEffect } from "react";
import { MeasurementPoint } from "../data/mockData";
import { PointInspectionRecord } from "../lib/inspection";
import { MeasurementMarker } from "./MeasurementMarker";
import {
  MousePointer,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Layers,
  Sparkles,
  FileCheck2,
  ScanLine,
} from "lucide-react";

interface DrawingViewerProps {
  points: MeasurementPoint[];
  selectedPointId: number;
  onSelectPoint: (id: number) => void;
  inspectionRecords: Record<number, PointInspectionRecord>;
  isAnalyzing: boolean;
  analyzingStep: number;
}

export const DrawingViewer: React.FC<DrawingViewerProps> = ({
  points,
  selectedPointId,
  onSelectPoint,
  inspectionRecords,
  isAnalyzing,
  analyzingStep,
}) => {
  const [activeTool, setActiveTool] = useState<"pointer" | "pan">("pointer");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Layer visibility toggles
  const [showDimensions, setShowDimensions] = useState(true);
  const [showGDT, setShowGDT] = useState(true);
  const [showCenterlines, setShowCenterlines] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showLayersMenu, setShowLayersMenu] = useState(false);

  // Reset zoom & pan
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(2.5, Number((prev + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.6, Number((prev - 0.15).toFixed(2))));

  // Pan interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === "pan" || e.button === 1 || e.altKey) {
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || activeTool === "pan") {
      e.preventDefault();
      const delta = e.deltaY * -0.001;
      setZoom((prev) => Math.min(2.5, Math.max(0.6, Number((prev + delta).toFixed(2)))));
    }
  };

  // Close layers menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showLayersMenu && !(e.target as HTMLElement).closest(".layers-dropdown")) {
        setShowLayersMenu(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [showLayersMenu]);

  // Steps descriptions for loading
  const analysisSteps = [
    { title: "도면 업로드 중", desc: "고해상도 피스톤 로드 2D 기계 도면 수신 및 무결성 검증" },
    { title: "도면 영역 인식 중", desc: "원통 본체(Ø40), 피스톤 체결부(Ø30) 및 나사산 윤곽 추출" },
    { title: "치수 및 공차 분석 중", desc: "외경/전장 치수선 및 진원도·흔들림 기하공차(GD&T) 파싱" },
    { title: "측정 포인트 생성 중", desc: "피스톤 로드 5대 핵심 측정 검사 기준점 매핑 완료" },
  ];

  return (
    <div
      ref={containerRef}
      className="relative flex-1 flex flex-col bg-slate-50 border-b border-slate-300 overflow-hidden select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      style={{ cursor: activeTool === "pan" ? (isDragging ? "grabbing" : "grab") : "default" }}
    >
      {/* CAD Toolbar */}
      <div className="h-10 px-3 bg-white border-b border-slate-200 flex items-center justify-between z-20 shadow-xs">
        {/* Left tools: Mode & Nav */}
        <div className="flex items-center gap-1">
          <div className="flex items-center bg-slate-100 p-0.5 rounded border border-slate-200 mr-2">
            <button
              title="포인터 도구 (선택)"
              onClick={() => setActiveTool("pointer")}
              className={`p-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
                activeTool === "pointer"
                  ? "bg-white text-blue-700 shadow-xs font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">선택</span>
            </button>
            <button
              title="이동 도구 (Pan)"
              onClick={() => setActiveTool("pan")}
              className={`p-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
                activeTool === "pan"
                  ? "bg-white text-blue-700 shadow-xs font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Hand className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">이동</span>
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5">
            <button
              title="확대 (Zoom In)"
              onClick={handleZoomIn}
              className="p-1.5 rounded text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-xs px-2 py-0.5 text-slate-600 min-w-14 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              title="축소 (Zoom Out)"
              onClick={handleZoomOut}
              className="p-1.5 rounded text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              title="화면 맞춤"
              onClick={handleReset}
              className="p-1.5 rounded text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              title="초기화"
              onClick={handleReset}
              className="p-1.5 rounded text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right tools: Layer Toggles & Status */}
        <div className="flex items-center gap-2">
          {/* Layer toggles dropdown */}
          <div className="relative layers-dropdown">
            <button
              onClick={() => setShowLayersMenu(!showLayersMenu)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                showLayersMenu
                  ? "bg-slate-100 border-slate-300 text-slate-900"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>도면 레이어</span>
            </button>

            {showLayersMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-md shadow-lg p-2 z-40 text-xs">
                <div className="font-semibold text-slate-700 pb-1.5 mb-1.5 border-b border-slate-100">
                  도면 표시 옵션
                </div>
                <label className="flex items-center gap-2 py-1 px-1.5 hover:bg-slate-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDimensions}
                    onChange={(e) => setShowDimensions(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>치수선 (Dimensions)</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1.5 hover:bg-slate-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showGDT}
                    onChange={(e) => setShowGDT(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>기하공차 (GD&T)</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1.5 hover:bg-slate-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCenterlines}
                    onChange={(e) => setShowCenterlines(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>중심선 (Centerlines)</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1.5 hover:bg-slate-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showMarkers}
                    onChange={(e) => setShowMarkers(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span>검사 마커 (①~⑤)</span>
                </label>
              </div>
            )}
          </div>

          <div className="text-[11px] font-mono text-slate-500 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">
            PISTON ROD | CAD SCALE 1:2.5
          </div>
        </div>
      </div>

      {/* Main Canvas Viewport with Grid */}
      <div className="relative flex-1 w-full h-full overflow-hidden cad-grid-bg flex items-center justify-center">
        {/* Transformable Canvas Container */}
        <div
          className="relative transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            width: "980px",
            height: "460px",
          }}
        >
          {/* Engineering Drawing Paper Border */}
          <div className="absolute inset-0 bg-white border border-slate-300 shadow-sm rounded-xs pointer-events-none" />

          {/* Inner technical drawing margin */}
          <div className="absolute inset-2.5 border border-slate-400 pointer-events-none" />

          {/* SVG Vector Technical Drawing */}
          <svg
            viewBox="0 0 980 460"
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {/* Engineering Dimension Arrow Markers */}
              <marker
                id="arrow-start"
                viewBox="0 0 10 10"
                refX="0"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 5 L 10 1.5 L 8 5 L 10 8.5 z" fill="#1e293b" />
              </marker>
              <marker
                id="arrow-end"
                viewBox="0 0 10 10"
                refX="10"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 1.5 L 10 5 L 0 8.5 L 2 5 z" fill="#1e293b" />
              </marker>

              {/* Blue active marker highlight */}
              <marker
                id="arrow-blue"
                viewBox="0 0 10 10"
                refX="10"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 1.5 L 10 5 L 0 8.5 L 2 5 z" fill="#2563eb" />
              </marker>

              {/* Cross-hatch pattern for cut sections */}
              <pattern
                id="hatch-pattern"
                width="8"
                height="8"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <line x1="0" y1="0" x2="0" y2="8" stroke="#cbd5e1" strokeWidth="0.8" />
              </pattern>
            </defs>

            {/* Drawing Title Block (Bottom-Right Corner) */}
            <g className="title-block text-[9px] font-mono fill-slate-700">
              <rect
                x="685"
                y="380"
                width="280"
                height="65"
                fill="#f8fafc"
                stroke="#64748b"
                strokeWidth="1"
              />
              <line x1="685" y1="402" x2="965" y2="402" stroke="#64748b" strokeWidth="0.8" />
              <line x1="685" y1="424" x2="965" y2="424" stroke="#64748b" strokeWidth="0.8" />
              <line x1="775" y1="380" x2="775" y2="445" stroke="#64748b" strokeWidth="0.8" />
              <line x1="865" y1="380" x2="865" y2="445" stroke="#64748b" strokeWidth="0.8" />

              <text x="691" y="395" fontWeight="bold">DWG NO.</text>
              <text x="782" y="395" fontWeight="bold" fill="#0f172a">DWG-PR-001-M</text>
              <text x="872" y="395">REV. A</text>

              <text x="691" y="417">PART NAME</text>
              <text x="782" y="417" fontWeight="bold" fill="#0f172a">PISTON ROD (피스톤 로드)</text>

              <text x="691" y="439">MATERIAL</text>
              <text x="782" y="439">SCM440 / HARD CR</text>
              <text x="872" y="439">SCALE 1:2.5</text>
            </g>

            {/* Drawing Grid References (A, B, C / 1, 2, 3) */}
            <g className="text-[10px] font-mono fill-slate-400">
              <text x="18" y="25">A</text>
              <text x="18" y="235">B</text>
              <text x="18" y="445">C</text>
              <text x="250" y="20">1</text>
              <text x="500" y="20">2</text>
              <text x="750" y="20">3</text>
            </g>

            {/* ================= PISTON ROD SOLID CONTOUR ================= */}
            {/* Centerline: Y = 230 */}
            <g className="piston-rod-body" fill="#ffffff" stroke="#0f172a" strokeWidth="1.6">
              {/* 1. Left Nose & Chamfer C2 (x: 80 to 86, y: 206 to 254) */}
              <polygon
                points="80,212 86,206 86,254 80,248"
                fill="#f8fafc"
              />

              {/* 2. Threaded Section M24x1.5 (x: 86 to 155, height: 48, y: 206 to 254) */}
              <g className="thread-section">
                <rect x="86" y="206" width="69" height="48" fill="#ffffff" />
                {/* Thin thread root lines (ISO 0.8 stroke) */}
                <line x1="86" y1="209" x2="155" y2="209" stroke="#475569" strokeWidth="0.8" />
                <line x1="86" y1="251" x2="155" y2="251" stroke="#475569" strokeWidth="0.8" />
                {/* Pitch representation lines */}
                {[96, 106, 116, 126, 136, 146].map((tx) => (
                  <line
                    key={tx}
                    x1={tx}
                    y1="206"
                    x2={tx + 3}
                    y2="254"
                    stroke="#94a3b8"
                    strokeWidth="0.7"
                    strokeDasharray="2,2"
                  />
                ))}
                {/* Thread boundary termination line */}
                <line x1="155" y1="206" x2="155" y2="254" strokeWidth="1.6" />
              </g>

              {/* 3. Thread Undercut / Relief Groove (x: 155 to 162, y: 209 to 251) */}
              <rect x="155" y="209" width="7" height="42" fill="#f1f5f9" strokeWidth="1.2" />

              {/* 4. Wrench Flat Neck / Stepped Nose (x: 162 to 210, Ø34, height: 66, y: 197 to 263) */}
              <g className="wrench-neck">
                <rect x="162" y="197" width="48" height="66" fill="#ffffff" />
                {/* Milled spanner flats representation */}
                <line x1="168" y1="205" x2="204" y2="205" stroke="#64748b" strokeWidth="1" strokeDasharray="4,2" />
                <line x1="168" y1="255" x2="204" y2="255" stroke="#64748b" strokeWidth="1" strokeDasharray="4,2" />
                {/* Wrench flat cross lines */}
                <line x1="168" y1="205" x2="204" y2="255" stroke="#cbd5e1" strokeWidth="0.8" />
                <line x1="168" y1="255" x2="204" y2="205" stroke="#cbd5e1" strokeWidth="0.8" />
              </g>

              {/* Transition Fillet Step into Rod Body (x: 210 to 218) */}
              <path
                d="M 210,197 Q 214,195 218,194 L 218,266 Q 214,265 210,263 Z"
                fill="#ffffff"
                strokeWidth="1.6"
              />

              {/* 5. Precision Ground Rod Body Ø40 (Point 1, 4, 5: x: 218 to 715, height: 72, y: 194 to 266) */}
              <g
                className="cursor-pointer transition-all"
                onClick={() => onSelectPoint(1)}
              >
                <rect
                  x="218"
                  y="194"
                  width="497"
                  height="72"
                  className={
                    selectedPointId === 1
                      ? "stroke-blue-600 fill-blue-50/20"
                      : "stroke-slate-900 fill-white"
                  }
                  strokeWidth={selectedPointId === 1 ? "2.4" : "1.6"}
                />

                {/* Chrome plating finish subtle highlight line along upper rod */}
                <line
                  x1="225"
                  y1="198"
                  x2="708"
                  y2="198"
                  stroke="#93c5fd"
                  strokeWidth="1"
                  strokeDasharray="18,12"
                  opacity="0.8"
                />

                {/* Point 4 Circularity inspection zone visual guide */}
                {selectedPointId === 4 && (
                  <rect
                    x="290"
                    y="194"
                    width="80"
                    height="72"
                    fill="#3b82f6"
                    fillOpacity="0.12"
                    stroke="#2563eb"
                    strokeWidth="1.5"
                    strokeDasharray="4,2"
                  />
                )}

                {/* Point 5 Runout inspection zone visual guide */}
                {selectedPointId === 5 && (
                  <rect
                    x="560"
                    y="194"
                    width="80"
                    height="72"
                    fill="#3b82f6"
                    fillOpacity="0.12"
                    stroke="#2563eb"
                    strokeWidth="1.5"
                    strokeDasharray="4,2"
                  />
                )}
              </g>

              {/* 6. Stepped Shoulder Face & R1.5 Fillet (x: 715) */}
              {/* Shoulder vertical face down to Piston Mounting Neck Ø30 */}
              <line x1="715" y1="194" x2="715" y2="203" strokeWidth="1.6" />
              <line x1="715" y1="266" x2="715" y2="257" strokeWidth="1.6" />
              {/* R1.5 Fillet corner arc */}
              <path d="M 715,203 Q 716,203 718,203" strokeWidth="1.6" fill="none" />
              <path d="M 715,257 Q 716,257 718,257" strokeWidth="1.6" fill="none" />

              {/* 7. Piston Mounting Neck Ø30 (Point 2: x: 715 to 825, height: 54, y: 203 to 257) */}
              <g
                className="cursor-pointer transition-all"
                onClick={() => onSelectPoint(2)}
              >
                <rect
                  x="715"
                  y="203"
                  width="110"
                  height="54"
                  className={
                    selectedPointId === 2
                      ? "stroke-blue-600 fill-blue-50/20"
                      : "stroke-slate-900 fill-white"
                  }
                  strokeWidth={selectedPointId === 2 ? "2.4" : "1.6"}
                />

                {/* Snap Ring / Retention Groove (x: 792 to 798, depth: 2, y: 206 to 254) */}
                <rect
                  x="792"
                  y="206"
                  width="6"
                  height="48"
                  fill="#f1f5f9"
                  stroke="#475569"
                  strokeWidth="1.2"
                />
              </g>

              {/* 8. End Retention Thread / Tail Neck (x: 825 to 865, Ø22, height: 42, y: 209 to 251) */}
              <g className="tail-section">
                <rect x="825" y="209" width="40" height="42" fill="#ffffff" />
                <line x1="825" y1="212" x2="865" y2="212" stroke="#64748b" strokeWidth="0.8" />
                <line x1="825" y1="248" x2="865" y2="248" stroke="#64748b" strokeWidth="0.8" />
                <line x1="865" y1="209" x2="865" y2="251" strokeWidth="1.4" />
              </g>

              {/* 9. Tail End Chamfer C1.5 & Face (x: 865 to 870, y: 209 to 251) */}
              <polygon
                points="865,209 870,214 870,246 865,251"
                fill="#f8fafc"
              />
            </g>

            {/* Centerlines (ISO standard red long dash-dot line) */}
            {showCenterlines && (
              <g className="centerlines" stroke="#ef4444" strokeWidth="0.9" strokeDasharray="16,4,3,4">
                {/* Horizontal Piston Rod Main Axis: Y=230 */}
                <line x1="45" y1="230" x2="895" y2="230" />

                {/* Vertical Centerlines for key features */}
                <line x1="120" y1="185" x2="120" y2="275" />
                <line x1="185" y1="180" x2="185" y2="280" />
                <line x1="465" y1="165" x2="465" y2="295" />
                <line x1="715" y1="175" x2="715" y2="285" />
                <line x1="770" y1="185" x2="770" y2="275" />
                <line x1="795" y1="195" x2="795" y2="265" />
                <line x1="870" y1="195" x2="870" y2="265" />
              </g>
            )}

            {/* DATUM INDICATORS: Datum A (Mounting Neck) & Datum B (Nose Neck) */}
            <g className="datums" fontWeight="bold">
              {/* Datum A on Piston Mounting Neck (x: 770, y: 257) */}
              <g transform="translate(770, 257)">
                <polygon points="0,0 -8,12 8,12" fill="#0f172a" stroke="#0f172a" />
                <line x1="0" y1="12" x2="0" y2="24" stroke="#0f172a" strokeWidth="1.4" />
                <rect x="-10" y="24" width="20" height="18" fill="#ffffff" stroke="#0f172a" strokeWidth="1.4" />
                <text x="0" y="37" textAnchor="middle" fontSize="12" fontFamily="JetBrains Mono" fontWeight="bold" fill="#0f172a">
                  A
                </text>
              </g>

              {/* Datum B on Nose Neck (x: 185, y: 263) */}
              <g transform="translate(185, 263)">
                <polygon points="0,0 -8,12 8,12" fill="#0f172a" stroke="#0f172a" />
                <line x1="0" y1="12" x2="0" y2="24" stroke="#0f172a" strokeWidth="1.4" />
                <rect x="-10" y="24" width="20" height="18" fill="#ffffff" stroke="#0f172a" strokeWidth="1.4" />
                <text x="0" y="37" textAnchor="middle" fontSize="12" fontFamily="JetBrains Mono" fontWeight="bold" fill="#0f172a">
                  B
                </text>
              </g>
            </g>

            {/* DIMENSIONS & CALLOUTS */}
            {showDimensions && (
              <g className="dimensions text-[10px] font-mono fill-slate-800" stroke="#1e293b" strokeWidth="1">
                {/* 1. Point 1: Rod Body Outer Diameter (Ø40.000 ±0.010) */}
                <g
                  className="cursor-pointer transition-colors"
                  onClick={() => onSelectPoint(1)}
                >
                  <line x1="465" y1="165" x2="465" y2="194" stroke="#94a3b8" strokeWidth="0.8" />
                  <line x1="465" y1="266" x2="465" y2="295" stroke="#94a3b8" strokeWidth="0.8" />
                  <line
                    x1="450"
                    y1="194"
                    x2="450"
                    y2="266"
                    stroke={selectedPointId === 1 ? "#2563eb" : "#1e293b"}
                    strokeWidth={selectedPointId === 1 ? "1.6" : "1"}
                    markerStart={selectedPointId === 1 ? "url(#arrow-blue)" : "url(#arrow-start)"}
                    markerEnd={selectedPointId === 1 ? "url(#arrow-blue)" : "url(#arrow-end)"}
                  />
                  <g transform="translate(442, 230) rotate(-90)">
                    <rect x="-44" y="-14" width="88" height="14" fill="#ffffff" stroke="none" />
                    <text
                      x="0"
                      y="-3"
                      textAnchor="middle"
                      fontWeight="bold"
                      fill={selectedPointId === 1 ? "#2563eb" : "#0f172a"}
                    >
                      Ø40.000 ±0.010
                    </text>
                  </g>
                </g>

                {/* 2. Point 2: Piston Mounting Neck Outer Diameter (Ø30.000 ±0.015) */}
                <g
                  className="cursor-pointer transition-colors"
                  onClick={() => onSelectPoint(2)}
                >
                  <line
                    x1="760"
                    y1="203"
                    x2="760"
                    y2="257"
                    stroke={selectedPointId === 2 ? "#2563eb" : "#1e293b"}
                    strokeWidth={selectedPointId === 2 ? "1.6" : "1"}
                    markerStart={selectedPointId === 2 ? "url(#arrow-blue)" : "url(#arrow-start)"}
                    markerEnd={selectedPointId === 2 ? "url(#arrow-blue)" : "url(#arrow-end)"}
                  />
                  <g transform="translate(752, 230) rotate(-90)">
                    <rect x="-42" y="-14" width="84" height="14" fill="#ffffff" stroke="none" />
                    <text
                      x="0"
                      y="-3"
                      textAnchor="middle"
                      fontWeight="bold"
                      fill={selectedPointId === 2 ? "#2563eb" : "#0f172a"}
                    >
                      Ø30.000 ±0.015
                    </text>
                  </g>
                </g>

                {/* 3. Point 3: Total Rod Length (350.000 ±0.100 mm) along bottom */}
                <g
                  className="cursor-pointer transition-colors"
                  onClick={() => onSelectPoint(3)}
                >
                  {/* Extension lines from nose (x: 80) and tail (x: 870) down to y: 355 */}
                  <line x1="80" y1="248" x2="80" y2="355" stroke="#94a3b8" strokeWidth="0.8" />
                  <line x1="870" y1="246" x2="870" y2="355" stroke="#94a3b8" strokeWidth="0.8" />
                  {/* Dimension line */}
                  <line
                    x1="80"
                    y1="345"
                    x2="870"
                    y2="345"
                    stroke={selectedPointId === 3 ? "#2563eb" : "#1e293b"}
                    strokeWidth={selectedPointId === 3 ? "1.6" : "1"}
                    markerStart={selectedPointId === 3 ? "url(#arrow-blue)" : "url(#arrow-start)"}
                    markerEnd={selectedPointId === 3 ? "url(#arrow-blue)" : "url(#arrow-end)"}
                  />
                  <rect x="420" y="337" width="115" height="15" fill="#ffffff" stroke="none" />
                  <text
                    x="475"
                    y="348"
                    textAnchor="middle"
                    fontWeight="bold"
                    fill={selectedPointId === 3 ? "#2563eb" : "#0f172a"}
                  >
                    350.000 ±0.100 mm
                  </text>
                </g>

                {/* Thread Callout (M24x1.5 - 6g) */}
                <path d="M 120,206 L 140,165 L 180,165" fill="none" stroke="#475569" strokeWidth="0.9" markerStart="url(#arrow-start)" />
                <text x="185" y="168" fontWeight="bold" fill="#334155" stroke="none">
                  M24×1.5 - 6g
                </text>

                {/* Piston Neck Seating Length (50.0 ±0.05) */}
                <line x1="715" y1="266" x2="715" y2="305" stroke="#94a3b8" strokeWidth="0.8" />
                <line x1="825" y1="257" x2="825" y2="305" stroke="#94a3b8" strokeWidth="0.8" />
                <line
                  x1="715"
                  y1="295"
                  x2="825"
                  y2="295"
                  stroke="#475569"
                  strokeWidth="0.9"
                  markerStart="url(#arrow-start)"
                  markerEnd="url(#arrow-end)"
                />
                <rect x="745" y="288" width="55" height="14" fill="#ffffff" stroke="none" />
                <text x="770" y="298" textAnchor="middle" fontWeight="bold" fill="#334155" stroke="none">
                  50.0 ±0.05
                </text>

                {/* Shoulder Radius Callout (R1.5) */}
                <path d="M 715,194 L 735,160 L 765,160" fill="none" stroke="#475569" strokeWidth="0.9" markerStart="url(#arrow-start)" />
                <text x="770" y="163" fontWeight="bold" fill="#334155" stroke="none">
                  R1.5
                </text>

                {/* Chamfer Callouts */}
                <text x="60" y="200" fill="#64748b" stroke="none" fontSize="9">C2.0</text>
                <text x="875" y="200" fill="#64748b" stroke="none" fontSize="9">C1.5</text>
              </g>
            )}

            {/* GD&T FEATURE CONTROL FRAMES */}
            {showGDT && (
              <g className="gdt-frames font-mono text-[9px]">
                {/* Point 4: Circularity Frame (○ 0.010) */}
                <g
                  className="cursor-pointer transition-transform"
                  transform="translate(280, 125)"
                  onClick={() => onSelectPoint(4)}
                >
                  <rect
                    x="0"
                    y="0"
                    width="85"
                    height="16"
                    fill="#ffffff"
                    stroke={selectedPointId === 4 ? "#2563eb" : "#0f172a"}
                    strokeWidth={selectedPointId === 4 ? "1.8" : "1"}
                  />
                  <line
                    x1="24"
                    y1="0"
                    x2="24"
                    y2="16"
                    stroke={selectedPointId === 4 ? "#2563eb" : "#0f172a"}
                    strokeWidth="1"
                  />
                  <text
                    x="12"
                    y="12"
                    textAnchor="middle"
                    fontWeight="bold"
                    fill={selectedPointId === 4 ? "#2563eb" : "#0f172a"}
                  >
                    ○
                  </text>
                  <text
                    x="54"
                    y="12"
                    textAnchor="middle"
                    fontWeight="bold"
                    fill={selectedPointId === 4 ? "#2563eb" : "#0f172a"}
                  >
                    0.010
                  </text>
                  {/* Leader line pointing down to Rod Body at x: 325, y: 194 */}
                  <path
                    d="M 42,16 L 42,45 L 45,69"
                    fill="none"
                    stroke={selectedPointId === 4 ? "#2563eb" : "#0f172a"}
                    strokeWidth={selectedPointId === 4 ? "1.4" : "0.9"}
                    markerEnd={selectedPointId === 4 ? "url(#arrow-blue)" : "url(#arrow-end)"}
                  />
                </g>

                {/* Point 5: Circular Runout Frame (↗ 0.020 | A-B) */}
                <g
                  className="cursor-pointer transition-transform"
                  transform="translate(560, 125)"
                  onClick={() => onSelectPoint(5)}
                >
                  <rect
                    x="0"
                    y="0"
                    width="110"
                    height="16"
                    fill="#ffffff"
                    stroke={selectedPointId === 5 ? "#2563eb" : "#0f172a"}
                    strokeWidth={selectedPointId === 5 ? "1.8" : "1"}
                  />
                  <line
                    x1="24"
                    y1="0"
                    x2="24"
                    y2="16"
                    stroke={selectedPointId === 5 ? "#2563eb" : "#0f172a"}
                    strokeWidth="1"
                  />
                  <line
                    x1="72"
                    y1="0"
                    x2="72"
                    y2="16"
                    stroke={selectedPointId === 5 ? "#2563eb" : "#0f172a"}
                    strokeWidth="1"
                  />
                  <text
                    x="12"
                    y="12"
                    textAnchor="middle"
                    fontWeight="bold"
                    fill={selectedPointId === 5 ? "#2563eb" : "#0f172a"}
                  >
                    ↗
                  </text>
                  <text
                    x="48"
                    y="12"
                    textAnchor="middle"
                    fontWeight="bold"
                    fill={selectedPointId === 5 ? "#2563eb" : "#0f172a"}
                  >
                    0.020
                  </text>
                  <text
                    x="91"
                    y="12"
                    textAnchor="middle"
                    fontWeight="bold"
                    fill={selectedPointId === 5 ? "#2563eb" : "#0f172a"}
                  >
                    A-B
                  </text>
                  {/* Leader line pointing down to Rod Body at x: 600, y: 194 */}
                  <path
                    d="M 55,16 L 55,45 L 40,69"
                    fill="none"
                    stroke={selectedPointId === 5 ? "#2563eb" : "#0f172a"}
                    strokeWidth={selectedPointId === 5 ? "1.4" : "0.9"}
                    markerEnd={selectedPointId === 5 ? "url(#arrow-blue)" : "url(#arrow-end)"}
                  />
                </g>
              </g>
            )}

            {/* SURFACE FINISH SYMBOLS (Ra) */}
            <g className="surface-finish font-mono text-[8px] fill-slate-700" stroke="#0f172a" strokeWidth="0.9">
              {/* Ra 0.4 on Rod Body (Precision hard chrome ground) */}
              <g transform="translate(465, 148)">
                <path d="M 0 10 L 4 0 L 12 0" fill="none" />
                <text x="14" y="2" stroke="none" fontWeight="bold">Ra 0.4</text>
              </g>
              {/* Ra 0.8 on Piston Mounting Neck */}
              <g transform="translate(760, 160)">
                <path d="M 0 10 L 4 0 L 12 0" fill="none" />
                <text x="14" y="2" stroke="none" fontWeight="bold">Ra 0.8</text>
              </g>
              {/* Ra 1.6 on End Face */}
              <g transform="translate(875, 235)">
                <path d="M 0 10 L 4 0 L 12 0" fill="none" />
                <text x="14" y="2" stroke="none">Ra 1.6</text>
              </g>
            </g>
          </svg>

          {/* INSPECTION MARKERS ①~⑤ LAYER */}
          {showMarkers && (
            <div className="absolute inset-0 pointer-events-auto">
              {points.map((point) => (
                <MeasurementMarker
                  key={point.id}
                  point={point}
                  isSelected={selectedPointId === point.id}
                  record={inspectionRecords[point.id]}
                  onClick={() => onSelectPoint(point.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* MOCK AI ANALYSIS SCANNING OVERLAY */}
        {isAnalyzing && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center z-50 transition-opacity duration-200">
            {/* Laser scanning beam line effect */}
            <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-pulse top-1/3 pointer-events-none" />

            <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-6 w-[420px] text-white">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-500/20 rounded border border-blue-400/40 text-blue-400">
                    <ScanLine className="w-4 h-4 animate-spin" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold tracking-wide">AI 도면 심층 분석 엔진</h4>
                    <p className="text-[11px] text-slate-400 font-mono">OCR & GD&T Feature Extractor</p>
                  </div>
                </div>
                <span className="text-xs font-mono text-cyan-400 font-bold">
                  {Math.round(((analyzingStep + 1) / 4) * 100)}%
                </span>
              </div>

              {/* Step indicator */}
              <div className="space-y-3 mb-5">
                {analysisSteps.map((step, idx) => {
                  const isCurrent = idx === analyzingStep;
                  const isDone = idx < analyzingStep;
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 p-2 rounded transition-colors ${
                        isCurrent
                          ? "bg-blue-950/60 border border-blue-600/40"
                          : isDone
                          ? "opacity-80"
                          : "opacity-30"
                      }`}
                    >
                      <div className="mt-0.5">
                        {isDone ? (
                          <div className="w-4 h-4 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-[10px] font-bold">
                            ✓
                          </div>
                        ) : isCurrent ? (
                          <div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-slate-800 border border-slate-700 text-slate-500 flex items-center justify-center text-[10px] font-mono">
                            {idx + 1}
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p
                            className={`text-xs font-medium ${
                              isCurrent ? "text-cyan-300 font-semibold" : "text-slate-300"
                            }`}
                          >
                            {step.title}
                          </p>
                          {isCurrent && (
                            <span className="text-[10px] font-mono text-cyan-400 animate-pulse">
                              RUNNING
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                          {step.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all duration-300 ease-out"
                  style={{ width: `${((analyzingStep + 1) / 4) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
