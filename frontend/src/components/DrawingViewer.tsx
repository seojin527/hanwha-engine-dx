/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { MeasurementMarker } from "./MeasurementMarker";

interface DrawingViewerProps {
  points: any[];
  selectedPointId: number;
  onSelectPoint: (id: number) => void;
  inspectionRecords: Record<number, any>;
  isAnalyzing: boolean;
  analyzingStep: number;
  drawingUrl?: string;
  onDrawingUploaded?: (url: string) => void;
}

export const DrawingViewer: React.FC<DrawingViewerProps> = ({
  points = [],
  selectedPointId,
  onSelectPoint,
  inspectionRecords = {},
  isAnalyzing,
  analyzingStep,
  drawingUrl,
  onDrawingUploaded,
}) => {
  const [zoom, setZoom] = useState(100);
  
  // 사용자가 public/images/ 폴더에 넣은 실제 도면 파일(1_image.png)을 기본값으로 지정
  const [currentDrawing, setCurrentDrawing] = useState<string>(
    drawingUrl || "/images/1_image.png"
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCurrentDrawing(url);
      if (onDrawingUploaded) onDrawingUploaded(url);
    }
  };

  return (
    <div className="relative flex-1 bg-slate-950 overflow-hidden flex items-center justify-center min-h-[400px]">
      {/* Top Interactive Toolbars */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur border border-slate-700 px-3 py-1.5 rounded-lg shadow text-xs text-white">
        <button className="hover:text-cyan-400 font-bold flex items-center gap-1">📍 선택</button>
        <span className="text-slate-600">|</span>
        <button className="hover:text-cyan-400">손바닥 이동</button>
        <span className="text-slate-600">|</span>
        <button onClick={() => setZoom((z) => Math.max(z - 10, 50))} className="hover:text-cyan-400 font-bold px-1">-</button>
        <span className="font-mono text-cyan-300">{zoom}%</span>
        <button onClick={() => setZoom((z) => Math.min(z + 10, 250))} className="hover:text-cyan-400 font-bold px-1">+</button>
        <span className="text-slate-600">|</span>
        <label className="cursor-pointer text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1">
          📁 도면 변경
          <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>

      {/* Drawing Canvas Area */}
      <div className="relative w-full h-full overflow-auto flex items-center justify-center p-8 select-none">
        <div 
          className="relative shadow-2xl rounded border border-slate-700 bg-white transition-transform duration-200"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
        >
          {/* 실제 로컬 도면 이미지 렌더링 */}
          <img
            src={currentDrawing}
            alt="Piston Rod Engineering Drawing"
            className="block max-w-none pointer-events-none"
            style={{ width: '1300px', height: 'auto' }}
            draggable={false}
          />

          {/* 17 Measurement Markers Positioned over the Drawing */}
          {points.map((pt) => {
            if (!pt) return null;
            const ptId = pt.id || pt.displayNumber;
            const isSelected = ptId === selectedPointId;
            const record = inspectionRecords[ptId] || {};
            const status = record.status || "pending";

            // 원본 해상도(3308x2339) 기준 좌표를 도면 이미지 비율에 맞게 퍼센트로 변환[cite: 8, 10]
            const leftPercent = (pt.x / 3308) * 100;
            const topPercent = (pt.y / 2339) * 100;

            return (
              <div
                key={ptId}
                style={{
                  position: 'absolute',
                  left: `${leftPercent}%`,
                  top: `${topPercent}%`,
                }}
                className="transform -translate-x-1/2 -translate-y-1/2 z-20"
              >
                <MeasurementMarker
                  point={pt}
                  isSelected={isSelected}
                  onClick={() => onSelectPoint(ptId)}
                  status={status}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* AI OCR Background Pipeline Analyzing Overlay */}
      {isAnalyzing && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md z-30 flex flex-col items-center justify-center text-white p-6">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-sm font-bold text-cyan-300">AI 도면 OCR 자동 파이프라인 백그라운드 실행 중...</p>
          <p className="text-xs text-slate-400 mt-1">단계 {analyzingStep} / 3 (인풋/아웃풋 디렉토리 정리 및 17개 포인트 좌표 맵핑)</p>
        </div>
      )}
    </div>
  );
};