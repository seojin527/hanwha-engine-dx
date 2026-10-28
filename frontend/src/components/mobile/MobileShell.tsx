/**
 * 휴대폰 화면 흐름 (데스크톱 셸과 별도).
 *   3D 엔진 → 부품을 누르면 요약 카드(대표 도면 열기) → 도면 + 업무 고르기 → 한 항목씩 작업
 *   보조: 부품·도면 목록, 같은 부품의 다른 도면, 항목 목록, 기록 및 내보내기
 * 상태·API·정책은 App 이 넘겨준다. 관람객 주소(trial)에서는 관리자 도구를 보이지 않고 입력은 서버로 보내지 않는다.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Box, ChevronRight, FileDown, FileText, Layers, ListTree, LogOut, Menu } from "lucide-react";
import { EngineViewer3D, type EngineModelInfo } from "../shell/EngineViewer3D";
import type { EngineSelection } from "../shell/EngineExplorerPanel";
import { MobileDrawingView } from "./MobileDrawingView";
import { ManufacturingTask, MeasureTask, type TaskProps, type TrialEntry, type TrialStore } from "./MobileTask";
import { MobileOverlay, MobileTopBar, MenuButton, ModeBadge, type WorkMode } from "./ui";
import { fetchDrawings, fetchParts, apiUrl, type Drawing, type Part } from "../../lib/drawingAPI";
import type { OcrDocument, OcrPoint } from "../../lib/ocr";
import type { MeasurementRecord, SavedMeasurement } from "../../lib/measurementAPI";
import type { ReviewResultFile } from "../../lib/admin/drawingReviewAPI";
import { stageReportUrl } from "../../lib/machiningAPI";
import { ROLE_GUIDE, ROLE_ORDER } from "../../lib/roleGuide";
import { WORK_PURPOSES, type WorkPurpose } from "../../lib/purpose";
import { ENGINE_PART_LABEL, type EnginePartKey } from "../../lib/engineParts";

export interface MobileShellProps {
  userLabel: string;
  roleText: string;
  isAdmin: boolean;
  /** 관람객 주소: 입력은 체험(서버 저장 없음) */
  trial: boolean;
  /** 실제 작업자의 자기 업무 (관람객·관리자는 null) */
  ownPurpose: WorkPurpose | null;
  onLogout: () => void;

  inWorkspace: boolean;
  engineModel: EngineModelInfo | null;
  onEngineReady: (info: EngineModelInfo) => void;
  selection: EngineSelection;
  onSelect: (next: EngineSelection) => void;
  onOpenDrawing: (drawing: Drawing) => void;
  onBackTo3D: () => void;

  selectedDrawing: Drawing | null;
  siblingDrawings: Drawing[];
  document: OcrDocument | null;
  ocrStatus: string;
  revision?: string;
  resultUrl: string | null;
  points: OcrPoint[];
  activePoint?: OcrPoint;
  onSelectPoint: (id: number) => void;
  purpose: WorkPurpose;
  onPurpose: (next: WorkPurpose) => void;
  measurementRecords: Record<string, MeasurementRecord>;
  onMeasurementSaved: (record: SavedMeasurement) => void;
  reviewFiles: ReviewResultFile[];
  /** 관리자 검토 패널 (관리자 주소의 관리자만) */
  reviewPane: ReactNode | null;
  /** 관리자 '놓친 치수 추가' 위치 고르는 중 */
  picking: boolean;
  onPickAt: (position: { x: number; y: number }) => void;
  onCancelPick: () => void;
}

const formatTime = (value: string) => value?.replace("T", " ").slice(5, 16) ?? "";
const reviewed = (drawing: Drawing) => drawing.review_status === "reviewed";

/** 대표 도면: 검토 완료된 도면 중 가장 최근. 관리자는 검토 전 도면도 후보 (검토하러 연다). */
function sortDrawings(list: Drawing[]) {
  return [...list].sort((a, b) => Number(reviewed(b)) - Number(reviewed(a)) || b.created_at.localeCompare(a.created_at));
}

type WorkView = "drawing" | "task" | "review";

export function MobileShell(props: MobileShellProps) {
  const { selection, engineModel, isAdmin, trial } = props;
  const [parts, setParts] = useState<Part[] | null>(null);
  const [partsError, setPartsError] = useState("");
  const [drawingCache, setDrawingCache] = useState<Record<string, Drawing[]>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listPart, setListPart] = useState<string | null>(null);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [workView, setWorkView] = useState<WorkView>("drawing");
  const [trialStore, setTrialStore] = useState<TrialStore>({});

  useEffect(() => {
    fetchParts()
      .then((data) => setParts(data.parts))
      .catch((cause) => setPartsError(cause instanceof Error ? cause.message : "부품 조회 실패"));
  }, []);

  async function drawingsOf(partId: string) {
    if (drawingCache[partId]) return drawingCache[partId];
    const { drawings } = await fetchDrawings(partId);
    setDrawingCache((previous) => ({ ...previous, [partId]: drawings }));
    return drawings;
  }

  // 새 도면을 열면 도면 화면부터
  useEffect(() => {
    setWorkView("drawing");
  }, [props.selectedDrawing?.drawing_id]);

  const partName = (key: string | null) =>
    key ? engineModel?.parts.find((part) => part.key === key)?.name ?? ENGINE_PART_LABEL[key as EnginePartKey] ?? key : null;

  // ---------------------------------------------------------------- 3D 에서 고른 부품의 대표 도면
  const linkedParts = selection.engineKey ? (parts ?? []).filter((part) => part.engine_part_key === selection.engineKey) : [];
  const [candidates, setCandidates] = useState<{ key: string; loading: boolean; drawings: Drawing[]; error: string }>({ key: "", loading: false, drawings: [], error: "" });
  const candidateKey = `${selection.engineKey}:${linkedParts.map((part) => part.part_id).join(",")}`;
  useEffect(() => {
    if (!selection.engineKey || !linkedParts.length) {
      setCandidates({ key: candidateKey, loading: false, drawings: [], error: "" });
      return;
    }
    let alive = true;
    setCandidates({ key: candidateKey, loading: true, drawings: [], error: "" });
    Promise.all(linkedParts.map((part) => drawingsOf(part.part_id)))
      .then((lists) => alive && setCandidates({ key: candidateKey, loading: false, drawings: sortDrawings(lists.flat()), error: "" }))
      .catch((cause) => alive && setCandidates({ key: candidateKey, loading: false, drawings: [], error: cause instanceof Error ? cause.message : "도면 조회 실패" }));
    return () => {
      alive = false;
    };
  }, [candidateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const representative = candidates.drawings.find(reviewed) ?? (isAdmin ? candidates.drawings[0] : undefined);
  const partOf = (partId?: string) => (parts ?? []).find((part) => part.part_id === partId);

  // ================================================================ 작업 공간 (도면을 연 뒤)
  const drawing = props.selectedDrawing;
  const doc = props.document;
  if (props.inWorkspace && drawing) {
    const part = partOf(drawing.part_id);
    const title = part?.name ?? doc?.part_name ?? "도면";
    const docReviewed = doc?.review_status === "reviewed";
    const exportsOverlay = exportsOpen && (
      <ExportsOverlay files={props.reviewFiles} drawing={drawing} revision={props.revision} reviewed={docReviewed} onClose={() => setExportsOpen(false)} />
    );
    const othersOverlay = othersOpen && (
      <DrawingPicker
        title={`${title} · 도면 ${props.siblingDrawings.length}개`}
        drawings={sortDrawings(props.siblingDrawings)}
        currentId={drawing.drawing_id}
        isAdmin={isAdmin}
        onPick={(next) => {
          setOthersOpen(false);
          props.onOpenDrawing(next);
        }}
        onClose={() => setOthersOpen(false)}
      />
    );

    if (workView === "task" && doc && props.revision && docReviewed) {
      const purpose = props.purpose;
      const mode: WorkMode = trial ? "trial" : props.ownPurpose === purpose ? "save" : "view";
      const ownLabel = WORK_PURPOSES.find((entry) => entry.value === props.ownPurpose)?.label;
      const taskProps: TaskProps = {
        purpose,
        mode,
        viewReason: mode === "view" ? `${ownLabel ?? ""} 작업자는 ${ROLE_GUIDE[purpose].title} 결과를 조회만 합니다` : undefined,
        partName: title,
        drawing,
        document: doc,
        revision: props.revision,
        resultUrl: props.resultUrl,
        points: props.points,
        activePoint: props.activePoint,
        onSelectPoint: props.onSelectPoint,
        measurementRecords: props.measurementRecords,
        onMeasurementSaved: props.onMeasurementSaved,
        trial: trialStore,
        onTrial: (key: string, entry: TrialEntry) => setTrialStore((previous) => ({ ...previous, [key]: entry })),
        onBack: () => setWorkView("drawing"),
        onExports: () => setExportsOpen(true),
      };
      return (
        <>
          {purpose === "manufacturing" ? <ManufacturingTask key={`m-${drawing.drawing_id}`} {...taskProps} /> : <MeasureTask key={`${purpose}-${drawing.drawing_id}`} {...taskProps} />}
          {exportsOverlay}
        </>
      );
    }

    if (workView === "review" && isAdmin && props.reviewPane) {
      return (
        <>
          <div className="fixed inset-0 flex flex-col bg-dx-bg">
            <MobileTopBar
              title={`검토 · ${title}`}
              subtitle={`${formatTime(drawing.created_at)} 등록 · ${docReviewed ? "검토 완료" : "검토 전"}`}
              onBack={() => setWorkView("drawing")}
              backLabel="도면으로"
              right={<MenuButton label="기록 및 내보내기" onClick={() => setExportsOpen(true)} icon={<FileDown aria-hidden="true" className="h-5 w-5" />} />}
            />
            {props.picking && (
              <div className="flex shrink-0 items-center gap-2 bg-cyan-700 px-3 py-2 text-[13px] text-white">
                <span className="min-w-0 flex-1">추가할 치수 위치를 도면에서 누르세요</span>
                <button type="button" onClick={props.onCancelPick} className="rounded border border-white/40 px-2 py-1">취소</button>
              </div>
            )}
            <div className="relative h-[36dvh] min-h-[150px] shrink-0 border-b border-dx-line">
              {doc && (
                <MobileDrawingView
                  className="h-full"
                  url={props.resultUrl}
                  coordinateSize={{ width: doc.image.width_px, height: doc.image.height_px }}
                  points={props.points}
                  selectedId={props.activePoint?.id}
                  onSelect={props.picking ? undefined : props.onSelectPoint}
                  onPickAt={props.picking ? props.onPickAt : undefined}
                  focusOnStart
                />
              )}
            </div>
            {/* 검토 패널은 자체 하단 저장 영역(미확인 개수 표시)을 가진다 */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-white">{props.reviewPane}</div>
          </div>
          {exportsOverlay}
        </>
      );
    }

    // ---------------------------------------------------------------- 도면 + 업무 고르기
    return (
      <>
        <div className="fixed inset-0 flex flex-col bg-dx-bg">
          <MobileTopBar
            title={title}
            subtitle={`${partName(part?.engine_part_key ?? null) ?? "3D 미연결"} · ${formatTime(drawing.created_at)} 등록 · ${docReviewed ? "검토 완료" : doc ? "검토 전" : "OCR 결과 없음"}`}
            onBack={props.onBackTo3D}
            backLabel="3D 엔진으로"
            right={
              <>
                {props.siblingDrawings.length > 1 && (
                  <MenuButton label="같은 부품의 다른 도면" onClick={() => setOthersOpen(true)} icon={<Layers aria-hidden="true" className="h-5 w-5" />} />
                )}
                <MenuButton label="기록 및 내보내기" onClick={() => setExportsOpen(true)} icon={<FileDown aria-hidden="true" className="h-5 w-5" />} />
              </>
            }
          />
          <div className="relative min-h-[140px] flex-1">
            {doc ? (
              <MobileDrawingView
                className="h-full"
                url={props.resultUrl}
                coordinateSize={{ width: doc.image.width_px, height: doc.image.height_px }}
                points={props.points}
                toneOf={() => "todo"}
              />
            ) : (
              <p className="p-6 text-center text-[14px] text-dx-muted">{props.ocrStatus === "loading" ? "도면을 불러오는 중…" : "이 도면은 OCR 결과가 없어 측정 항목을 보여줄 수 없습니다."}</p>
            )}
          </div>
          <section aria-label="업무 고르기" className="shrink-0 border-t border-dx-line bg-dx-panel px-3 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            {isAdmin ? (
              <>
                <p className="mb-2 text-[13px] text-dx-text">
                  {docReviewed ? "검토 완료된 도면입니다. 항목을 다시 확인하거나 고칠 수 있습니다." : "OCR 추출값을 항목별로 확인한 뒤 검토 완료로 저장하세요."}
                </p>
                <button type="button" disabled={!props.reviewPane} onClick={() => setWorkView("review")} className="h-12 w-full rounded-lg bg-[#22c3dc] text-[15px] font-semibold text-[#04212b] disabled:opacity-40">
                  {props.reviewPane ? "항목 검토 시작" : "OCR 결과를 불러오는 중…"}
                </button>
              </>
            ) : !docReviewed ? (
              <p className="pb-1 text-[14px] leading-relaxed text-dx-text">
                {doc ? "관리자 검토가 끝나지 않은 도면이라 업무 체험에 쓸 수 없습니다." : "측정 항목이 없는 도면입니다."}{" "}
                {props.siblingDrawings.some(reviewed) ? (
                  <button type="button" className="font-semibold text-dx-accent underline" onClick={() => setOthersOpen(true)}>검토 완료 도면 고르기</button>
                ) : (
                  <button type="button" className="font-semibold text-dx-accent underline" onClick={props.onBackTo3D}>다른 부품 고르기</button>
                )}
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-white">어떤 업무로 이 도면을 볼까요?</h2>
                  {trial && <ModeBadge mode="trial" />}
                </div>
                <div className="grid gap-2 [@media(max-height:500px)]:grid-cols-3">
                  {ROLE_ORDER.map((key) => {
                    const guide = ROLE_GUIDE[key];
                    const view = !trial && props.ownPurpose !== key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          props.onPurpose(key);
                          setWorkView("task");
                        }}
                        className="flex items-center gap-3 rounded-lg border border-dx-line-strong bg-dx-bg px-3 py-2.5 text-left active:bg-white/5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[15px] font-semibold text-white">
                            {guide.title}
                            <span className="text-[12px] font-normal text-dx-accent">{guide.short}</span>
                            {view && <span className="rounded border border-dx-line px-1 text-[11px] font-normal text-dx-muted">조회만</span>}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-dx-muted [@media(max-height:500px)]:hidden">{guide.summary}</span>
                        </span>
                        <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-dx-muted" />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
        {exportsOverlay}
        {othersOverlay}
      </>
    );
  }

  // ================================================================ 3D 엔진 (첫 화면)
  const selectedName = partName(selection.engineKey);
  return (
    <>
      <div className="fixed inset-0 flex flex-col bg-dx-bg">
        <MobileTopBar
          title={selectedName ?? engineModel?.title ?? "엔진 3D"}
          subtitle={selectedName ? engineModel?.title : `${props.userLabel} · ${props.roleText}`}
          onBack={selection.engineKey ? () => props.onSelect({ engineKey: null, partId: null, drawingId: null }) : undefined}
          backLabel="선택 해제"
          right={<MenuButton label="메뉴" onClick={() => setMenuOpen(true)} icon={<Menu aria-hidden="true" className="h-5 w-5" />} />}
        />
        <div className="relative flex min-h-0 flex-1">
          <EngineViewer3D
            visible
            compact
            selectedKey={selection.engineKey}
            onSelect={(key) => props.onSelect({ engineKey: key, partId: null, drawingId: null })}
            onReady={props.onEngineReady}
          />
          {!selection.engineKey && (
            <p className="pointer-events-none absolute inset-x-0 bottom-4 z-20 mx-auto w-fit max-w-[90%] rounded-full bg-dx-panel/95 px-4 py-2 text-center text-[14px] font-medium text-white shadow-lg" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
              부품을 눌러 도면을 확인하세요
            </p>
          )}
        </div>
        {selection.engineKey && (
          <section aria-label="선택한 부품" className="shrink-0 border-t border-dx-line bg-dx-panel px-4 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            <div className="flex items-baseline gap-2">
              <h2 className="text-[17px] font-semibold text-white">{selectedName}</h2>
              <span className="min-w-0 truncate text-[12px] text-dx-muted">
                {linkedParts.length ? linkedParts.map((part) => part.name).join(", ") : "등록 부품 연결 없음"}
              </span>
            </div>
            {!parts || candidates.key !== candidateKey || candidates.loading ? (
              <p className="py-3 text-[14px] text-dx-muted">도면 찾는 중…</p>
            ) : candidates.error ? (
              <p className="py-3 text-[14px] text-rose-300">{candidates.error}</p>
            ) : representative ? (
              <>
                <p className="mt-1 text-[13px] text-dx-text">
                  대표 도면 {representative.original_filename} · {formatTime(representative.created_at)} · {reviewed(representative) ? "검토 완료" : "검토 전"}
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" onClick={() => props.onOpenDrawing(representative)} className="h-12 min-w-0 flex-1 rounded-lg bg-[#22c3dc] text-[15px] font-semibold text-[#04212b]">
                    대표 도면 열기
                  </button>
                  {candidates.drawings.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setListPart(linkedParts[0]?.part_id ?? null);
                        setListOpen(true);
                      }}
                      className="h-12 shrink-0 rounded-lg border border-dx-line-strong px-3 text-[14px] text-white"
                    >
                      다른 도면 {candidates.drawings.length - 1}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="py-2 text-[14px] leading-relaxed text-dx-text">
                {!linkedParts.length
                  ? "이 3D 부품에 연결된 등록 부품이 없어 보여줄 도면이 없습니다."
                  : !candidates.drawings.length
                    ? "연결된 부품에 등록된 도면이 없습니다."
                    : "관리자 검토가 끝난 도면이 아직 없습니다."}{" "}
                다른 부품을 눌러보세요.
              </p>
            )}
          </section>
        )}
      </div>

      {menuOpen && (
        <MobileOverlay title="메뉴" onClose={() => setMenuOpen(false)}>
          <nav className="divide-y divide-dx-line">
            <MenuRow icon={<ListTree className="h-5 w-5" />} label="부품·도면 목록" detail="3D 부품별 등록 부품과 도면" onClick={() => { setMenuOpen(false); setListPart(null); setListOpen(true); }} />
            <MenuRow icon={<Box className="h-5 w-5" />} label="3D 엔진 처음 보기" detail="선택 해제" onClick={() => { setMenuOpen(false); props.onSelect({ engineKey: null, partId: null, drawingId: null }); }} />
            <MenuRow icon={<LogOut className="h-5 w-5" />} label="처음 화면으로" detail={`${props.userLabel} · ${props.roleText}`} onClick={() => { setMenuOpen(false); props.onLogout(); }} />
          </nav>
          {trial && <p className="px-4 py-3 text-[13px] leading-relaxed text-dx-muted">관람객 체험 주소입니다. 입력한 값은 서버에 저장되지 않습니다. 부품 연결·도면 등록·검토 같은 관리자 기능은 관리자 주소에서 사용합니다.</p>}
        </MobileOverlay>
      )}

      {listOpen && (
        <PartBrowser
          parts={parts}
          error={partsError}
          partName={partName}
          modelKeys={engineModel?.parts.map((part) => part.key) ?? Object.keys(ENGINE_PART_LABEL)}
          initialPart={listPart}
          drawingsOf={drawingsOf}
          isAdmin={isAdmin}
          onOpen={(next) => {
            setListOpen(false);
            props.onOpenDrawing(next);
          }}
          onClose={() => setListOpen(false)}
        />
      )}
    </>
  );
}

function MenuRow({ icon, label, detail, onClick }: { icon: ReactNode; label: string; detail?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-white/5">
      <span aria-hidden="true" className="text-dx-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-white">{label}</span>
        {detail && <span className="block truncate text-[12px] text-dx-muted">{detail}</span>}
      </span>
      <ChevronRight aria-hidden="true" className="h-5 w-5 text-dx-muted" />
    </button>
  );
}

function DrawingRow({ drawing, mark, isAdmin, current, onPick }: { drawing: Drawing; mark?: string; isAdmin: boolean; current?: boolean; onPick: (d: Drawing) => void }) {
  const usable = reviewed(drawing) || isAdmin;
  return (
    <li>
      <button
        type="button"
        disabled={!usable || current}
        onClick={() => onPick(drawing)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5 disabled:opacity-55"
      >
        <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-dx-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-white">
            {drawing.original_filename}
            {mark && <span className="ml-1.5 rounded bg-dx-accent/15 px-1 text-[11px] text-dx-accent">{mark}</span>}
            {current && <span className="ml-1.5 text-[11px] text-dx-muted">보는 중</span>}
          </span>
          <span className="block text-[12px] text-dx-muted">
            {formatTime(drawing.created_at)} 등록 · {reviewed(drawing) ? "검토 완료" : drawing.ocr_revision ? "검토 전" : "OCR 없음"}
            {!usable && " · 업무 체험 불가"}
          </span>
        </span>
        {usable && !current && <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-dx-muted" />}
      </button>
    </li>
  );
}

function DrawingPicker({ title, drawings, currentId, isAdmin, onPick, onClose }: { title: string; drawings: Drawing[]; currentId: string; isAdmin: boolean; onPick: (d: Drawing) => void; onClose: () => void }) {
  return (
    <MobileOverlay title={title} onClose={onClose}>
      <ul className="divide-y divide-dx-line">
        {drawings.map((drawing, index) => (
          <DrawingRow key={drawing.drawing_id} drawing={drawing} mark={index === 0 && reviewed(drawing) ? "대표" : undefined} isAdmin={isAdmin} current={drawing.drawing_id === currentId} onPick={onPick} />
        ))}
      </ul>
    </MobileOverlay>
  );
}

/** 부품 고르기 → 그 부품의 도면 목록 (한 화면 안에서 이어진다) */
function PartBrowser({
  parts,
  error,
  partName,
  modelKeys,
  initialPart,
  drawingsOf,
  isAdmin,
  onOpen,
  onClose,
}: {
  parts: Part[] | null;
  error: string;
  partName: (key: string | null) => string | null;
  modelKeys: string[];
  initialPart: string | null;
  drawingsOf: (partId: string) => Promise<Drawing[]>;
  isAdmin: boolean;
  onOpen: (drawing: Drawing) => void;
  onClose: () => void;
}) {
  const [partId, setPartId] = useState<string | null>(initialPart);
  const [drawings, setDrawings] = useState<{ partId: string; list: Drawing[] | null; error: string }>({ partId: "", list: null, error: "" });
  useEffect(() => {
    if (!partId) return;
    setDrawings({ partId, list: null, error: "" });
    drawingsOf(partId)
      .then((list) => setDrawings({ partId, list: sortDrawings(list), error: "" }))
      .catch((cause) => setDrawings({ partId, list: [], error: cause instanceof Error ? cause.message : "도면 조회 실패" }));
  }, [partId]); // eslint-disable-line react-hooks/exhaustive-deps

  const part = parts?.find((entry) => entry.part_id === partId);
  if (part) {
    return (
      <MobileOverlay title={`${part.name} · 도면`} onClose={onClose}>
        <button type="button" onClick={() => setPartId(null)} className="flex w-full items-center gap-1 border-b border-dx-line px-4 py-3 text-left text-[14px] text-dx-accent">
          ‹ 부품 목록
        </button>
        {drawings.list === null ? (
          <p className="p-4 text-[14px] text-dx-muted">도면 불러오는 중…</p>
        ) : drawings.error ? (
          <p className="p-4 text-[14px] text-rose-300">{drawings.error}</p>
        ) : !drawings.list.length ? (
          <p className="p-4 text-[14px] text-dx-muted">등록된 도면이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-dx-line">
            {drawings.list.map((drawing, index) => (
              <DrawingRow key={drawing.drawing_id} drawing={drawing} mark={index === 0 && reviewed(drawing) ? "대표" : undefined} isAdmin={isAdmin} onPick={onOpen} />
            ))}
          </ul>
        )}
      </MobileOverlay>
    );
  }

  const groups = [
    ...modelKeys.map((key) => ({ key, label: partName(key) ?? key, parts: (parts ?? []).filter((entry) => entry.engine_part_key === key) })),
    { key: "none", label: "3D 미연결 부품", parts: (parts ?? []).filter((entry) => !entry.engine_part_key) },
  ];
  return (
    <MobileOverlay title="부품·도면 목록" onClose={onClose}>
      {error && <p className="p-4 text-[14px] text-rose-300">{error}</p>}
      {!parts && !error && <p className="p-4 text-[14px] text-dx-muted">부품 불러오는 중…</p>}
      {parts &&
        groups.map((group) => (
          <section key={group.key} className="border-b border-dx-line">
            <h3 className="bg-dx-panel px-4 py-2 text-[12px] font-semibold text-dx-muted">{group.label}</h3>
            {group.parts.length ? (
              <ul className="divide-y divide-dx-line">
                {group.parts.map((entry) => (
                  <li key={entry.part_id}>
                    <button type="button" onClick={() => setPartId(entry.part_id)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5">
                      <span className="min-w-0 flex-1 truncate text-[15px] text-white">{entry.name}</span>
                      <span className="shrink-0 text-[13px] text-dx-muted">도면 {entry.drawing_count}</span>
                      <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-dx-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-2.5 text-[13px] text-dx-faint">연결된 등록 부품 없음</p>
            )}
          </section>
        ))}
    </MobileOverlay>
  );
}

/** TXT·JSON·CSV·검수 기록·결과 이미지 — 작업 화면 상단을 차지하지 않도록 한곳에 */
function ExportsOverlay({ files, drawing, revision, reviewed: isReviewed, onClose }: { files: ReviewResultFile[]; drawing: Drawing; revision?: string; reviewed: boolean; onClose: () => void }) {
  return (
    <MobileOverlay title="기록 및 내보내기" onClose={onClose}>
      {!isReviewed ? (
        <p className="p-4 text-[14px] leading-relaxed text-dx-muted">검수 결과 파일은 관리자 검토 완료 때 만들어집니다.</p>
      ) : (
        <ul className="divide-y divide-dx-line">
          {files.map((file) => (
            <li key={file.kind}>
              <a href={apiUrl(file.url)} target="_blank" rel="noreferrer" download={file.kind === "history_csv" ? true : undefined} className="flex items-center gap-3 px-4 py-4 text-[15px] text-white active:bg-white/5">
                <FileDown aria-hidden="true" className="h-5 w-5 text-dx-accent" />
                <span className="min-w-0 flex-1">{file.label}</span>
              </a>
            </li>
          ))}
          {revision && (
            <li>
              <a href={stageReportUrl(drawing.drawing_id, revision)} download className="flex items-center gap-3 px-4 py-4 text-[15px] text-white active:bg-white/5">
                <FileDown aria-hidden="true" className="h-5 w-5 text-dx-accent" />
                <span className="min-w-0 flex-1">부품제작 자주검사 성적서 (서버 저장 기록 기준)</span>
              </a>
            </li>
          )}
          {!files.length && <li className="p-4 text-[14px] text-dx-muted">결과 파일을 불러오는 중이거나 없습니다.</li>}
        </ul>
      )}
    </MobileOverlay>
  );
}

