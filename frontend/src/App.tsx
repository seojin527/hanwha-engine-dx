/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import { DrawingLibrary } from "./components/DrawingLibrary";
import { DrawingViewer } from "./components/DrawingViewer";
import { MeasurementTable } from "./components/MeasurementTable";
import { MeasurementPanel } from "./components/MeasurementPanel";
import {
  buildInspectionPoints,
  demoImageUrl,
  fetchDemoDrawing,
  fetchDemoIndex,
  fetchErrorCases,
  type DemoDrawingDoc,
  type DemoDrawingEntry,
  type ErrorCase,
} from "./lib/demoDrawings";
import { matchDrawingId, rasterizeUpload, UPLOAD_ACCEPT, validateUpload } from "./lib/localUpload";
import { apiUrl } from './lib/drawingAPI';
import { useDrawingOcr } from './hooks/useDrawingOcr';
import { toOcrPoints } from './lib/ocr';
import { OcrMeasurementTable } from './components/OcrMeasurementTable';
import { OcrDetailPanel } from './components/OcrDetailPanel';
import type { Drawing } from "./lib/drawingAPI";

const DEMO_DRAWING_KEY = "hanwha_demo_drawing_id";
const RECORDS_KEY = "hanwha_inspection_results_v4";

export function App() {
  const [selectedPointId, setSelectedPointId] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState("p1-item");
  const [searchQuery, setSearchQuery] = useState("");

  const [demoMode, setDemoMode] = useState(true);
  const [selectedDrawing, setSelectedDrawing] =
    useState<Drawing | null>(null);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);

  const [uploadRequest, setUploadRequest] = useState(0);

  // 화면 접기 상태: 아래 측정 항목 표 / 오른쪽 측정 패널
  const [tableCollapsed, setTableCollapsed] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const drawingFocused = tableCollapsed && !sidePanelOpen;

  // 도면 크게 보기: 표와 오른쪽 패널을 한 번에 접고, 다시 누르면 원래대로
  function toggleDrawingFocus() {
    if (drawingFocused) {
      setTableCollapsed(false);
      setSidePanelOpen(true);
    } else {
      setTableCollapsed(true);
      setSidePanelOpen(false);
    }
  }

  const viewerToolbarRight = (
    <>
      <button
        type="button"
        onClick={() => setSidePanelOpen((open) => !open)}
        className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
      >
        {sidePanelOpen ? "측정 패널 접기 ▶" : "◀ 측정 패널 펼치기"}
      </button>
      <button
        type="button"
        onClick={toggleDrawingFocus}
        aria-pressed={drawingFocused}
        className={`rounded px-2 py-1 font-semibold ${
          drawingFocused ? "bg-cyan-700 hover:bg-cyan-600" : "bg-slate-800 hover:bg-slate-700"
        }`}
      >
        {drawingFocused ? "↙ 원래 화면" : "⛶ 도면 크게 보기"}
      </button>
    </>
  );
  const ocr = useDrawingOcr(demoMode ? null : selectedDrawing?.drawing_id || null);
  const document = ocr.snapshot?.result || null;
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

  async function applyExtractedSample() {
    if (!selectedDrawing) return;
    if (!window.confirm(`선택한 「${selectedDrawing.original_filename}」에 1_image.png와 1_metadata.json을 연결합니다. 이 파일들이 선택한 도면의 추출 결과인지 확인해주세요.`)) return;
    setSelectedPointId(1);
    await ocr.applySample();
  }

  // ---------------------------------------------------------- 데모 도면
  // 도면을 고르면 그 도면의 추출 결과(치수·기하공차)로 측정 항목을 새로 만든다.
  const [demoIndex, setDemoIndex] = useState<DemoDrawingEntry[]>([]);
  const [demoDrawingId, setDemoDrawingId] = useState<string>(() => {
    try {
      return localStorage.getItem(DEMO_DRAWING_KEY) || "";
    } catch {
      return "";
    }
  });
  const [demoDoc, setDemoDoc] = useState<DemoDrawingDoc | null>(null);
  const [errorCases, setErrorCases] = useState<ErrorCase[]>([]);
  const [demoError, setDemoError] = useState("");

  // 업로드한 도면 (브라우저 메모리에만 보관, 새로고침하면 사라짐)
  const [uploads, setUploads] = useState<DemoDrawingEntry[]>([]);
  const [uploadNotice, setUploadNotice] = useState<{ tone: "info" | "ok" | "warn" | "error"; text: string } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const allEntries = useMemo(() => [...uploads, ...demoIndex], [uploads, demoIndex]);

  async function handleLocalUpload(file: File) {
    const invalid = validateUpload(file);
    if (invalid) {
      setUploadNotice({ tone: "error", text: invalid });
      return;
    }
    setUploadingFile(true);
    setUploadNotice({ tone: "info", text: `「${file.name}」 도면을 불러오는 중…` });
    try {
      const uploadId = `upload-${Date.now()}`;
      const linkedId = matchDrawingId(file.name, demoIndex);
      const linkedEntry = demoIndex.find((entry) => entry.id === linkedId);
      const base = linkedEntry ? await fetchDemoDrawing(linkedEntry) : null;
      const raster = await rasterizeUpload(
        file,
        base ? { width: base.image.width_px, height: base.image.height_px } : undefined
      );
      const linked = !!base && raster.fitted;
      const doc: DemoDrawingDoc = linked
        ? { ...base!, demo_id: uploadId, imageUrl: raster.url, linked_drawing_id: linkedId }
        : {
            demo_id: uploadId,
            part_name: file.name.replace(/\.[^.]+$/, ""),
            part_no: null,
            drawing_scale: null,
            image: { file: "", width_px: raster.width, height_px: raster.height },
            imageUrl: raster.url,
            linked_drawing_id: null,
            items: [],
          };
      setUploads((previous) => [
        {
          id: uploadId,
          label: `⬆ ${file.name}${linked ? ` · ${linkedId} 추출 결과 연결` : " · 추출 결과 없음"}`,
          part_name: doc.part_name,
          part_no: doc.part_no,
          scale: doc.drawing_scale,
          data: "",
          doc,
          uploaded: true,
        },
        ...previous,
      ]);
      setDemoDrawingId(uploadId);
      setDemoMode(true);
      setUploadNotice(
        linked
          ? { tone: "ok", text: `「${file.name}」 업로드 완료 · ${linkedId} 추출 결과(${doc.items.length}개 항목)를 연결했습니다.` }
          : base
          ? { tone: "warn", text: `「${file.name}」 업로드 완료 · ${linkedId}와 도면 비율이 달라 추출 결과를 연결하지 않았습니다.` }
          : { tone: "warn", text: `「${file.name}」 업로드 완료 · 이 도면의 추출 결과가 없습니다. 백엔드 OCR(eDOCr2)로 추출·검수하면 측정 항목이 생성됩니다.` }
      );
    } catch (error) {
      setUploadNotice({ tone: "error", text: `도면을 불러오지 못했습니다: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setUploadingFile(false);
    }
  }

  // 도면 목록 + 오류사례 DB 불러오기
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDemoIndex(), fetchErrorCases().catch(() => [] as ErrorCase[])])
      .then(([index, cases]) => {
        if (cancelled) return;
        setDemoIndex(index);
        setErrorCases(cases);
        setDemoDrawingId((current) =>
          index.some((entry) => entry.id === current) ? current : index[0]?.id || ""
        );
      })
      .catch((error) => !cancelled && setDemoError(String(error.message || error)));
    return () => {
      cancelled = true;
    };
  }, []);

  // 선택한 도면의 추출 데이터 불러오기
  useEffect(() => {
    const entry = allEntries.find((item) => item.id === demoDrawingId);
    if (!entry) return;
    let cancelled = false;
    setDemoDoc(null);
    setSelectedPointId(1);
    setSelectedItemId("");
    (entry.doc ? Promise.resolve(entry.doc) : fetchDemoDrawing(entry))
      .then((doc) => !cancelled && setDemoDoc(doc))
      .catch((error) => !cancelled && setDemoError(String(error.message || error)));
    try {
      if (!entry.uploaded) localStorage.setItem(DEMO_DRAWING_KEY, demoDrawingId);
    } catch {
      // 저장 불가 환경이면 무시
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoDrawingId, demoIndex, uploads.length]);

  const demoPoints = useMemo(
    () => (demoDoc ? buildInspectionPoints(demoDoc, errorCases) : []),
    [demoDoc, errorCases]
  );
  const demoCounts = {
    dims: demoPoints.filter((point) => point.feature.type !== "GD&T").length,
    gdt: demoPoints.filter((point) => point.feature.type === "GD&T").length,
  };

  // 검사 기록: 도면별로 따로 저장
  const [recordsByDrawing, setRecordsByDrawing] =
    useState<Record<string, Record<number, any>>>(() => {
      try {
        const saved = localStorage.getItem(RECORDS_KEY);
        if (saved) return JSON.parse(saved);
      } catch (error) {
        console.error(error);
      }
      return {};
    });
  const inspectionRecords = recordsByDrawing[demoDrawingId] || {};

  useEffect(() => {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(recordsByDrawing));
    } catch (error) {
      console.error(error);
    }
  }, [recordsByDrawing]);

  function selectPoint(id: number) {
    const point = demoPoints.find((entry) => entry.id === id);
    setSelectedPointId(id);
    setSelectedItemId(point?.items?.[0]?.id || "");
  }

  function handleResetData() {
    if (!window.confirm("현재 도면의 데모 검사 기록을 초기화하시겠습니까?")) return;
    setRecordsByDrawing((previous) => ({ ...previous, [demoDrawingId]: {} }));
    selectPoint(1);
  }

  const filteredPoints = demoPoints.filter((point) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      point.feature.name.toLowerCase().includes(query) ||
      point.dimension.formatted.toLowerCase().includes(query) ||
      String(point.displayNumber).includes(query)
    );
  });

  const currentPoint =
    demoPoints.find((point) => point.id === selectedPointId) || demoPoints[0];

  function handleNavigatePoint(delta: number) {
    const total = demoPoints.length;
    if (!total) return;
    const currentIndex = demoPoints.findIndex((point) => point.id === selectedPointId);
    selectPoint(demoPoints[(currentIndex + delta + total) % total].id);
  }

  function handleSaveRecord(updatedRecord: any) {
    setRecordsByDrawing((previous) => ({
      ...previous,
      [demoDrawingId]: { ...(previous[demoDrawingId] || {}), [selectedPointId]: updatedRecord },
    }));
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 font-sans">
      <Header
        displayInfo={
          demoMode
            ? {
                partName: demoDoc?.part_name || "도면 불러오는 중",
                drawingName: (() => {
                  const entry = allEntries.find((item) => item.id === demoDrawingId);
                  return entry?.uploaded ? demoDoc?.linked_drawing_id || demoDoc?.part_name || "업로드 도면" : entry?.id || "—";
                })(),
                partNo: demoDoc?.part_no,
                scale: demoDoc?.drawing_scale,
              }
            : { partName: document?.part_name || "등록 부품", drawingName: selectedDrawing?.original_filename || "선택 대기" }
        }
        onUploadDrawing={() => uploadInputRef.current?.click()}
        onResetData={handleResetData}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* 헤더 「도면 업로드」: PDF·PNG·JPG를 브라우저에서 바로 불러온다 */}
      <input
        ref={uploadInputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && !uploadingFile) void handleLocalUpload(file);
        }}
      />
      {uploadNotice && (
        <div
          role={uploadNotice.tone === "error" ? "alert" : "status"}
          className={`flex shrink-0 items-center justify-between gap-3 px-4 py-1.5 text-xs ${
            {
              info: "bg-cyan-950 text-cyan-200",
              ok: "bg-emerald-950 text-emerald-200",
              warn: "bg-amber-950 text-amber-200",
              error: "bg-rose-950 text-rose-200",
            }[uploadNotice.tone]
          }`}
        >
          <span>{uploadNotice.text}</span>
          <button type="button" onClick={() => setUploadNotice(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="알림 닫기">✕</button>
        </div>
      )}

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
          setDrawingUrl(null);
          setDemoMode(false);
        }}
      />

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-4 py-1.5 text-xs">
        <span className="min-w-0 truncate text-slate-300">
          {demoMode ? (
            <span className="flex items-center gap-2">
              <label htmlFor="demo-drawing" className="text-slate-400">데모 도면</label>
              <select
                id="demo-drawing"
                value={demoDrawingId}
                onChange={(event) => setDemoDrawingId(event.target.value)}
                className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
              >
                {allEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
              <span>
                {demoError
                  ? <span className="text-rose-300">{demoError}</span>
                  : demoDoc && !demoDoc.items.length
                  ? "추출 결과 없음 · 도면만 표시합니다"
                  : demoDoc
                  ? `측정항목 ${demoPoints.length}건 (치수 ${demoCounts.dims} · 기하공차 ${demoCounts.gdt}) · 도면 추출 결과에서 자동 생성`
                  : "도면 불러오는 중…"}
              </span>
            </span>
          ) : selectedDrawing
            ? `${selectedDrawing.original_filename} · ${document ? `OCR 추출 ${ocrPoints.length}건` : ocr.status === "applying" ? "OCR 결과 적용 중…" : "OCR 미실행"}`
            : "등록된 도면을 선택해주세요"}
        </span>

        {!demoMode && selectedDrawing && <button type="button" disabled={ocr.status === 'loading' || ocr.status === 'applying'}
          onClick={() => void applyExtractedSample()}
          className="shrink-0 rounded border border-cyan-700 bg-cyan-950 px-3 py-1 text-cyan-200 disabled:opacity-40">
          {ocr.status === 'applying' ? 'OCR 결과 적용 중…' : '추출 결과 적용 (1번 샘플)'}
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

      {!demoMode && ocr.error && <p role="alert" className="shrink-0 bg-rose-950 px-4 py-2 text-xs text-rose-200">{ocr.error}</p>}
      {!demoMode && document?.image.coordinate_status === 'UNVERIFIED' && <p className="shrink-0 bg-amber-950 px-4 py-1 text-[11px] text-amber-200">좌표 기준 확인 필요: Frame offset 정보가 없어 입력 좌표를 그대로 표시합니다.</p>}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-800">
          <DrawingViewer
            key={
              demoMode
                ? `demo-${demoDrawingId}`
                : selectedDrawing?.drawing_id || "empty"
            }
            drawingUrl={
              demoMode ? (demoDoc ? demoImageUrl(demoDoc) : null) : resultUrl
            }
            mediaType={
              demoMode || document ? "image/png" : selectedDrawing?.media_type
            }
            points={demoMode ? filteredPoints : filteredOcrPoints}
            coordinateSize={
              demoMode
                ? demoDoc ? { width: demoDoc.image.width_px, height: demoDoc.image.height_px } : undefined
                : document ? { width: document.image.width_px, height: document.image.height_px } : undefined
            }
            selectedPointId={demoMode ? selectedPointId : activeOcrPoint?.id || 0}
            onSelectPoint={demoMode ? selectPoint : setSelectedPointId}
            inspectionRecords={demoMode ? inspectionRecords : {}}
            isAnalyzing={!demoMode && ocr.status === "applying"}
            analyzingStep={0}
            toolbarRight={viewerToolbarRight}
          />

          {demoMode ? (
            <MeasurementTable
              collapsed={tableCollapsed}
              onToggleCollapsed={() => setTableCollapsed((value) => !value)}
              points={filteredPoints}
              selectedPointId={selectedPointId}
              onSelectPoint={selectPoint}
              inspectionRecords={inspectionRecords}
              selectedItemId={selectedItemId}
              onSelectItem={(pointId, itemId) => {
                setSelectedPointId(pointId);
                setSelectedItemId(itemId);
              }}
            />
          ) : document ? (
            <OcrMeasurementTable points={filteredOcrPoints} selectedId={activeOcrPoint?.id || 0}
              collapsed={tableCollapsed} onToggleCollapsed={() => setTableCollapsed((value) => !value)}
              onSelect={setSelectedPointId} title={document.part_name || '도면'} />
          ) : (
            <section className="shrink-0 border-t border-slate-700 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold text-white">
                측정항목
              </h2>
              <p className="mt-2 text-xs text-slate-400">
                {selectedDrawing
                  ? (ocr.status === "applying" ? "OCR 추출 결과 적용 중…" : "원본 도면입니다. 추출 결과를 적용하면 번호와 측정항목이 표시됩니다.")
                  : "도면을 선택하거나 등록해주세요."}
              </p>
            </section>
          )}
        </div>

        {!sidePanelOpen && (
          // 오른쪽 측정 패널을 접었을 때 남는 얇은 띠: 누르면 다시 펼침
          <button
            type="button"
            onClick={() => setSidePanelOpen(true)}
            aria-label="측정 패널 펼치기"
            className="flex w-9 shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white py-4 text-xs font-bold text-slate-600 shadow-xl hover:bg-slate-50 hover:text-slate-900"
          >
            <span>◀</span>
            <span className="[writing-mode:vertical-rl]">측정 패널 펼치기</span>
          </button>
        )}

        <div className={`${sidePanelOpen ? "flex" : "hidden"} w-[39.5%] min-w-[420px] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl`}>
          {demoMode ? (
            <MeasurementPanel
              currentPoint={currentPoint}
              totalPointsCount={demoPoints.length}
              onNavigatePoint={handleNavigatePoint}
              record={inspectionRecords[selectedPointId] || {}}
              onSaveRecord={handleSaveRecord}
              selectedItemId={selectedItemId}
              onSelectItemId={setSelectedItemId}
            />
          ) : document && selectedDrawing && ocr.snapshot?.revision ? (
            <OcrDetailPanel drawingId={selectedDrawing.drawing_id} revision={ocr.snapshot.revision}
              point={activeOcrPoint} total={ocrPoints.length} onNavigate={navigateOcr} />
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
                    {ocr.status === "applying" ? "측정항목 추출 결과를 준비하고 있습니다. 완료 후 관련 오류·주의사항을 검색합니다." : "추출 결과 적용 대기 중입니다. 결과 적용 후 선택한 항목의 관련 오류·주의사항을 검색합니다."}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  부품에서 도면을 선택해주세요.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;