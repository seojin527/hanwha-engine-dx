import { useEffect, useState } from "react";
import { ArrowRight, FileText, Loader2, LogOut, PlayCircle, RotateCw, Ruler } from "lucide-react";
import { fetchDrawings, fetchParts, type Drawing, type Part } from "../../lib/drawingAPI";

interface DrawingSelectScreenProps {
  /** 헤더에 보여줄 이름 (시연용 계정 이름) */
  userLabel: string;
  /** 처음 선택해 둘 부품·도면 (작업 화면에서 돌아올 때 현재 선택) */
  initialPartId?: string;
  initialDrawingId?: string;
  /** 선택한 도면으로 작업 화면에 들어간다. */
  onStart: (drawing: Drawing) => void;
  /** 도면 없이 관리자 화면을 열어 부품·도면을 등록한다. 관리자만 넘긴다 (없으면 등록 버튼을 숨긴다). */
  onRegister?: (partId: string) => void;
  onDemo: () => void;
  onExit: () => void;
}

const OCR_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  not_started: { label: "OCR 미실행", className: "bg-neutral-700 text-neutral-300" },
  queued: { label: "OCR 대기", className: "bg-neutral-700 text-neutral-200" },
  running: { label: "OCR 진행 중", className: "bg-cyan-400/10 text-cyan-300" },
  completed: { label: "OCR 완료", className: "bg-emerald-400/10 text-emerald-300" },
  failed: { label: "OCR 실패", className: "bg-rose-400/10 text-rose-300" },
};

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatType(mediaType: string) {
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType.startsWith("image/")) return mediaType.slice(6).toUpperCase();
  return mediaType || "—";
}

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export function DrawingSelectScreen({
  userLabel,
  initialPartId = "",
  initialDrawingId = "",
  onStart,
  onRegister,
  onDemo,
  onExit,
}: DrawingSelectScreenProps) {
  const [parts, setParts] = useState<Load<Part[]>>({ status: "loading" });
  const [partsRetry, setPartsRetry] = useState(0);
  const [partId, setPartId] = useState(initialPartId);
  const [drawings, setDrawings] = useState<Load<Drawing[]> & { partId: string }>({ status: "loading", partId: "" });
  const [drawingsRetry, setDrawingsRetry] = useState(0);
  const [drawingId, setDrawingId] = useState(initialPartId ? initialDrawingId : "");

  useEffect(() => {
    const controller = new AbortController();
    setParts({ status: "loading" });
    fetchParts(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setParts({ status: "ready", data: data.parts });
        // 이전에 고른 부품이 지워졌으면 선택을 비운다.
        setPartId((current) => (data.parts.some((part) => part.part_id === current) ? current : ""));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setParts({ status: "error", message: cause instanceof Error ? cause.message : "부품 조회 실패" });
        }
      });
    return () => controller.abort();
  }, [partsRetry]);

  useEffect(() => {
    if (!partId) return;
    const controller = new AbortController();
    setDrawings({ status: "loading", partId });
    fetchDrawings(partId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setDrawings({ status: "ready", data: data.drawings, partId });
        setDrawingId((current) => (data.drawings.some((drawing) => drawing.drawing_id === current) ? current : ""));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setDrawings({ status: "error", message: cause instanceof Error ? cause.message : "도면 조회 실패", partId });
        }
      });
    return () => controller.abort();
  }, [partId, drawingsRetry]);

  const partList = parts.status === "ready" ? parts.data : [];
  const selectedPart = partList.find((part) => part.part_id === partId);
  // 부품을 바꾼 직후 이전 부품의 목록이 보이지 않게 한다.
  const drawingState: Load<Drawing[]> = drawings.partId === partId ? drawings : { status: "loading" };
  const drawingList = drawingState.status === "ready" ? drawingState.data : [];
  const selectedDrawing = drawingList.find((drawing) => drawing.drawing_id === drawingId);

  function selectPart(next: string) {
    if (next === partId) return;
    setPartId(next);
    setDrawingId("");
  }

  return (
    <div className="entry-gray flex h-screen break-keep w-screen flex-col overflow-hidden">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-950 px-4 text-white">
        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded bg-cyan-700 text-white">
          <Ruler className="h-3.5 w-3.5" />
        </span>
        <h1 className="-ml-2 whitespace-nowrap text-[13px] font-semibold tracking-tight">도면 측정 가이드</h1>
        <span className="hidden text-[11px] text-slate-500 sm:inline">엔진 부품 품질검사</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="max-w-[160px] truncate text-xs text-slate-200">{userLabel}</span>
          <span className="tag bg-slate-800 text-slate-300">시연</span>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-slate-800" />
          <button type="button" onClick={onExit} className="btn btn-dark-ghost">
            <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
            처음 화면
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:overflow-hidden lg:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">부품·도면 선택</h2>
            <p className="mt-0.5 text-xs text-neutral-400">부품을 고른 뒤 작업할 도면을 선택하고 「작업 시작」을 눌러주세요.</p>
          </div>
          <button type="button" onClick={onDemo} className="btn btn-ghost">
            <PlayCircle aria-hidden="true" className="h-3.5 w-3.5" />
            데모 도면으로 보기
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(220px,300px)_1fr]">
          {/* 부품 */}
          <section aria-labelledby="select-parts-title" className="card flex min-h-[200px] flex-col overflow-hidden bg-[#2e2e2e] md:min-h-0">
            <header className="card-header">
              <h3 id="select-parts-title" className="text-xs font-semibold text-white">부품</h3>
              {parts.status === "ready" && <span className="text-[11px] text-neutral-400">{partList.length}개</span>}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {parts.status === "loading" ? (
                <p role="status" className="flex items-center gap-2 p-3 text-xs text-neutral-400">
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                  부품을 불러오는 중…
                </p>
              ) : parts.status === "error" ? (
                <div role="alert" className="space-y-2 p-3">
                  <p className="note note-error whitespace-pre-wrap">부품 조회 실패: {parts.message}</p>
                  <button type="button" onClick={() => setPartsRetry((v) => v + 1)} className="btn btn-secondary">
                    <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
                    다시 조회
                  </button>
                </div>
              ) : partList.length === 0 ? (
                <div className="space-y-2 p-3 text-xs text-neutral-300">
                  <p>등록된 부품이 없습니다.</p>
                  {onRegister ? (
                    <button type="button" onClick={() => onRegister("")} className="btn btn-secondary">
                      관리자 화면에서 부품 등록
                    </button>
                  ) : (
                    <p className="text-neutral-400">관리자에게 부품·도면 등록을 요청하세요.</p>
                  )}
                </div>
              ) : (
                <ul aria-label="부품 목록">
                  {partList.map((part) => {
                    const active = part.part_id === partId;
                    return (
                      <li key={part.part_id} className="border-b border-neutral-700 last:border-b-0">
                        <button
                          type="button"
                          aria-current={active || undefined}
                          onClick={() => selectPart(part.part_id)}
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs ${
                            active ? "bg-cyan-400/10 shadow-[inset_3px_0_0_var(--color-cyan-400)]" : "hover:bg-white/5"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate ${active ? "font-semibold text-white" : "text-neutral-100"}`}>
                              {part.name}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-neutral-400">등록 {part.created_at || "—"}</span>
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">도면 {part.drawing_count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* 도면 */}
          <section aria-labelledby="select-drawings-title" className="card flex min-h-[280px] flex-col overflow-hidden bg-[#2e2e2e] md:min-h-0">
            <header className="card-header">
              <h3 id="select-drawings-title" className="min-w-0 truncate text-xs font-semibold text-white">
                {selectedPart ? `${selectedPart.name} 도면` : "도면"}
              </h3>
              {selectedPart && drawingState.status === "ready" && (
                <span className="text-[11px] text-neutral-400">{drawingList.length}개</span>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              {!selectedPart ? (
                <p className="p-6 text-center text-xs text-neutral-400">
                  {parts.status === "ready" && partList.length ? "왼쪽에서 부품을 선택해주세요." : ""}
                </p>
              ) : drawingState.status === "loading" ? (
                <p role="status" className="flex items-center gap-2 p-3 text-xs text-neutral-400">
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                  도면을 불러오는 중…
                </p>
              ) : drawingState.status === "error" ? (
                <div role="alert" className="space-y-2 p-3">
                  <p className="note note-error whitespace-pre-wrap">도면 조회 실패: {drawingState.message}</p>
                  <button type="button" onClick={() => setDrawingsRetry((v) => v + 1)} className="btn btn-secondary">
                    <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
                    다시 조회
                  </button>
                </div>
              ) : drawingList.length === 0 ? (
                <div className="space-y-2 p-3 text-xs text-neutral-300">
                  <p>이 부품에 등록된 도면이 없습니다.</p>
                  {onRegister ? (
                    <button type="button" onClick={() => onRegister(partId)} className="btn btn-secondary">
                      관리자 화면에서 도면 등록
                    </button>
                  ) : (
                    <p className="text-neutral-400">관리자에게 도면 등록을 요청하세요.</p>
                  )}
                </div>
              ) : (
                <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#2e2e2e] text-[11px] text-neutral-400">
                    <tr className="[&>th]:border-b [&>th]:border-neutral-700 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
                      <th scope="col">도면</th>
                      <th scope="col" className="w-16">형식</th>
                      <th scope="col" className="w-20 text-right">크기</th>
                      <th scope="col" className="w-24">OCR</th>
                      <th scope="col" className="w-40 whitespace-nowrap">등록일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawingList.map((drawing) => {
                      const active = drawing.drawing_id === drawingId;
                      const ocr = OCR_STATUS_LABEL[drawing.ocr_status] ?? {
                        label: drawing.ocr_status || "—",
                        className: "bg-neutral-700 text-neutral-300",
                      };
                      return (
                        <tr
                          key={drawing.drawing_id}
                          tabIndex={0}
                          aria-selected={active}
                          onClick={() => setDrawingId(drawing.drawing_id)}
                          onDoubleClick={() => onStart(drawing)}
                          onKeyDown={(event) => {
                            if (event.key === " ") {
                              event.preventDefault();
                              setDrawingId(drawing.drawing_id);
                            } else if (event.key === "Enter") {
                              event.preventDefault();
                              if (active) onStart(drawing);
                              else setDrawingId(drawing.drawing_id);
                            }
                          }}
                          className={`cursor-pointer outline-none [&>td]:border-b [&>td]:border-neutral-700 [&>td]:px-3 [&>td]:py-2 focus-visible:[&>td]:bg-neutral-700 ${
                            active
                              ? "[&>td]:bg-cyan-400/10 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-cyan-400)]"
                              : "hover:[&>td]:bg-white/5"
                          }`}
                        >
                          <td>
                            <span className="flex min-w-0 items-center gap-2">
                              <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                              <span className="min-w-0">
                                <span className={`block truncate ${active ? "font-semibold text-white" : "text-neutral-100"}`}>
                                  {drawing.original_filename || drawing.name}
                                </span>
                                <span className="block font-mono text-[11px] text-neutral-500">{drawing.drawing_id.slice(0, 8)}</span>
                              </span>
                            </span>
                          </td>
                          <td className="text-neutral-300">{formatType(drawing.media_type)}</td>
                          <td className="text-right tabular-nums text-neutral-300">{formatSize(drawing.size_bytes)}</td>
                          <td>
                            <span className={`tag ${ocr.className}`}>{ocr.label}</span>
                          </td>
                          <td className="whitespace-nowrap tabular-nums text-neutral-300">{drawing.created_at || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-700 bg-neutral-900/30 px-3 py-2">
              <p className="min-w-0 truncate text-xs text-neutral-300">
                {selectedDrawing ? (
                  <>
                    선택: <b className="font-semibold text-white">{selectedDrawing.original_filename || selectedDrawing.name}</b>
                  </>
                ) : (
                  "도면을 선택해주세요."
                )}
              </p>
              <button
                type="button"
                disabled={!selectedDrawing}
                onClick={() => selectedDrawing && onStart(selectedDrawing)}
                className="btn btn-primary btn-lg"
              >
                작업 시작
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </footer>
          </section>
        </div>
      </main>
    </div>
  );
}
