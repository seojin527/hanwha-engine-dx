/**
 * 3D 메인 화면의 왼쪽 패널: 탐색(엔진·부품·도면 트리) + 선택 대상(정보 / 연결 도면 / 관계도) + 작업(도면 등록).
 *
 * 3D 부품 종류(엔진 뷰어의 PARTS: CS·CR·CH·PR·PH)와 등록 부품(parts 테이블)은 parts.engine_part_key 로만 연결한다.
 * 이 값은 관리자가 지정한다. 부품 이름이 비슷하다는 이유로 자동 연결하지 않고, 이름이 비슷한 미연결 부품은 '추천'으로만 보여준다.
 * 조립체(어셈블리) 계층은 현재 데이터에 없어 관계도에 '데이터 없음'으로 표시한다.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cog,
  FileText,
  GripVertical,
  Link2,
  MoveRight,
  Loader2,
  Package,
  Plus,
  Unlink,
} from "lucide-react";
import { createPart, fetchDrawings, fetchParts, linkEnginePart, moveDrawingToPart, type Drawing, type Part } from "../../lib/drawingAPI";
import { ENGINE_PART_LABEL, toEnginePartKey, type EnginePartKey } from "../../lib/engineParts";
import { useConfirmDiscard } from "../../lib/unsavedChanges";
import type { EngineModelInfo } from "./EngineViewer3D";
import { RegisterDrawingPanel } from "./RegisterDrawingPanel";
import { MoveDrawingDialog } from "./MoveDrawingDialog";

/** 접힌 노드 위에 이만큼 머물면 펼친다 (드래그 중 하위 부품을 고를 수 있게) */
const EXPAND_ON_HOVER_MS = 600;

export interface EngineSelection {
  /** 3D 부품 종류 (null 이면 전체 엔진) */
  engineKey: string | null;
  /** 등록 부품 */
  partId: string | null;
  /** 목록에서 고른 도면 (열기 전) */
  drawingId: string | null;
}

type DetailTab = "info" | "drawings" | "relation" | "register";

type DrawingLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; drawings: Drawing[] };

const OCR_LABEL: Record<string, string> = {
  not_started: "OCR 전",
  queued: "OCR 대기",
  running: "OCR 중",
  completed: "OCR 완료",
  failed: "OCR 실패",
};

export function reviewLabel(drawing: Pick<Drawing, "review_status" | "ocr_status">) {
  if (drawing.review_status === "reviewed") return { text: "검토 완료", tone: "ok" as const };
  if (drawing.ocr_status === "completed" || drawing.review_status) return { text: "검토 전", tone: "warn" as const };
  return { text: "OCR 필요", tone: "muted" as const };
}

export function StatusText({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? AlertTriangle : tone === "warn" ? Clock3 : Clock3;
  const color = tone === "ok" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : tone === "warn" ? "text-amber-200" : "text-dx-faint";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] ${color}`}>
      <Icon aria-hidden="true" className="h-3 w-3" />
      {children}
    </span>
  );
}

export function EngineExplorerPanel({
  model,
  selection,
  onSelect,
  canManage,
  refreshKey,
  onOpenDrawing,
  onUploaded,
  onPartsLoaded,
  onDrawingMoved,
  layout = "side",
}: {
  model: EngineModelInfo | null;
  selection: EngineSelection;
  onSelect: (next: EngineSelection) => void;
  canManage: boolean;
  refreshKey: number;
  onOpenDrawing: (drawing: Drawing) => void;
  onUploaded: (drawing: Drawing) => void;
  onPartsLoaded?: (parts: Part[]) => void;
  /** 도면 소속 부품을 바꾼 뒤 (App 이 열린 도면·경로를 갱신) */
  onDrawingMoved?: (drawing: Drawing, fromPartId: string) => void;
  /** side: 데스크톱 왼쪽 패널 / sheet: 휴대폰 하단 시트 안 (폭 전체, 트리는 접어서 시작) */
  layout?: "side" | "sheet";
}) {
  const confirmDiscard = useConfirmDiscard();
  const [parts, setParts] = useState<Part[] | null>(null);
  const [partsError, setPartsError] = useState("");
  const [partsVersion, setPartsVersion] = useState(0);
  const [drawingLoads, setDrawingLoads] = useState<Record<string, DrawingLoad>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["engine"]));
  const [tab, setTab] = useState<DetailTab>("info");
  const [registerPartId, setRegisterPartId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(layout === "side");
  const [actionError, setActionError] = useState("");
  const treeRef = useRef<HTMLDivElement>(null);
  // 도면 소속 변경: 드래그 상태 · 확인 창 · 결과 안내
  const [drag, setDrag] = useState<{ drawing: Drawing; overPartId: string | null } | null>(null);
  const [moveRequest, setMoveRequest] = useState<{ drawing: Drawing; target: Part | null } | null>(null);
  const [moveNotice, setMoveNotice] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const hoverTimer = useRef<{ id: string; timer: number } | null>(null);

  // ---------------------------------------------------------------- 데이터
  useEffect(() => {
    const controller = new AbortController();
    setPartsError("");
    fetchParts(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setParts(data.parts);
        onPartsLoaded?.(data.parts);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setPartsError(cause instanceof Error ? cause.message : "부품 조회 실패");
      });
    return () => controller.abort();
  }, [refreshKey, partsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // 새로 고칠 때는 이미 펼친 부품의 도면 목록도 다시 불러온다.
  useEffect(() => {
    setDrawingLoads({});
  }, [refreshKey]);

  function loadDrawings(partId: string) {
    if (drawingLoads[partId] && drawingLoads[partId].status !== "error") return;
    setDrawingLoads((previous) => ({ ...previous, [partId]: { status: "loading" } }));
    fetchDrawings(partId)
      .then((data) => setDrawingLoads((previous) => ({ ...previous, [partId]: { status: "ready", drawings: data.drawings } })))
      .catch((cause: unknown) =>
        setDrawingLoads((previous) => ({
          ...previous,
          [partId]: { status: "error", message: cause instanceof Error ? cause.message : "도면 조회 실패" },
        })),
      );
  }

  const modelParts = useMemo(
    () =>
      model?.parts.length
        ? model.parts
        : (Object.keys(ENGINE_PART_LABEL) as EnginePartKey[]).map((key) => ({ key, name: ENGINE_PART_LABEL[key], pn: "", qty: 0, spec: [] as [string, string][] })),
    [model],
  );
  const modelKeys = new Set(modelParts.map((p) => p.key));
  const linkedParts = (key: string) => (parts ?? []).filter((part) => part.engine_part_key === key);
  const partPath = (part: Part | undefined) =>
    part
      ? `${modelParts.find((m) => m.key === part.engine_part_key)?.name ?? "3D 미연결"} › ${part.name}`
      : "알 수 없는 부품";
  const selectedModelPart = modelParts.find((p) => p.key === selection.engineKey) ?? null;
  const selectedPart = (parts ?? []).find((part) => part.part_id === selection.partId) ?? null;

  // 선택한 부품의 도면을 미리 불러오고, 트리를 선택 위치까지 펼친다.
  const targetParts: Part[] = selectedPart ? [selectedPart] : selection.engineKey ? linkedParts(selection.engineKey) : [];
  const targetKey = targetParts.map((part) => part.part_id).join(",");
  useEffect(() => {
    targetParts.forEach((part) => loadDrawings(part.part_id));
    setExpanded((previous) => {
      const next = new Set(previous);
      next.add("engine");
      if (selection.engineKey) next.add(`model:${selection.engineKey}`);
      if (selection.partId) next.add(`part:${selection.partId}`);
      return next;
    });
  }, [targetKey, selection.engineKey, selection.partId, drawingLoads]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const row = treeRef.current?.querySelector('[aria-current="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [selection.engineKey, selection.partId, selection.drawingId, expanded]);

  // 3D에서 부품을 고르면 연결 도면 탭을 먼저 보여준다 (연결 부품이 없으면 정보 탭).
  useEffect(() => {
    if (tab === "register") return;
    if (!selection.engineKey && !selection.partId) setTab("info");
    else setTab(targetParts.length ? "drawings" : "info");
  }, [selection.engineKey, selection.partId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function select(next: EngineSelection) {
    if (tab === "register" && !confirmDiscard("다른 대상을 선택")) return;
    if (tab === "register") setTab("info");
    onSelect(next);
  }

  function selectPart(part: Part) {
    select({ engineKey: part.engine_part_key && modelKeys.has(part.engine_part_key) ? part.engine_part_key : null, partId: part.part_id, drawingId: null });
  }

  // ---------------------------------------------------------------- 도면 소속 변경 (드래그 · 메뉴 공통)
  /** 화면을 먼저 옮기고 서버에 저장한다. 실패하면 원래 목록으로 되돌리고 이유를 돌려준다. */
  async function applyMove(drawing: Drawing, target: Part): Promise<string | null> {
    const from = drawing.part_id;
    if (from === target.part_id) return null;
    const before = { loads: drawingLoads, parts };
    const fromPart = (parts ?? []).find((p) => p.part_id === from);
    setDrawingLoads((previous) => {
      const next = { ...previous };
      const source = next[from];
      if (source?.status === "ready") next[from] = { status: "ready", drawings: source.drawings.filter((d) => d.drawing_id !== drawing.drawing_id) };
      const dest = next[target.part_id];
      if (dest?.status === "ready") next[target.part_id] = { status: "ready", drawings: [{ ...drawing, part_id: target.part_id }, ...dest.drawings] };
      return next;
    });
    setParts((previous) => previous?.map((p) =>
      p.part_id === from ? { ...p, drawing_count: p.drawing_count - 1 } : p.part_id === target.part_id ? { ...p, drawing_count: p.drawing_count + 1 } : p,
    ) ?? previous);
    try {
      const result = await moveDrawingToPart(drawing.drawing_id, target.part_id, from);
      setMoveRequest(null);
      setMoveNotice({ tone: "ok", text: `이동했습니다: ${drawing.original_filename || drawing.name} · ${partPath(fromPart)} → ${partPath(target)}` });
      // 서버 기준으로 다시 불러온다 (두 부품의 도면 목록·개수)
      setDrawingLoads((previous) => { const next = { ...previous }; delete next[from]; delete next[target.part_id]; return next; });
      setPartsVersion((value) => value + 1);
      if (selection.drawingId === drawing.drawing_id || selection.partId === from) {
        onSelect({
          engineKey: target.engine_part_key && modelKeys.has(target.engine_part_key) ? target.engine_part_key : null,
          partId: target.part_id,
          drawingId: selection.drawingId === drawing.drawing_id ? drawing.drawing_id : null,
        });
      }
      onDrawingMoved?.(result.drawing, from);
      return null;
    } catch (cause) {
      setDrawingLoads(before.loads);
      setParts(before.parts);
      const message = cause instanceof Error ? cause.message : "이동 실패";
      setMoveNotice({ tone: "bad", text: `이동하지 못했습니다 (원래 소속 유지): ${message}` });
      return `이동하지 못했습니다. 원래 소속(${partPath(fromPart)})을 유지합니다. 이유: ${message}`;
    }
  }

  function dragProps(drawing: Drawing) {
    if (!canManage) return {};
    return {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.setData("text/plain", drawing.drawing_id);
        event.dataTransfer.effectAllowed = "move";
        setMoveNotice(null);
        setDrag({ drawing, overPartId: null });
      },
      onDragEnd: () => {
        setDrag(null);
        if (hoverTimer.current) window.clearTimeout(hoverTimer.current.timer);
        hoverTimer.current = null;
      },
    };
  }

  /** 등록 부품 행: 드롭 대상 */
  function partDropProps(part: Part) {
    if (!drag) return {};
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = part.part_id === drag.drawing.part_id ? "none" : "move";
        if (drag.overPartId !== part.part_id) setDrag({ ...drag, overPartId: part.part_id });
        expandLater(`part:${part.part_id}`);
      },
      onDragLeave: () => setDrag((current) => (current?.overPartId === part.part_id ? { ...current, overPartId: null } : current)),
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const dragged = drag.drawing;
        setDrag(null);
        if (dragged.part_id === part.part_id) {
          setMoveNotice({ tone: "warn", text: "같은 부품에 놓아 변경하지 않았습니다." });
          return;
        }
        setMoveRequest({ drawing: dragged, target: part });
      },
    };
  }

  /** 3D 부품 종류·그룹 행: 놓을 수 없고, 잠시 머물면 펼쳐서 하위 부품을 보여준다 */
  function expandOnlyProps(id: string) {
    if (!drag) return {};
    return {
      onDragOver: () => {
        if (drag.overPartId) setDrag({ ...drag, overPartId: null });
        expandLater(id);
      },
    };
  }

  function expandLater(id: string) {
    if (expanded.has(id) || hoverTimer.current?.id === id) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current.timer);
    hoverTimer.current = {
      id,
      timer: window.setTimeout(() => {
        setExpanded((previous) => new Set(previous).add(id));
        if (id.startsWith("part:")) loadDrawings(id.slice(5));
        hoverTimer.current = null;
      }, EXPAND_ON_HOVER_MS),
    };
  }

  function startRegister(partId: string) {
    setRegisterPartId(partId);
    setTab("register");
  }

  async function runAction(action: () => Promise<unknown>) {
    setActionError("");
    try {
      await action();
      setPartsVersion((value) => value + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "처리 실패");
    }
  }

  // ---------------------------------------------------------------- 트리
  function drawingRows(part: Part, depth: number) {
    const load = drawingLoads[part.part_id];
    if (!load || load.status === "loading") {
      return <TreeNote depth={depth}><Loader2 className="h-3 w-3 animate-spin" />도면 불러오는 중…</TreeNote>;
    }
    if (load.status === "error") {
      return (
        <TreeNote depth={depth}>
          <span className="text-rose-300">{load.message}</span>
          <button type="button" className="underline" onClick={() => { setDrawingLoads((p) => { const n = { ...p }; delete n[part.part_id]; return n; }); loadDrawings(part.part_id); }}>
            다시
          </button>
        </TreeNote>
      );
    }
    if (!load.drawings.length) return <TreeNote depth={depth}>연결 도면 없음</TreeNote>;
    return load.drawings.map((drawing) => (
      <TreeRow
        key={drawing.drawing_id}
        depth={depth}
        current={selection.drawingId === drawing.drawing_id}
        drag={dragProps(drawing)}
        dragging={drag?.drawing.drawing_id === drawing.drawing_id}
        icon={<FileText className="h-3.5 w-3.5 text-dx-faint" />}
        label={drawing.original_filename || drawing.name}
        meta={reviewLabel(drawing).text}
        onClick={() => select({ engineKey: part.engine_part_key && modelKeys.has(part.engine_part_key) ? part.engine_part_key : null, partId: part.part_id, drawingId: drawing.drawing_id })}
        onDoubleClick={() => onOpenDrawing(drawing)}
        title="두 번 클릭하면 도면을 엽니다"
      />
    ));
  }

  function partRows(list: Part[], depth: number) {
    return list.map((part) => {
      const id = `part:${part.part_id}`;
      const open = expanded.has(id);
      return (
        <div key={part.part_id}>
          <TreeRow
            depth={depth}
            expandable
            open={open}
            onToggle={() => { toggle(id); if (!open) loadDrawings(part.part_id); }}
            drop={partDropProps(part)}
            dropState={drag && drag.overPartId === part.part_id ? (drag.drawing.part_id === part.part_id ? "same" : "ok") : drag ? "available" : null}
            current={selection.partId === part.part_id && !selection.drawingId}
            icon={<Package className="h-3.5 w-3.5 text-dx-faint" />}
            label={part.name}
            meta={`도면 ${part.drawing_count}`}
            onClick={() => selectPart(part)}
          />
          {open && drawingRows(part, depth + 1)}
        </div>
      );
    });
  }

  const engineTitle = model?.title || "엔진 조립품";
  const nothingSelected = !selection.engineKey && !selection.partId;

  return (
    <aside aria-label="엔진 탐색" className={layout === "sheet" ? "flex min-h-0 w-full flex-1 flex-col bg-dx-panel" : "flex w-[360px] shrink-0 flex-col border-r border-dx-line bg-dx-panel"}>
      {/* ---------------------------------------------- 탐색 */}
      <section aria-label="부품 탐색" className={`flex min-h-0 flex-col border-b border-dx-line ${treeOpen ? "max-h-[45%]" : ""}`}>
        <button type="button" onClick={() => setTreeOpen((v) => !v)} aria-expanded={treeOpen} className="flex h-9 shrink-0 items-center gap-1.5 px-3 text-left">
          {treeOpen ? <ChevronDown className="h-3.5 w-3.5 text-dx-faint" /> : <ChevronRight className="h-3.5 w-3.5 text-dx-faint" />}
          <span className="dx-section-title">탐색</span>
          <span className="ml-auto text-[11px] text-dx-faint">{parts ? `등록 부품 ${parts.length}` : ""}</span>
        </button>
        {treeOpen && (
          <div ref={treeRef} role="tree" aria-label="엔진 · 부품 · 도면" className="min-h-0 overflow-y-auto px-2 pb-2">
            {partsError && <p role="alert" className="px-2 py-1 text-[11px] text-rose-300">부품 조회 실패: {partsError} <button type="button" className="underline" onClick={() => setPartsVersion((v) => v + 1)}>다시</button></p>}
            <TreeRow
              depth={0}
              expandable
              open={expanded.has("engine")}
              onToggle={() => toggle("engine")}
              current={nothingSelected}
              icon={<Cog className="h-3.5 w-3.5 text-dx-accent" />}
              label={engineTitle}
              meta={model?.pn ?? ""}
              onClick={() => select({ engineKey: null, partId: null, drawingId: null })}
            />
            {expanded.has("engine") && (
              <>
                {modelParts.map((modelPart) => {
                  const id = `model:${modelPart.key}`;
                  const open = expanded.has(id);
                  const linked = linkedParts(modelPart.key);
                  return (
                    <div key={modelPart.key}>
                      <TreeRow
                        depth={1}
                        expandable
                        open={open}
                        onToggle={() => toggle(id)}
                        drop={expandOnlyProps(id)}
                        current={selection.engineKey === modelPart.key && !selection.partId}
                        icon={<span aria-hidden="true" className="h-2 w-2 rounded-sm bg-dx-faint" />}
                        label={modelPart.name}
                        meta={linked.length ? `연결 ${linked.length}` : "미연결"}
                        onClick={() => select({ engineKey: modelPart.key, partId: linked.length === 1 ? linked[0].part_id : null, drawingId: null })}
                      />
                      {open && (linked.length ? partRows(linked, 2) : <TreeNote depth={2}>연결된 등록 부품 없음</TreeNote>)}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </section>

      {(drag || moveNotice) && (
        <div role="status" aria-live="polite" className={`shrink-0 border-b px-3 py-2 text-[11px] ${
          drag ? "border-dx-accent/40 bg-dx-accent/10 text-dx-text"
            : moveNotice?.tone === "ok" ? "border-dx-line text-emerald-300"
              : moveNotice?.tone === "bad" ? "border-dx-line text-rose-300" : "border-dx-line text-amber-200"
        }`}>
          {drag ? (
            <>
              <p className="flex items-center gap-1.5 font-medium"><MoveRight className="h-3.5 w-3.5 text-dx-accent" />{drag.drawing.original_filename || drag.drawing.name}</p>
              <p className="mt-0.5 text-dx-muted">
                {partPath((parts ?? []).find((p) => p.part_id === drag.drawing.part_id))}
                {" → "}
                {drag.overPartId
                  ? drag.overPartId === drag.drawing.part_id
                    ? "같은 부품 (변경 없음)"
                    : <b className="text-white">{partPath((parts ?? []).find((p) => p.part_id === drag.overPartId))}</b>
                  : "옮길 등록 부품 위에 놓으세요 (3D 부품 종류 위에 잠시 머물면 펼쳐집니다)"}
              </p>
            </>
          ) : (
            <p className="flex items-start justify-between gap-2">
              <span>{moveNotice?.text}</span>
              <button type="button" className="shrink-0 underline" onClick={() => setMoveNotice(null)}>닫기</button>
            </p>
          )}
        </div>
      )}

      {moveRequest && (
        <MoveDrawingDialog
          drawing={moveRequest.drawing}
          parts={parts ?? []}
          initialTarget={moveRequest.target}
          partPath={partPath}
          onCancel={() => setMoveRequest(null)}
          onConfirm={(target) => applyMove(moveRequest.drawing, target)}
        />
      )}

      {/* ---------------------------------------------- 선택 대상 · 작업 */}
      <section aria-label="선택 대상" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 pt-2.5">
          <p className="text-[11px] text-dx-faint">선택 대상</p>
          <h2 className="truncate text-[15px] font-semibold text-white">
            {selectedModelPart?.name ?? selectedPart?.name ?? engineTitle}
            {selectedModelPart && selectedPart && <span className="ml-1.5 text-xs font-normal text-dx-muted">› {selectedPart.name}</span>}
          </h2>
        </div>
        <div role="tablist" aria-label="선택 대상 보기" className="flex shrink-0 gap-1 border-b border-dx-line px-2">
          <Tab id="info" current={tab} onSelect={setTab}>정보</Tab>
          <Tab id="drawings" current={tab} onSelect={setTab} disabled={!targetParts.length}>연결 도면</Tab>
          <Tab id="relation" current={tab} onSelect={setTab}>관계도</Tab>
          {tab === "register" && <Tab id="register" current={tab} onSelect={setTab}>도면 등록</Tab>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
          {actionError && <p role="alert" className="mx-3 mt-2 text-[11px] text-rose-300">{actionError}</p>}
          {tab === "info" && (
            <InfoTab
              engineTitle={engineTitle}
              model={model}
              modelPart={selectedModelPart}
              part={selectedPart}
              parts={parts ?? []}
              linked={selection.engineKey ? linkedParts(selection.engineKey) : []}
              canManage={canManage}
              modelKeys={[...modelKeys]}
              modelParts={modelParts}
              onSelectPart={selectPart}
              onAction={runAction}
              onRegister={startRegister}
            />
          )}
          {tab === "drawings" && (
            <DrawingsTab
              parts={targetParts}
              loads={drawingLoads}
              selectedDrawingId={selection.drawingId}
              canManage={canManage}
              dragProps={dragProps}
              onMove={(drawing) => setMoveRequest({ drawing, target: null })}
              onPick={(part, drawing) => select({ engineKey: selection.engineKey, partId: selection.partId ?? (targetParts.length === 1 ? part.part_id : null), drawingId: drawing.drawing_id })}
              onOpen={onOpenDrawing}
              onRegister={startRegister}
            />
          )}
          {tab === "relation" && (
            <RelationTab
              engineTitle={engineTitle}
              modelPart={selectedModelPart}
              parts={selectedPart ? [selectedPart] : selection.engineKey ? linkedParts(selection.engineKey) : []}
              loads={drawingLoads}
            />
          )}
          {tab === "register" && registerPartId && (parts ?? []).some((p) => p.part_id === registerPartId) && (
            <RegisterDrawingPanel
              engineName={(() => {
                const part = (parts ?? []).find((p) => p.part_id === registerPartId)!;
                return modelParts.find((m) => m.key === part.engine_part_key)?.name ?? null;
              })()}
              part={(parts ?? []).find((p) => p.part_id === registerPartId)!}
              onClose={() => setTab(targetParts.length ? "drawings" : "info")}
              onUploaded={(drawing) => {
                setDrawingLoads((previous) => { const next = { ...previous }; delete next[drawing.part_id]; return next; });
                setPartsVersion((value) => value + 1);
                onUploaded(drawing);
              }}
            />
          )}
        </div>
      </section>
    </aside>
  );
}

// ==================================================================== 탭 내용
function InfoTab({
  engineTitle,
  model,
  modelPart,
  part,
  parts,
  linked,
  canManage,
  modelKeys,
  modelParts,
  onSelectPart,
  onAction,
  onRegister,
}: {
  engineTitle: string;
  model: EngineModelInfo | null;
  modelPart: EngineModelInfo["parts"][number] | null;
  part: Part | null;
  parts: Part[];
  linked: Part[];
  canManage: boolean;
  modelKeys: string[];
  modelParts: EngineModelInfo["parts"];
  onSelectPart: (part: Part) => void;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  onRegister: (partId: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  useEffect(() => {
    setNewName(modelPart?.name ?? "");
    setLinkTarget("");
  }, [modelPart?.key]);

  // 아무것도 고르지 않은 상태: 전체 엔진
  if (!modelPart && !part) {
    const linkedCount = parts.filter((p) => p.engine_part_key && modelKeys.includes(p.engine_part_key)).length;
    return (
      <div className="space-y-3 p-3 text-xs">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-dx-muted">엔진</dt>
          <dd className="text-dx-text">{engineTitle}</dd>
          {model?.pn && (<><dt className="text-dx-muted">조립품 번호</dt><dd className="font-mono text-dx-text">{model.pn}</dd></>)}
          <dt className="text-dx-muted">3D 부품 종류</dt>
          <dd className="font-mono text-dx-text">{modelParts.length}</dd>
          <dt className="text-dx-muted">등록 부품</dt>
          <dd className="text-dx-text"><span className="font-mono">{parts.length}</span> (3D 연결 {linkedCount} · 미연결 {parts.length - linkedCount})</dd>
          {model?.source && (<><dt className="text-dx-muted">3D 모델</dt><dd className="text-dx-muted">{model.source}</dd></>)}
        </dl>
        <p className="rounded border border-dx-line bg-dx-raised px-2.5 py-2 text-dx-muted">
          3D 화면에서 부품을 클릭하거나 위 트리에서 부품을 고르면 연결된 도면을 볼 수 있습니다.
        </p>
      </div>
    );
  }

  // 3D와 연결되지 않은 등록 부품
  if (!modelPart && part) {
    return (
      <div className="space-y-3 p-3 text-xs">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-dx-muted">등록 부품</dt><dd className="text-dx-text">{part.name}</dd>
          <dt className="text-dx-muted">등록일</dt><dd className="font-mono text-dx-text">{part.created_at}</dd>
          <dt className="text-dx-muted">도면</dt><dd className="font-mono text-dx-text">{part.drawing_count}</dd>
          <dt className="text-dx-muted">3D 연결</dt><dd className="text-amber-200">연결 안 됨 — 3D 화면에서 강조할 수 없습니다.</dd>
        </dl>
        {canManage ? (
          <div className="space-y-2 rounded border border-dx-line p-2.5">
            <label className="dx-label" htmlFor="link-model">3D 부품 종류에 연결</label>
            <div className="flex gap-2">
              <select id="link-model" className="dx-input" value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)}>
                <option value="">선택해주세요</option>
                {modelParts.map((m) => <option key={m.key} value={m.key}>{m.name}{m.pn ? ` (${m.pn})` : ""}</option>)}
              </select>
              <button type="button" className="dx-btn dx-btn-primary" disabled={!linkTarget} onClick={() => void onAction(() => linkEnginePart(part.part_id, linkTarget))}>
                <Link2 className="h-3.5 w-3.5" />연결
              </button>
            </div>
            {toEnginePartKey(part.name) && (
              <p className="text-[11px] text-dx-faint">이름 기준 추천: {ENGINE_PART_LABEL[toEnginePartKey(part.name)!]} (자동 연결하지 않음)</p>
            )}
            <button type="button" className="dx-btn" onClick={() => onRegister(part.part_id)}><Plus className="h-3.5 w-3.5" />도면 추가</button>
          </div>
        ) : (
          <p className="text-dx-muted">3D 연결은 관리자가 지정합니다.</p>
        )}
      </div>
    );
  }

  // 3D 부품 종류
  const suggestions = parts.filter((p) => (!p.engine_part_key || !modelKeys.includes(p.engine_part_key)) && toEnginePartKey(p.name) === modelPart!.key);
  const unlinked = parts.filter((p) => !p.engine_part_key || !modelKeys.includes(p.engine_part_key));
  return (
    <div className="space-y-3 p-3 text-xs">
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-dx-muted">3D 부품</dt><dd className="text-dx-text">{modelPart!.name}</dd>
        {modelPart!.pn && (<><dt className="text-dx-muted">모델 번호</dt><dd className="font-mono text-dx-text">{modelPart!.pn}</dd></>)}
        {modelPart!.qty > 0 && (<><dt className="text-dx-muted">수량</dt><dd className="font-mono text-dx-text">×{modelPart!.qty}</dd></>)}
        {modelPart!.spec.map(([label, value]) => (
          <div key={label} className="contents"><dt className="text-dx-muted">{label}</dt><dd className="font-mono text-dx-text">{value}</dd></div>
        ))}
      </dl>
      <p className="text-[11px] text-dx-faint">위 값은 3D 모델 설정(engine-viewer)의 설계 정보이며, 도면 OCR 값과 다를 수 있습니다.</p>

      <div className="space-y-1.5">
        <h3 className="dx-section-title">연결된 등록 부품</h3>
        {linked.length ? (
          <ul className="space-y-1">
            {linked.map((p) => (
              <li key={p.part_id} className="flex items-center gap-2 rounded border border-dx-line bg-dx-raised px-2.5 py-1.5">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-dx-text hover:underline" onClick={() => onSelectPart(p)}>
                  {p.name}
                </button>
                <span className="font-mono text-[11px] text-dx-muted">도면 {p.drawing_count}</span>
                {canManage && (
                  <button type="button" title="3D 연결 해제" aria-label={`${p.name} 3D 연결 해제`} className="dx-btn dx-btn-ghost dx-icon-btn h-6" onClick={() => { if (window.confirm(`${p.name}의 3D 연결을 해제할까요? 부품과 도면은 그대로 남습니다.`)) void onAction(() => linkEnginePart(p.part_id, null)); }}>
                    <Unlink className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded border border-dashed border-dx-line-strong px-2.5 py-2 text-dx-muted">
            이 3D 부품에 연결된 등록 부품이 없어 도면을 표시할 수 없습니다.
            {!canManage && " 관리자에게 연결을 요청하세요."}
          </p>
        )}
      </div>

      {canManage && (
        <div className="space-y-2 rounded border border-dx-line p-2.5">
          <h3 className="dx-section-title">연결 관리 (관리자)</h3>
          {suggestions.length > 0 && (
            <p className="text-[11px] text-dx-muted">
              이름이 비슷한 미연결 부품: {suggestions.map((s) => s.name).join(", ")} — 확인 후 아래에서 연결하세요. 자동으로 연결하지 않습니다.
            </p>
          )}
          <label className="dx-label" htmlFor="link-existing">기존 등록 부품 연결</label>
          <div className="flex gap-2">
            <select id="link-existing" className="dx-input" value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)}>
              <option value="">미연결 부품 선택</option>
              {unlinked.map((p) => <option key={p.part_id} value={p.part_id}>{p.name} (도면 {p.drawing_count})</option>)}
            </select>
            <button type="button" className="dx-btn" disabled={!linkTarget} onClick={() => void onAction(() => linkEnginePart(linkTarget, modelPart!.key))}>
              <Link2 className="h-3.5 w-3.5" />연결
            </button>
          </div>
          <label className="dx-label" htmlFor="new-part">새 부품으로 등록 후 연결</label>
          <div className="flex gap-2">
            <input id="new-part" className="dx-input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} />
            <button type="button" className="dx-btn" disabled={!newName.trim()} onClick={() => void onAction(async () => { const created = await createPart(newName.trim(), modelPart!.key); onRegister(created.part_id); })}>
              <Plus className="h-3.5 w-3.5" />부품 만들기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DrawingsTab({
  parts,
  loads,
  selectedDrawingId,
  canManage,
  onPick,
  onOpen,
  onRegister,
  dragProps,
  onMove,
}: {
  parts: Part[];
  loads: Record<string, DrawingLoad>;
  selectedDrawingId: string | null;
  canManage: boolean;
  dragProps: (drawing: Drawing) => Record<string, unknown>;
  onMove: (drawing: Drawing) => void;
  onPick: (part: Part, drawing: Drawing) => void;
  onOpen: (drawing: Drawing) => void;
  onRegister: (partId: string) => void;
}) {
  return (
    <div className="space-y-4 p-3 text-xs">
      {parts.map((part) => {
        const load = loads[part.part_id];
        return (
          <section key={part.part_id} aria-label={`${part.name} 도면`} className="space-y-2">
            <header className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{part.name}</h3>
              {canManage && (
                <button type="button" className="dx-btn" onClick={() => onRegister(part.part_id)}>
                  <Plus className="h-3.5 w-3.5" />도면 추가
                </button>
              )}
            </header>
            {!load || load.status === "loading" ? (
              <p role="status" className="flex items-center gap-1.5 text-dx-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />도면 불러오는 중…</p>
            ) : load.status === "error" ? (
              <p role="alert" className="text-rose-300">{load.message}</p>
            ) : load.drawings.length === 0 ? (
              <div className="rounded border border-dashed border-dx-line-strong px-3 py-4 text-center text-dx-muted">
                <FileText aria-hidden="true" className="mx-auto mb-1.5 h-5 w-5 text-dx-faint" />
                연결된 도면이 없습니다.
                {canManage ? (
                  <div className="mt-2"><button type="button" className="dx-btn dx-btn-primary" onClick={() => onRegister(part.part_id)}>도면 등록</button></div>
                ) : (
                  <p className="mt-1 text-[11px]">관리자에게 도면 등록을 요청하세요.</p>
                )}
              </div>
            ) : (
              <ul className="space-y-1" aria-label="도면 비교">
                {load.drawings.map((drawing) => {
                  const active = drawing.drawing_id === selectedDrawingId;
                  const review = reviewLabel(drawing);
                  return (
                    <li key={drawing.drawing_id}>
                      <div
                        {...dragProps(drawing)}
                        className={`flex items-center gap-2 rounded border px-2.5 py-2 transition-colors ${active ? "border-dx-accent bg-dx-accent/10" : "border-dx-line bg-dx-raised hover:border-dx-line-strong"}`}
                      >
                        {canManage && (
                          <span title="끌어서 트리의 다른 부품으로 옮기기" className="-ml-1 cursor-grab text-dx-faint active:cursor-grabbing">
                            <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
                          </span>
                        )}
                        <button
                          type="button"
                          aria-current={active || undefined}
                          onClick={() => onPick(part, drawing)}
                          onDoubleClick={() => onOpen(drawing)}
                          className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-dx-accent"
                        >
                          <span className="block truncate font-medium text-dx-text">{drawing.original_filename || drawing.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-dx-muted">
                            <span className="font-mono">{drawing.created_at?.slice(0, 16)}</span>
                            <span>{OCR_LABEL[drawing.ocr_status] ?? drawing.ocr_status}</span>
                            {drawing.ocr_revision && <span className="font-mono" title="OCR 결과 버전 (도면 개정 번호가 아님)">OCR v.{drawing.ocr_revision.slice(0, 6)}</span>}
                            <StatusText tone={review.tone}>{review.text}</StatusText>
                          </span>
                        </button>
                        {canManage && (
                          <button type="button" className="dx-btn dx-btn-ghost dx-icon-btn" title="소속 부품 변경" aria-label={`${drawing.original_filename || drawing.name} 소속 부품 변경`} onClick={() => onMove(drawing)}>
                            <MoveRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button type="button" className={`dx-btn ${active ? "dx-btn-primary" : ""}`} onClick={() => onOpen(drawing)}>
                          열기
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      <p className="text-[11px] text-dx-faint">도면 개정 번호는 현재 데이터에 없어 OCR 결과 버전으로 변경을 구분합니다. 도면을 열기 전까지 3D 화면이 유지됩니다.</p>
    </div>
  );
}

function RelationTab({
  engineTitle,
  modelPart,
  parts,
  loads,
}: {
  engineTitle: string;
  modelPart: EngineModelInfo["parts"][number] | null;
  parts: Part[];
  loads: Record<string, DrawingLoad>;
}) {
  return (
    <div className="space-y-3 p-3 text-xs">
      <ol className="space-y-0" aria-label="엔진 → 조립체 → 부품 → 도면">
        <RelationNode level="엔진" title={engineTitle} />
        <RelationNode level="조립체" title="데이터 없음" missing note="조립체 계층이 정의되지 않았습니다." />
        <RelationNode level="3D 부품 종류" title={modelPart ? `${modelPart.name}${modelPart.qty ? ` ×${modelPart.qty}` : ""}` : "선택 안 됨"} missing={!modelPart} />
        <RelationNode
          level="등록 부품"
          title={parts.length ? parts.map((p) => p.name).join(", ") : "연결 없음"}
          missing={!parts.length}
        />
        <RelationNode
          level="도면"
          last
          title={(() => {
            if (!parts.length) return "—";
            const counts = parts.map((p) => {
              const load = loads[p.part_id];
              return load?.status === "ready" ? load.drawings.length : p.drawing_count;
            });
            return `${counts.reduce((a, b) => a + b, 0)}건`;
          })()}
        />
      </ol>
      <div className="rounded border border-dx-line bg-dx-raised p-2.5 text-[11px] text-dx-muted">
        <p className="font-semibold text-dx-text">데이터 연결 현황</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>3D 부품 종류 ↔ 등록 부품: <code className="font-mono">parts.engine_part_key</code> (관리자 지정)</li>
          <li>등록 부품 ↔ 도면: <code className="font-mono">drawings.part_id</code></li>
          <li>조립체 계층은 없습니다. 표시하려면 조립체 표(예: <code className="font-mono">engine_assemblies(assembly_id, name, parent_id)</code>)와 부품 쪽 연결 열(<code className="font-mono">assembly_id</code>)이 필요합니다.</li>
          <li>3D의 실린더별 개체(×6)는 같은 부품 종류를 복제한 것이라 개별 실물·제품 번호와 연결돼 있지 않습니다.</li>
        </ul>
      </div>
    </div>
  );
}

function RelationNode({ level, title, missing, note, last }: { level: string; title: string; missing?: boolean; note?: string; last?: boolean }) {
  return (
    <li className="relative pl-5">
      {!last && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-dx-line-strong" />}
      <span aria-hidden="true" className={`absolute left-0.5 top-1.5 h-3 w-3 rounded-full border ${missing ? "border-dashed border-dx-faint" : "border-dx-accent bg-dx-accent/20"}`} />
      <div className="pb-3">
        <p className="text-[11px] text-dx-faint">{level}</p>
        <p className={missing ? "text-dx-muted" : "font-medium text-dx-text"}>{title}</p>
        {note && <p className="text-[11px] text-dx-faint">{note}</p>}
      </div>
    </li>
  );
}

// ==================================================================== 작은 부품
function Tab({ id, current, onSelect, disabled, children }: { id: DetailTab; current: DetailTab; onSelect: (id: DetailTab) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={current === id} disabled={disabled} onClick={() => onSelect(id)} className="dx-tab">
      {children}
    </button>
  );
}

function TreeRow({
  depth,
  expandable,
  open,
  onToggle,
  current,
  icon,
  label,
  meta,
  onClick,
  onDoubleClick,
  title,
  drag,
  dragging,
  drop,
  dropState,
}: {
  depth: number;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  current: boolean;
  icon: ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  title?: string;
  /** 끌 수 있는 행 (도면) */
  drag?: Record<string, unknown>;
  dragging?: boolean;
  /** 놓을 수 있는 행 (부품) · 펼치기만 하는 행 */
  drop?: Record<string, unknown>;
  /** ok: 여기 놓으면 이동 · same: 같은 부품 · available: 드래그 중 놓을 수 있는 부품 */
  dropState?: "ok" | "same" | "available" | null;
}) {
  const dropClass =
    dropState === "ok" ? "rounded outline outline-1 outline-dx-accent bg-dx-accent/10"
      : dropState === "same" ? "rounded outline outline-1 outline-dashed outline-dx-faint"
        : dropState === "available" ? "rounded outline outline-1 outline-dashed outline-dx-line-strong" : "";
  return (
    <div
      role="treeitem"
      aria-expanded={expandable ? !!open : undefined}
      aria-selected={current}
      {...drop}
      className={`flex items-center transition-colors ${dropClass} ${dragging ? "opacity-50" : ""}`}
      style={{ paddingLeft: depth * 14 }}
    >
      {expandable ? (
        <button type="button" onClick={onToggle} aria-label={open ? "접기" : "펼치기"} className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-dx-faint hover:text-dx-text">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : drag && Object.keys(drag).length ? (
        <span title="끌어서 다른 부품으로 옮기기" className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-dx-faint active:cursor-grabbing" {...drag}>
          <GripVertical aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <button type="button" aria-current={current || undefined} onClick={onClick} onDoubleClick={onDoubleClick} title={title} className="dx-tree-row" {...drag}>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta && <span className="shrink-0 text-[10px] text-dx-faint">{meta}</span>}
      </button>
    </div>
  );
}

function TreeNote({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 py-1 text-[11px] text-dx-faint" style={{ paddingLeft: depth * 14 + 26 }}>
      {children}
    </p>
  );
}
