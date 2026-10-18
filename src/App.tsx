/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { DrawingViewer } from "./components/DrawingViewer";
import { MeasurementTable } from "./components/MeasurementTable";
import { MeasurementPanel } from "./components/MeasurementPanel";
import { MOCK_MEASUREMENT_POINTS, MOCK_PART_INFO } from "./data/mockData";
import { DEFAULT_INITIAL_RESULTS, STORAGE_KEYS } from "./lib/inspection";

export function App() {
  const [selectedPointId, setSelectedPointId] = useState<number>(1);
  const [selectedItemId, setSelectedItemId] = useState<string>("p1-item");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzingStep, setAnalyzingStep] = useState<number>(1);

  // Inspection records state
  const [inspectionRecords, setInspectionRecords] = useState<Record<number, any>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RESULTS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_INITIAL_RESULTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(inspectionRecords));
    } catch (e) {
      console.error(e);
    }
  }, [inspectionRecords]);

  // Handle drawing upload trigger & background OCR simulation
  const handleUploadDrawing = (fileName: string) => {
    setIsAnalyzing(true);
    setAnalyzingStep(1);

    setTimeout(() => {
      setAnalyzingStep(2);
    }, 1000);

    setTimeout(() => {
      setAnalyzingStep(3);
    }, 2000);

    setTimeout(() => {
      setIsAnalyzing(false);
      alert(`[도면 업로드 완료] ${fileName} 파일이 성공적으로 업로드되었으며, 백그라운드 OCR 파이프라인을 통해 17개 검사 포인트 좌표 매핑이 완료되었습니다.`);
    }, 3000);
  };

  const handleResetData = () => {
    if (window.confirm("모든 검사 데이터를 초기화하시겠습니까?")) {
      setInspectionRecords(DEFAULT_INITIAL_RESULTS);
      setSelectedPointId(1);
    }
  };

  const filteredPoints = MOCK_MEASUREMENT_POINTS.filter((pt) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = (pt.feature?.name || "").toLowerCase();
    const formatted = (pt.dimension?.formatted || "").toLowerCase();
    return name.includes(q) || formatted.includes(q) || String(pt.displayNumber).includes(q);
  });

  const currentPoint = MOCK_MEASUREMENT_POINTS.find((pt) => (pt.id || pt.displayNumber) === selectedPointId) || MOCK_MEASUREMENT_POINTS[0];
  const currentRecord = inspectionRecords[selectedPointId] || {};

  const handleNavigatePoint = (delta: number) => {
    const currentIndex = MOCK_MEASUREMENT_POINTS.findIndex((pt) => (pt.id || pt.displayNumber) === selectedPointId);
    let nextIndex = currentIndex + delta;
    if (nextIndex < 0) nextIndex = MOCK_MEASUREMENT_POINTS.length - 1;
    if (nextIndex >= MOCK_MEASUREMENT_POINTS.length) nextIndex = 0;
    const nextPt = MOCK_MEASUREMENT_POINTS[nextIndex];
    const nextId = nextPt.id || nextPt.displayNumber;
    setSelectedPointId(nextId);
    setSelectedItemId(nextPt.items?.[0]?.id || `p${nextId}-item`);
  };

  const handleSaveRecord = (updatedRecord: any) => {
    setInspectionRecords((prev) => ({
      ...prev,
      [selectedPointId]: updatedRecord,
    }));
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      {/* Header */}
      <Header
        onUploadDrawing={handleUploadDrawing}
        onResetData={handleResetData}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Main Split Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Drawing Viewer (Top) + Inspection Table (Bottom) */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-slate-800">
          <DrawingViewer
            points={filteredPoints}
            selectedPointId={selectedPointId}
            onSelectPoint={(id) => setSelectedPointId(id)}
            inspectionRecords={inspectionRecords}
            isAnalyzing={isAnalyzing}
            analyzingStep={analyzingStep}
          />
          <MeasurementTable
            points={filteredPoints}
            selectedPointId={selectedPointId}
            onSelectPoint={(id) => setSelectedPointId(id)}
            inspectionRecords={inspectionRecords}
            selectedItemId={selectedItemId}
            onSelectItem={(ptId, itemId) => {
              setSelectedPointId(ptId);
              setSelectedItemId(itemId);
            }}
          />
        </div>

        {/* Right Column: Measurement Panel (Inspection & RAG Guidelines) */}
        <div className="w-[440px] bg-white flex flex-col shrink-0 border-l border-slate-200 shadow-xl overflow-y-auto">
          <MeasurementPanel
            currentPoint={currentPoint}
            totalPointsCount={MOCK_MEASUREMENT_POINTS.length}
            onNavigatePoint={handleNavigatePoint}
            record={currentRecord}
            onSaveRecord={handleSaveRecord}
            selectedItemId={selectedItemId}
            onSelectItemId={setSelectedItemId}
          />
        </div>
      </div>
    </div>
  );
}

export default App;