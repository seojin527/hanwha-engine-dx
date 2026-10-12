/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Header } from "./components/Header";
import { DrawingViewer } from "./components/DrawingViewer";
import { MeasurementTable } from "./components/MeasurementTable";
import { MeasurementPanel } from "./components/MeasurementPanel";
import {
  MOCK_MEASUREMENT_POINTS,
} from "./data/mockData";
import {
  PointInspectionRecord,
  DEFAULT_INITIAL_RESULTS,
  STORAGE_KEYS,
} from "./lib/inspection";

export default function App() {
  // 1. Selected Point ID state (persisted)
  const [selectedPointId, setSelectedPointId] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_ID);
      if (saved) {
        const id = parseInt(saved, 10);
        if (id >= 1 && id <= 5) return id;
      }
    } catch {
      // ignore
    }
    return 2; // Default to point 2 as in prompt description
  });

  // 2. Selected Item ID state
  const [selectedItemId, setSelectedItemId] = useState<string>(() => {
    const point = MOCK_MEASUREMENT_POINTS.find((p) => p.id === 2);
    return point?.items[0]?.id || "p2-mount";
  });

  // Ensure selectedItemId always belongs to selectedPointId
  useEffect(() => {
    const currentPoint = MOCK_MEASUREMENT_POINTS.find((p) => p.id === selectedPointId);
    if (currentPoint && !currentPoint.items.some((it) => it.id === selectedItemId)) {
      setSelectedItemId(currentPoint.items[0]?.id || "");
    }
  }, [selectedPointId, selectedItemId]);

  // 3. Inspection Records State (persisted per item & point)
  const [inspectionRecords, setInspectionRecords] = useState<
    Record<number, PointInspectionRecord>
  >(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RESULTS);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return DEFAULT_INITIAL_RESULTS;
  });

  // 4. Search Filter Query
  const [searchQuery, setSearchQuery] = useState("");

  // 5. Mock AI Drawing Upload & Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingStep, setAnalyzingStep] = useState(0);

  // Sync selectedPointId to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_ID, selectedPointId.toString());
    } catch {
      // ignore
    }
  }, [selectedPointId]);

  // Sync inspectionRecords to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.RESULTS, JSON.stringify(inspectionRecords));
    } catch {
      // ignore
    }
  }, [inspectionRecords]);

  // Handle Point Navigation (Prev / Next)
  const handleNavigatePoint = useCallback(
    (delta: number) => {
      const total = MOCK_MEASUREMENT_POINTS.length;
      let nextId = selectedPointId + delta;
      if (nextId < 1) nextId = total;
      if (nextId > total) nextId = 1;
      setSelectedPointId(nextId);
      const nextPoint = MOCK_MEASUREMENT_POINTS.find((p) => p.id === nextId);
      if (nextPoint && nextPoint.items.length > 0) {
        setSelectedItemId(nextPoint.items[0].id);
      }
    },
    [selectedPointId]
  );

  // Handle Select Point and Item together
  const handleSelectPoint = useCallback((pointId: number) => {
    setSelectedPointId(pointId);
    const pt = MOCK_MEASUREMENT_POINTS.find((p) => p.id === pointId);
    if (pt && !pt.items.some((it) => it.id === selectedItemId)) {
      setSelectedItemId(pt.items[0]?.id || "");
    }
  }, [selectedItemId]);

  const handleSelectItemFromTable = useCallback((pointId: number, itemId: string) => {
    setSelectedPointId(pointId);
    setSelectedItemId(itemId);
  }, []);

  // Handle Save / Update Point Record
  const handleSaveRecord = useCallback(
    (updated: PointInspectionRecord) => {
      setInspectionRecords((prev) => ({
        ...prev,
        [updated.pointId]: updated,
      }));
    },
    []
  );

  // Handle Reset Demo Data
  const handleResetData = useCallback(() => {
    if (window.confirm("측정값과 진행 상태를 초기 데모 상태로 재설정하시겠습니까?")) {
      setInspectionRecords(DEFAULT_INITIAL_RESULTS);
      setSelectedPointId(2);
      setSelectedItemId("p2-dia");
      try {
        localStorage.removeItem(STORAGE_KEYS.RESULTS);
        localStorage.removeItem(STORAGE_KEYS.SELECTED_ID);
      } catch {
        // ignore
      }
    }
  }, []);

  // Handle Mock Drawing Upload & 4-Step Analysis
  const handleUploadDrawing = useCallback((_fileName: string) => {
    setIsAnalyzing(true);
    setAnalyzingStep(0);

    const stepIntervals = [
      setTimeout(() => setAnalyzingStep(1), 700),
      setTimeout(() => setAnalyzingStep(2), 1500),
      setTimeout(() => setAnalyzingStep(3), 2300),
      setTimeout(() => {
        setIsAnalyzing(false);
        setSelectedPointId(1);
        setSelectedItemId("p1-dia");
      }, 3100),
    ];

    return () => {
      stepIntervals.forEach(clearTimeout);
    };
  }, []);

  // Filtered points by search query (if user typed something)
  const displayPoints = useMemo(() => {
    if (!searchQuery.trim()) return MOCK_MEASUREMENT_POINTS;
    const q = searchQuery.toLowerCase().trim();
    return MOCK_MEASUREMENT_POINTS.filter((p) => {
      return (
        p.displayNumber.toString().includes(q) ||
        p.feature.name.toLowerCase().includes(q) ||
        p.feature.type.toLowerCase().includes(q) ||
        p.dimension.formatted.toLowerCase().includes(q) ||
        p.items.some((it) => it.name.toLowerCase().includes(q) || it.fullName.toLowerCase().includes(q))
      );
    });
  }, [searchQuery]);

  const currentPoint =
    MOCK_MEASUREMENT_POINTS.find((p) => p.id === selectedPointId) ||
    MOCK_MEASUREMENT_POINTS[0];

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-slate-100 text-slate-800">
      {/* 1. Header (64px) */}
      <Header
        onUploadDrawing={handleUploadDrawing}
        onResetData={handleResetData}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* 2. Main Workspace (60% Left Workspace : 40% Right Detail Panel) */}
      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden min-h-0">
        {/* Left Column: 60% Width on >=1440px / xl */}
        <div className="w-full xl:w-[60%] flex flex-col min-w-0 h-full overflow-hidden border-b xl:border-b-0">
          {/* Drawing Viewer (Upper ~65-70%) */}
          <DrawingViewer
            points={displayPoints}
            selectedPointId={selectedPointId}
            onSelectPoint={handleSelectPoint}
            inspectionRecords={inspectionRecords}
            isAnalyzing={isAnalyzing}
            analyzingStep={analyzingStep}
          />

          {/* Measurement Table (Lower ~30-35%) */}
          <MeasurementTable
            points={displayPoints}
            selectedPointId={selectedPointId}
            onSelectPoint={handleSelectPoint}
            inspectionRecords={inspectionRecords}
            selectedItemId={selectedItemId}
            onSelectItem={handleSelectItemFromTable}
          />
        </div>

        {/* Right Column: 40% Width on >=1440px / xl with independent scroll */}
        <div className="w-full xl:w-[40%] flex flex-col min-w-0 h-full overflow-hidden border-l border-slate-300 bg-white">
          <MeasurementPanel
            currentPoint={currentPoint}
            totalPointsCount={MOCK_MEASUREMENT_POINTS.length}
            onNavigatePoint={handleNavigatePoint}
            record={inspectionRecords[currentPoint.id]}
            onSaveRecord={handleSaveRecord}
            selectedItemId={selectedItemId}
            onSelectItemId={setSelectedItemId}
          />
        </div>
      </div>
    </div>
  );
}
