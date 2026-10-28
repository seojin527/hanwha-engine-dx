/**
 * ENGINE DX 셸의 공통 틀: 왼쪽 메뉴 레일 · 상단 바 · 도면 작업 중 맥락 머리글.
 * 화면 상태와 이동 판단(미저장 확인 등)은 App 이 맡고, 여기서는 표시와 클릭 전달만 한다.
 */
import type { ReactNode } from "react";
import { Activity, Box, ChevronRight, Database, FileStack, LogOut, PenTool, Ruler, Search } from "lucide-react";
import type { Drawing } from "../../lib/drawingAPI";
import { StatusText, reviewLabel } from "./EngineExplorerPanel";

export type ShellView = "engine" | "drawing" | "library" | "progress" | "errors";

const ITEMS: { view: ShellView; label: string; icon: typeof Box; adminOnly?: boolean }[] = [
  { view: "engine", label: "3D 엔진 탐색", icon: Box },
  { view: "drawing", label: "도면 작업", icon: PenTool },
  { view: "library", label: "부품·도면 목록", icon: FileStack },
  { view: "progress", label: "작업 진행 현황", icon: Activity, adminOnly: true },
  { view: "errors", label: "오류 DB 관리", icon: Database, adminOnly: true },
];

export function ShellRail({
  view,
  isAdmin,
  drawingAvailable,
  onNavigate,
  onLogout,
  compact = false,
}: {
  view: ShellView;
  isAdmin: boolean;
  drawingAvailable: boolean;
  onNavigate: (view: ShellView) => void;
  onLogout: () => void;
  /** 휴대폰: 상단 바 안에 가로로 아이콘만 둔다 */
  compact?: boolean;
}) {
  return (
    <nav
      aria-label="주요 기능"
      className={compact ? "dx-rail-row flex shrink-0 items-center gap-0.5" : "flex w-14 shrink-0 flex-col items-center gap-1 border-r border-dx-line bg-dx-bg py-2"}
    >
      {!compact && (
        <span aria-hidden="true" className="mb-2 flex h-9 w-9 items-center justify-center rounded bg-dx-accent-strong text-white">
          <Ruler className="h-4 w-4" />
        </span>
      )}
      {ITEMS.filter((item) => !item.adminOnly || isAdmin).map(({ view: key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          title={key === "drawing" && !drawingAvailable ? `${label} (먼저 도면을 열어주세요)` : label}
          aria-label={label}
          aria-current={view === key ? "page" : undefined}
          disabled={key === "drawing" && !drawingAvailable}
          onClick={() => onNavigate(key)}
          className="dx-rail-btn"
        >
          <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
      ))}
      {!compact && <span className="flex-1" />}
      <button type="button" title="로그아웃 (처음 화면)" aria-label="로그아웃" onClick={onLogout} className="dx-rail-btn">
        <LogOut aria-hidden="true" className="h-[18px] w-[18px]" />
      </button>
    </nav>
  );
}

export function ShellTopBar({
  path,
  userLabel,
  roleLabel,
  search,
  nav,
}: {
  /** 현재 대상 경로 (엔진 › 부품 › 도면) */
  path: { label: string; onClick?: () => void }[];
  userLabel: string;
  roleLabel: string;
  /** 도면 작업 중 측정항목 검색 (다른 화면에서는 없음) */
  search?: { value: string; onChange: (value: string) => void };
  /** 휴대폰: 메뉴 레일 대신 상단 바에 넣는 아이콘 메뉴. 있으면 경로는 마지막 항목만, 사용자 표시는 줄인다 */
  nav?: ReactNode;
}) {
  if (nav) {
    const current = path[path.length - 1];
    const back = [...path].reverse().find((entry) => entry.onClick);
    return (
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-dx-line bg-dx-panel pl-3 pr-1" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="min-w-0 flex-1">
          {back && back !== current ? (
            <button type="button" onClick={back.onClick} className="block max-w-full truncate text-[11px] text-dx-muted">
              ‹ {back.label}
            </button>
          ) : (
            <p className="text-[11px] font-semibold tracking-tight text-dx-muted">ENGINE DX · {roleLabel}</p>
          )}
          <p className="truncate text-[13px] font-semibold text-white">{current?.label}</p>
        </div>
        {nav}
      </header>
    );
  }
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-dx-line bg-dx-panel px-4">
      <p className="shrink-0 text-[13px] font-semibold tracking-tight text-white">
        ENGINE DX <span className="ml-1 hidden font-normal text-dx-muted xl:inline">도면 측정 가이드</span>
      </p>
      <span aria-hidden="true" className="h-4 w-px bg-dx-line" />
      <nav aria-label="현재 대상" className="flex min-w-0 flex-1 items-center gap-1 text-xs">
        {path.map((entry, index) => (
          <span key={index} className={`flex min-w-0 items-center gap-1 ${index === path.length - 1 ? "shrink-0 max-w-[45%]" : "max-w-[30%]"}`}>
            {index > 0 && <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-dx-faint" />}
            {entry.onClick ? (
              <button type="button" onClick={entry.onClick} className="truncate rounded px-1 text-dx-muted hover:text-white focus-visible:outline-2 focus-visible:outline-dx-accent">
                {entry.label}
              </button>
            ) : (
              <span className={`truncate px-1 ${index === path.length - 1 ? "font-medium text-white" : "text-dx-muted"}`}>{entry.label}</span>
            )}
          </span>
        ))}
      </nav>
      {search && (
        <label className="relative hidden w-44 md:block xl:w-56">
          <span className="sr-only">측정항목 검색</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dx-faint" />
          <input
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder="번호·규격 검색"
            className="dx-input h-7 py-1 pl-7"
          />
        </label>
      )}
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <span className="max-w-[160px] truncate text-dx-text">{userLabel}</span>
        <span className="rounded border border-dx-line-strong px-1.5 py-0.5 text-[11px] text-dx-muted">{roleLabel}</span>
        <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-200" title="서버 인증이 없는 시연용 로그인입니다">
          시연 로그인
        </span>
      </div>
    </header>
  );
}

/** 도면 작업 중 왼쪽 작업 패널 위: 현재 엔진·부품·도면, 같은 부품의 다른 도면으로 이동, 3D 복귀 */
export function DrawingContextHeader({
  enginePartName,
  partName,
  drawing,
  revision,
  reviewed,
  siblings,
  onSwitchDrawing,
  onBackTo3D,
  extra,
}: {
  enginePartName: string | null;
  partName: string;
  drawing: Drawing;
  revision?: string;
  reviewed: boolean;
  siblings: Drawing[];
  onSwitchDrawing: (drawing: Drawing) => void;
  onBackTo3D: () => void;
  extra?: ReactNode;
}) {
  const review = reviewed ? { text: "검토 완료", tone: "ok" as const } : reviewLabel({ review_status: revision ? "pending" : null, ocr_status: drawing.ocr_status });
  return (
    <div className="shrink-0 space-y-2 border-b border-dx-line bg-dx-panel px-3 py-2.5 text-xs text-dx-text">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-dx-faint">
            {enginePartName ? `${enginePartName} › ` : "3D 미연결 › "}
            {partName}
          </p>
          <p className="truncate text-[13px] font-semibold text-white">{drawing.original_filename || drawing.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-dx-muted">
            {revision ? <span className="font-mono" title="OCR 결과 버전 (도면 개정 번호가 아님)">OCR v.{revision.slice(0, 6)}</span> : <span>OCR 결과 없음</span>}
            <StatusText tone={review.tone}>{review.text}</StatusText>
          </p>
        </div>
        <button type="button" onClick={onBackTo3D} className="dx-btn shrink-0">
          <Box aria-hidden="true" className="h-3.5 w-3.5" />
          3D로
        </button>
      </div>
      {siblings.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-dx-muted">같은 부품 도면</span>
          <select
            className="dx-input h-7 py-0.5"
            value={drawing.drawing_id}
            onChange={(event) => {
              const next = siblings.find((entry) => entry.drawing_id === event.target.value);
              if (next) onSwitchDrawing(next);
            }}
          >
            {siblings.map((entry) => (
              <option key={entry.drawing_id} value={entry.drawing_id}>
                {(entry.original_filename || entry.name) + ` · ${entry.created_at?.slice(0, 10)} · ${reviewLabel(entry).text}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {extra}
    </div>
  );
}
