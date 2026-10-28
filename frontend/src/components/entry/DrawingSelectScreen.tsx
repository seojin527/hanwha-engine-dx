import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowRight, Database, FileText, LayoutGrid, List, Loader2, LogOut, PlayCircle, Plus, RotateCw, Ruler, Trash2 } from "lucide-react";
import { fetchDrawings, fetchParts, type Drawing, type Part } from "../../lib/drawingAPI";
import { ENGINE_PART_LABEL, type EnginePartKey } from "../../lib/engineParts";
import { DeleteDrawingDialog, DrawingMenu, DrawingPreview, DrawingThumb, StatusBadges, formatSize, formatType } from "../drawings/DrawingParts";
import { RegisterDrawingPanel } from "../shell/RegisterDrawingPanel";

/** 관리자 메뉴: ① 부품·도면 관리(기존 화면) ② 오류 DB 관리 ③ 작업 진행 현황 */
export type AdminView = "drawings" | "errors" | "progress";

const ADMIN_MENU: { view: AdminView; label: string; icon: typeof Database }[] = [
  { view: "drawings", label: "부품·도면 관리", icon: FileText },
  { view: "errors", label: "오류 DB 관리", icon: Database },
  { view: "progress", label: "작업 진행 현황", icon: Activity },
];

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
  /** 관리자만: 메뉴 탭. 없으면(작업자) 기존 선택 화면만 보인다. */
  adminMenu?: { view: AdminView; onChange: (view: AdminView) => void };
  /** 관리자 메뉴 ②·③ 의 본문. 부품·도면 선택 상태는 이 화면이 그대로 들고 있어 메뉴를 바꿔도 유지된다. */
  adminContent?: ReactNode;
  /** 선택한 부품·도면이 바뀔 때 (관리자 작업 현황에서 같은 대상을 쓴다) */
  onSelectionChange?: (partId: string, drawing: Drawing | null) => void;
  /** ENGINE DX 셸 안에 넣을 때: 자체 머리글(이름·처음 화면)을 숨긴다. 셸의 상단 바가 같은 정보를 보여준다. */
  embedded?: boolean;
  /** 관리자: 선택한 부품에 도면 추가 · 도면 ⋯ 메뉴 삭제 (서버도 관리자 요청만 허용한다) */
  canManage?: boolean;
}

type ListView = "list" | "grid";
const VIEW_KEY = "dx.drawing-list-view";

function savedView(): ListView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

/** 관리자 도면 추가: 기존 등록 패널을 대화상자로 연다. */
function AddDrawingDialog({ part, onClose, onUploaded }: { part: Part; onClose: () => void; onUploaded: (drawing: Drawing) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog
      ref={dialog}
      aria-label="도면 추가"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto w-[min(440px,92vw)] rounded-md border border-dx-line-strong bg-dx-panel p-0 text-dx-text shadow-2xl backdrop:bg-black/60"
    >
      <RegisterDrawingPanel
        engineName={part.engine_part_key ? ENGINE_PART_LABEL[part.engine_part_key as EnginePartKey] ?? null : null}
        part={part}
        onClose={onClose}
        onUploaded={onUploaded}
      />
    </dialog>
  );
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
  adminMenu,
  embedded = false,
  adminContent,
  onSelectionChange,
  canManage = false,
}: DrawingSelectScreenProps) {
  const [parts, setParts] = useState<Load<Part[]>>({ status: "loading" });
  const [partsRetry, setPartsRetry] = useState(0);
  const [partId, setPartId] = useState(initialPartId);
  const [drawings, setDrawings] = useState<Load<Drawing[]> & { partId: string }>({ status: "loading", partId: "" });
  const [drawingsRetry, setDrawingsRetry] = useState(0);
  const [drawingId, setDrawingId] = useState(initialPartId ? initialDrawingId : "");
  const [listView, setListView] = useState<ListView>(savedView);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Drawing | null>(null);
  const [notice, setNotice] = useState("");

  function changeView(next: ListView) {
    setListView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // 저장할 수 없으면 이번 방문에서만 유지
    }
  }

  /** 추가·삭제 뒤: 부품 개수와 도면 목록을 서버 기준으로 다시 불러온다. */
  function refreshAfterChange(selectId: string) {
    setDrawingId(selectId);
    setPartsRetry((value) => value + 1);
    setDrawingsRetry((value) => value + 1);
  }

  function menuFor(drawing: Drawing) {
    return canManage
      ? [{ label: "삭제", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onSelect: () => setDeleteTarget(drawing) }]
      : [];
  }

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

  // 목록을 불러오는 동안에는 알리지 않는다 (이전 선택을 비우지 않도록).
  const selectionReady = !drawingId || drawingState.status === "ready";
  useEffect(() => {
    if (selectionReady) onSelectionChange?.(partId, selectedDrawing ?? null);
  }, [partId, selectedDrawing?.drawing_id, selectionReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const view: AdminView = adminMenu?.view ?? "drawings";

  function selectPart(next: string) {
    if (next === partId) return;
    setPartId(next);
    setDrawingId("");
  }

  return (
    <div className={`entry-gray flex break-keep flex-col overflow-hidden ${embedded ? "min-h-0 min-w-0 flex-1" : "h-screen w-screen"}`}>
      {!embedded && <header className="flex h-11 shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-950 px-4 text-white">
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
      </header>}

      {adminMenu && (
        <nav aria-label="관리자 메뉴" className="flex shrink-0 items-center gap-3 border-b border-neutral-700 bg-neutral-900/40 px-4 lg:px-6">
          {ADMIN_MENU.map(({ view: key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-current={view === key ? "page" : undefined}
              onClick={() => adminMenu.onChange(key)}
              className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-1 text-xs font-medium ${
                view === key ? "border-cyan-400 text-white" : "border-transparent text-neutral-400 hover:text-neutral-100"
              }`}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          {selectedPart && (
            <span className="ml-auto hidden min-w-0 truncate text-[11px] text-neutral-400 sm:block">
              선택: {selectedPart.name}{selectedDrawing ? ` · ${selectedDrawing.original_filename || selectedDrawing.name}` : ""}
            </span>
          )}
        </nav>
      )}

      {view !== "drawings" ? (
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 lg:p-6">{adminContent}</main>
      ) : (
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

          {/* 도면: 목록 / 썸네일 보기 + 미리보기 */}
          <section aria-labelledby="select-drawings-title" className="card flex min-h-[280px] flex-col overflow-hidden bg-[#2e2e2e] md:min-h-0">
            <header className="card-header flex-wrap gap-2">
              <h3 id="select-drawings-title" className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
                {selectedPart ? `${selectedPart.name} 도면` : "도면"}
                {selectedPart && drawingState.status === "ready" && <span className="ml-1.5 font-normal text-neutral-400">{drawingList.length}개</span>}
              </h3>
              {canManage && selectedPart && (
                <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary h-7">
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  도면 추가
                </button>
              )}
              <span role="group" aria-label="보기 방식" className="inline-flex overflow-hidden rounded border border-neutral-600">
                <button type="button" aria-pressed={listView === "list"} title="목록 보기" onClick={() => changeView("list")}
                  className={`inline-flex h-7 items-center gap-1 px-2 text-[11px] ${listView === "list" ? "bg-cyan-400/15 text-white" : "text-neutral-400 hover:text-white"}`}>
                  <List aria-hidden="true" className="h-3.5 w-3.5" />목록
                </button>
                <button type="button" aria-pressed={listView === "grid"} title="썸네일 보기" onClick={() => changeView("grid")}
                  className={`inline-flex h-7 items-center gap-1 border-l border-neutral-600 px-2 text-[11px] ${listView === "grid" ? "bg-cyan-400/15 text-white" : "text-neutral-400 hover:text-white"}`}>
                  <LayoutGrid aria-hidden="true" className="h-3.5 w-3.5" />썸네일
                </button>
              </span>
            </header>
            {notice && <p role="status" className="border-b border-neutral-700 bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-200">{notice}</p>}

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-rows-1">
              <div className="min-h-0 overflow-auto">
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
                    {canManage ? (
                      <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary">
                        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                        도면 추가
                      </button>
                    ) : (
                      <p className="text-neutral-400">관리자에게 도면 등록을 요청하세요.</p>
                    )}
                  </div>
                ) : listView === "list" ? (
                  <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-[#2e2e2e] text-[11px] text-neutral-400">
                      <tr className="[&>th]:border-b [&>th]:border-neutral-700 [&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
                        <th scope="col">도면</th>
                        <th scope="col" className="w-14">형식</th>
                        <th scope="col" className="w-20 text-right">크기</th>
                        <th scope="col" className="w-36 whitespace-nowrap">등록일</th>
                        <th scope="col" className="w-40">상태</th>
                        {canManage && <th scope="col" className="w-10"><span className="sr-only">메뉴</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {drawingList.map((drawing) => {
                        const active = drawing.drawing_id === drawingId;
                        const name = drawing.original_filename || drawing.name;
                        return (
                          <tr
                            key={drawing.drawing_id}
                            tabIndex={0}
                            aria-selected={active}
                            title="한 번 클릭: 선택·미리보기 · 두 번 클릭: 작업 시작"
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
                                  <span className={`block truncate ${active ? "font-semibold text-white" : "text-neutral-100"}`}>{name}</span>
                                  <span className="block font-mono text-[11px] text-neutral-500">{drawing.drawing_id.slice(0, 8)}</span>
                                </span>
                              </span>
                            </td>
                            <td className="text-neutral-300">{formatType(drawing.media_type)}</td>
                            <td className="text-right tabular-nums text-neutral-300">{formatSize(drawing.size_bytes)}</td>
                            <td className="whitespace-nowrap tabular-nums text-neutral-300">{drawing.created_at || "—"}</td>
                            <td><StatusBadges drawing={drawing} /></td>
                            {canManage && <td><DrawingMenu label={name} items={menuFor(drawing)} /></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <ul aria-label="도면 썸네일" className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-3">
                    {drawingList.map((drawing) => {
                      const active = drawing.drawing_id === drawingId;
                      const name = drawing.original_filename || drawing.name;
                      return (
                        <li key={drawing.drawing_id}>
                          <div
                            role="button"
                            tabIndex={0}
                            aria-pressed={active}
                            title="한 번 클릭: 선택·미리보기 · 두 번 클릭: 작업 시작"
                            onClick={() => setDrawingId(drawing.drawing_id)}
                            onDoubleClick={() => onStart(drawing)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                if (active) onStart(drawing);
                                else setDrawingId(drawing.drawing_id);
                              }
                            }}
                            className={`flex h-full cursor-pointer flex-col gap-1.5 rounded border p-1.5 text-xs outline-none focus-visible:border-cyan-400 ${
                              active ? "border-cyan-400 bg-cyan-400/10" : "border-neutral-700 hover:border-neutral-500"
                            }`}
                          >
                            <DrawingThumb drawing={drawing} className="aspect-[1.414] w-full rounded-sm" />
                            <span className="flex items-start gap-1">
                              <span className={`min-w-0 flex-1 break-all leading-snug ${active ? "font-semibold text-white" : "text-neutral-100"}`}>{name}</span>
                              <DrawingMenu label={name} items={menuFor(drawing)} />
                            </span>
                            <StatusBadges drawing={drawing} />
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onStart(drawing);
                              }}
                              className="btn btn-secondary mt-auto h-7 justify-center"
                            >
                              열기
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* 미리보기: 넓은 화면은 오른쪽, 좁은 화면은 목록 아래 */}
              {selectedPart && drawingState.status === "ready" && drawingList.length > 0 && (
                <aside aria-label="도면 미리보기" className="max-h-[45vh] min-h-0 overflow-y-auto border-t border-neutral-700 p-3 2xl:max-h-none 2xl:border-l 2xl:border-t-0">
                  {selectedDrawing ? (
                    <DrawingPreview
                      key={selectedDrawing.drawing_id}
                      drawing={selectedDrawing}
                      onStart={onStart}
                      wide
                      menu={<DrawingMenu label={selectedDrawing.original_filename || selectedDrawing.name} items={menuFor(selectedDrawing)} />}
                    />
                  ) : (
                    <p className="py-6 text-center text-xs text-neutral-400">도면을 한 번 누르면 여기에서 미리 봅니다.</p>
                  )}
                </aside>
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
              <span className="flex items-center gap-2">
                {adminMenu && (
                  <button
                    type="button"
                    disabled={!selectedDrawing}
                    onClick={() => adminMenu.onChange("progress")}
                    className="btn btn-secondary btn-lg"
                  >
                    <Activity aria-hidden="true" className="h-4 w-4" />
                    작업 현황
                  </button>
                )}
                <button
                  type="button"
                  disabled={!selectedDrawing}
                  onClick={() => selectedDrawing && onStart(selectedDrawing)}
                  className="btn btn-primary btn-lg"
                >
                  작업 시작
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </span>
            </footer>
          </section>

          {adding && selectedPart && (
            <AddDrawingDialog
              part={selectedPart}
              onClose={() => setAdding(false)}
              onUploaded={(drawing) => {
                setAdding(false);
                setNotice(`도면을 추가했습니다: ${drawing.original_filename || drawing.name} (OCR ${drawing.ocr_status === "not_started" ? "미실행" : drawing.ocr_status})`);
                refreshAfterChange(drawing.drawing_id);
              }}
            />
          )}
          {deleteTarget && (
            <DeleteDrawingDialog
              drawing={deleteTarget}
              onCancel={() => setDeleteTarget(null)}
              onDeleted={(drawing) => {
                setDeleteTarget(null);
                setNotice(`삭제했습니다: ${drawing.original_filename || drawing.name} (파일·기록은 서버에 보관)`);
                refreshAfterChange(drawingId === drawing.drawing_id ? "" : drawingId);
              }}
            />
          )}
        </div>
      </main>
      )}
    </div>
  );
}
