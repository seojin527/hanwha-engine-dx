/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { DrawingLibrary } from "./components/DrawingLibrary";
import { DrawingViewer } from "./components/WorkerDrawingViewer";
import { MeasurementTable } from "./components/MeasurementTable";
import { MeasurementPanel } from "./components/MeasurementPanel";
import { MOCK_MEASUREMENT_POINTS } from "./data/mockData";
import { DEFAULT_INITIAL_RESULTS, STORAGE_KEYS } from "./lib/inspection";
import { apiUrl } from './lib/drawingAPI';
import { useDrawingOcr } from './hooks/useDrawingOcr';
import { toOcrPoints } from './lib/ocr';
import { OcrMeasurementTable } from './components/OcrMeasurementTable';
import { OcrDetailPanel } from './components/OcrDetailPanel';
import type { Drawing } from "./lib/drawingAPI";

import { ResizablePanels } from "./components/ResizablePanels";
import { AdminWorkspace } from "./components/AdminWorkspace";
import { loadMode, MODE_KEY } from "./lib/admin/adminStore";

const WORKER_DRAWING_KEY = 'hanwha_worker_drawing_id';
function savedDrawingId() {try {return localStorage.getItem(WORKER_DRAWING_KEY);} catch {return null;}}
export function App() {
  const [mode,setMode]=useState(loadMode);
  useEffect(()=>{try{localStorage.setItem(MODE_KEY,mode);}catch{}},[mode]);
  const [selectedPointId, setSelectedPointId] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState("p1-item");
  const [searchQuery, setSearchQuery] = useState("");

  const [demoMode, setDemoMode] = useState(() => !savedDrawingId());
  const [restoring, setRestoring] = useState(() => !!savedDrawingId());
  const [restoreError, setRestoreError] = useState('');
  const [selectedDrawing, setSelectedDrawing] =
    useState<Drawing | null>(null);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);

  useEffect(() => {
    const id=savedDrawingId(); if (!id) return;
    const controller=new AbortController();
    fetch(apiUrl('/api/drawings/'+encodeURIComponent(id)),{signal:controller.signal}).then(async response=>{
      if(!response.ok) throw new Error('이전 도면을 불러오지 못했습니다. 도면을 다시 선택해주세요.');
      const drawing=await response.json() as Drawing;
      if(!controller.signal.aborted){setSelectedDrawing(drawing);setDrawingUrl(apiUrl(drawing.file_url));setDemoMode(false);}
    }).catch(error=>{if(!controller.signal.aborted)setRestoreError(error.message);})
      .finally(()=>{if(!controller.signal.aborted)setRestoring(false);});
    return ()=>controller.abort();
  },[]);
  useEffect(()=>{if(selectedDrawing)try{localStorage.setItem(WORKER_DRAWING_KEY,selectedDrawing.drawing_id);}catch{}},[selectedDrawing?.drawing_id]);
  const [uploadRequest, setUploadRequest] = useState(0);
  const ocr = useDrawingOcr(demoMode ? null : selectedDrawing?.drawing_id || null);
  const document = ocr.snapshot?.result || null;
  const workerBlocked = demoMode || ocr.snapshot?.work_allowed !== true || ocr.status !== 'ready';
  const ocrPoints = document ? toOcrPoints(document) : [];
  const activeOcrPoint = ocrPoints.find((point) => point.id === selectedPointId) || ocrPoints[0];
  const filteredOcrPoints = ocrPoints.filter((point) => {
    const query = searchQuery.toLowerCase();
    return `${point.displayNumber} ${point.source.raw_text} ${point.feature.name} ${point.source.id}`.toLowerCase().includes(query);
  });
  const resultUrl = document && ocr.snapshot?.image_url ? apiUrl(ocr.snapshot.image_url) : drawingUrl;

  function navigateOcr(delta: number) {
    if (!ocrPoints.length) return;
    const index = ocrPoints.findIndex((point) => point.id === activeOcrPoint?.id);
    setSelectedPointId(ocrPoints[(index + delta + ocrPoints.length) % ocrPoints.length].id);
  }

  async function runSelectedOcr() {
    setSelectedPointId(1);
    await ocr.run();
  }

  // 기존 데모 검사 기록 유지
  const [inspectionRecords, setInspectionRecords] =
    useState<Record<number, any>>(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.RESULTS);
        if (saved) return JSON.parse(saved);
      } catch (error) {
        console.error(error);
      }
      return DEFAULT_INITIAL_RESULTS;
    });

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.RESULTS,
        JSON.stringify(inspectionRecords)
      );
    } catch (error) {
      console.error(error);
    }
  }, [inspectionRecords]);

  function selectPoint(id: number) {
    const point = MOCK_MEASUREMENT_POINTS.find(
      (entry) => (entry.id || entry.displayNumber) === id
    );

    setSelectedPointId(id);
    setSelectedItemId(point?.items?.[0]?.id || `p${id}-item`);
  }

  function handleResetData() {
    if (!window.confirm("데모 검사 기록을 초기화하시겠습니까?")) return;

    setInspectionRecords(DEFAULT_INITIAL_RESULTS);
    selectPoint(1);
  }

  const filteredPoints = MOCK_MEASUREMENT_POINTS.filter((point) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      (point.feature?.name || "").toLowerCase().includes(query) ||
      (point.dimension?.formatted || "").toLowerCase().includes(query) ||
      String(point.displayNumber).includes(query)
    );
  });

  const currentPoint =
    MOCK_MEASUREMENT_POINTS.find(
      (point) => (point.id || point.displayNumber) === selectedPointId
    ) || MOCK_MEASUREMENT_POINTS[0];

  function handleNavigatePoint(delta: number) {
    const total = MOCK_MEASUREMENT_POINTS.length;
    if (!total) return;

    const currentIndex = MOCK_MEASUREMENT_POINTS.findIndex(
      (point) => (point.id || point.displayNumber) === selectedPointId
    );

    const nextIndex = (currentIndex + delta + total) % total;
    const next = MOCK_MEASUREMENT_POINTS[nextIndex];
    selectPoint(next.id || next.displayNumber);
  }

  function handleSaveRecord(updatedRecord: any) {
    setInspectionRecords((previous) => ({
      ...previous,
      [selectedPointId]: updatedRecord,
    }));
  }

  if(restoring)return <div role="status" className="flex h-screen items-center justify-center bg-slate-950 text-cyan-200">도면 정보를 서버에서 불러오는 중…</div>;
  if(mode==="admin")return <AdminWorkspace initialDrawing={demoMode ? null : selectedDrawing}
    onSelection={drawing=>{setSelectedDrawing(drawing);setDrawingUrl(apiUrl(drawing.file_url));setDemoMode(false);}}
    onWorker={drawing=>{if(drawing){setSelectedDrawing(drawing);setDrawingUrl(apiUrl(drawing.file_url));setDemoMode(false);}setMode("worker");ocr.refresh();}} />;
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans">
      <Header onAdminMode={()=>setMode("admin")}
        displayInfo={demoMode ? undefined : { partName: document?.part_name || "등록 부품", drawingName: selectedDrawing?.original_filename || "선택 대기" }}
        onUploadDrawing={() => setUploadRequest((value) => value + 1)}
        onResetData={handleResetData}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <DrawingLibrary
        uploadRequest={uploadRequest}
        onSelectDrawing={(drawing, url) => {
          setSelectedPointId(1);
          setSelectedDrawing(drawing);
          setDrawingUrl(url);
          setDemoMode(false);
        }}
        onClearDrawing={() => {
          setSelectedDrawing(null);
          try {localStorage.removeItem(WORKER_DRAWING_KEY);} catch {}
          setDrawingUrl(null);
          setDemoMode(false);
        }}
      />

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-1.5 text-xs">
        <span className="min-w-0 truncate text-slate-300">
          {demoMode
            ? "데모 도면 · 샘플 측정항목"
            : selectedDrawing
            ? `${selectedDrawing.original_filename} · ${document ? `OCR 추출 ${ocrPoints.length}건` : ocr.status === "applying" ? "OCR 분석 중…" : "OCR 미실행"}`
            : "등록된 도면을 선택해주세요"}
        </span>

        {!demoMode && selectedDrawing && <button type="button" disabled={ocr.status === 'loading' || ocr.status === 'applying'}
          onClick={() => void runSelectedOcr()}
          className="shrink-0 rounded border border-cyan-700 bg-cyan-950 px-3 py-1 text-cyan-200 disabled:opacity-40">
          {ocr.status === 'applying' ? (ocr.stage || 'OCR 분석 중…') : document ? 'OCR 결과 다시 조회' : ocr.status === 'error' ? 'OCR 재시도' : 'OCR 실행'}
        </button>}
        {!demoMode && (
          <button
            type="button"
            onClick={() => setDemoMode(true)}
            className="shrink-0 text-cyan-300 hover:text-cyan-200"
          >
            데모 화면 보기
          </button>
        )}

        {demoMode && selectedDrawing && (
          <button
            type="button"
            onClick={() => setDemoMode(false)}
            className="shrink-0 text-cyan-300 hover:text-cyan-200"
          >
            선택한 등록 도면 보기
          </button>
        )}
      </div>

      {restoreError && <p role="alert" className="bg-rose-950 px-4 py-2 text-xs text-rose-200">{restoreError}</p>}
      {workerBlocked && <p role="status" className="shrink-0 border-b border-amber-800 bg-amber-950 px-4 py-2 text-xs text-amber-100">관리자 검수 대기 · 검수가 완료된 최신 도면만 측정·판정·오류 등록을 진행할 수 있습니다.</p>}
      {!demoMode && ocr.error && <p role="alert" className="shrink-0 bg-rose-950 px-4 py-2 text-xs text-rose-200">{ocr.error}</p>}
      {!demoMode && document?.image.coordinate_status === 'UNVERIFIED' && <p className="shrink-0 bg-amber-950 px-4 py-1 text-[11px] text-amber-200">좌표 기준 확인 필요: Frame offset 정보가 없어 입력 좌표를 그대로 표시합니다.</p>}
      <ResizablePanels left={<>
          <DrawingViewer
            key={
              demoMode
                ? "demo"
                : selectedDrawing?.drawing_id || "empty"
            }
            drawingUrl={
              demoMode ? "/images/1_image.png" : resultUrl
            }
            mediaType={
              demoMode ? "image/png" : document ? "image/jpeg" : selectedDrawing?.media_type
            }
            points={demoMode ? filteredPoints : filteredOcrPoints}
            coordinateSize={!demoMode && document ? { width: document.image.width_px, height: document.image.height_px } : undefined}
            selectedPointId={demoMode ? selectedPointId : activeOcrPoint?.id || 0}
            onSelectPoint={demoMode ? selectPoint : setSelectedPointId}
            inspectionRecords={demoMode && !workerBlocked ? inspectionRecords : {}}
            isAnalyzing={!demoMode && ocr.status === "applying"}
            analyzingStep={0}
            analyzingStage={ocr.stage}
          />

          {workerBlocked ? (
            <section className="space-y-4 p-5">
              <h2 className="text-base font-bold text-amber-900">관리자 검수 대기</h2>
              <p className="text-xs leading-relaxed text-slate-600">OCR 추출 후 관리자가 수정 내용을 저장하고 전체 항목을 확인해야 합니다. 서버에서 검수 완료를 확인한 후 측정·판정·오류 등록이 허용됩니다.</p>
              <button type="button" onClick={()=>setMode("admin")} className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white">관리자 모드로 전환</button>
            </section>
          ) : demoMode ? (
            <MeasurementTable
              points={filteredPoints}
              selectedPointId={selectedPointId}
              onSelectPoint={selectPoint}
              inspectionRecords={workerBlocked ? {} : inspectionRecords}
              selectedItemId={selectedItemId}
              onSelectItem={(pointId, itemId) => {
                setSelectedPointId(pointId);
                setSelectedItemId(itemId);
              }}
            />
          ) : document ? (
            <OcrMeasurementTable points={filteredOcrPoints} selectedId={activeOcrPoint?.id || 0}
              onSelect={setSelectedPointId} title={document.part_name || '도면'} />
          ) : (
            <section className="shrink-0 border-t border-slate-700 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold text-white">
                측정항목
              </h2>
              <p className="mt-2 text-xs text-slate-400">
                {selectedDrawing
                  ? (ocr.status === "applying" ? "OCR 분석 중…" : "원본 도면입니다. OCR 실행을 누르면 분석 후 번호와 측정항목이 표시됩니다.")
                  : "도면을 선택하거나 등록해주세요."}
              </p>
            </section>
          )}
        </>} right={<>
          {demoMode ? (
            <MeasurementPanel
              currentPoint={currentPoint}
              totalPointsCount={MOCK_MEASUREMENT_POINTS.length}
              onNavigatePoint={handleNavigatePoint}
              record={inspectionRecords[selectedPointId] || {}}
              onSaveRecord={handleSaveRecord}
              selectedItemId={selectedItemId}
              onSelectItemId={setSelectedItemId}
            />
          ) : document && selectedDrawing && ocr.snapshot?.revision ? (
            <>
              <OcrDetailPanel drawingId={selectedDrawing.drawing_id} revision={ocr.snapshot.revision}
                point={activeOcrPoint} total={ocrPoints.length} onNavigate={navigateOcr} />
            </>
          ) : (
            <section className="space-y-4 p-5">
              <h2 className="text-sm font-bold text-slate-900">
                도면 정보
              </h2>

              {selectedDrawing ? (
                <>
                  <div className="text-xs">
                    <p className="text-slate-500">파일명</p>
                    <p className="mt-1 break-all text-slate-900">
                      {selectedDrawing.original_filename}
                    </p>
                  </div>

                  <div className="text-xs">
                    <p className="text-slate-500">파일 크기</p>
                    <p className="mt-1 text-slate-900">
                      {(
                        selectedDrawing.size_bytes /
                        1024 /
                        1024
                      ).toFixed(2)}{" "}
                      MB
                    </p>
                  </div>

                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                    {ocr.status === "applying" ? "CPU OCR 분석 중입니다. 완료 후 측정항목을 표시하고 관련 오류·주의사항을 검색합니다." : "OCR 실행 대기 중입니다. 새 업로드는 자동 분석되며 기존 도면은 OCR 실행을 눌러주세요."}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  부품에서 도면을 선택해주세요.
                </p>
              )}
            </section>
          )}
        </>} />
    </div>
  );
}

export default App;
