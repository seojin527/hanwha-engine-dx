/**
 * 도면 탐색 화면(3D 왼쪽 패널 · 부품·도면 선택)이 함께 쓰는 조각.
 * - 상태 배지: OCR 상태(drawings.ocr_status)와 관리자 검토 상태(OCR 결과의 review_status)를 따로 보여준다.
 *   검토 상태는 실제 저장값만 쓴다: 'reviewed' → 검토 완료, 그 밖(검토 전 저장·OCR 결과 없음) → 검토 전. '검토 중'은 저장되지 않는다.
 * - 썸네일: 서버가 원본 첫 페이지로 만든 PNG (OCR 실행 없음). 화면에 보일 때만 불러온다.
 * - 삭제: 기존 소프트 삭제 API. 목록에서 숨길 뿐 파일·OCR·측정 기록은 서버에 남는다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ExternalLink, FileText, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import {
  deleteDrawing,
  drawingFileUrl,
  drawingThumbnailUrl,
  fetchDeleteImpact,
  type Drawing,
  type DrawingDeleteImpact,
} from "../../lib/drawingAPI";

type Tone = "ok" | "warn" | "bad" | "info" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  warn: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  bad: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  info: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  muted: "border-white/15 bg-white/5 text-dx-muted",
};

const OCR_STATE: Record<string, { label: string; tone: Tone }> = {
  not_started: { label: "OCR 미실행", tone: "muted" },
  queued: { label: "OCR 대기", tone: "muted" },
  running: { label: "OCR 처리 중", tone: "info" },
  completed: { label: "OCR 완료", tone: "ok" },
  failed: { label: "OCR 실패", tone: "bad" },
};

export function ocrState(drawing: Pick<Drawing, "ocr_status">) {
  return OCR_STATE[drawing.ocr_status] ?? { label: drawing.ocr_status ? `OCR ${drawing.ocr_status}` : "OCR 미실행", tone: "muted" as Tone };
}

/** 관리자 검토 상태. OCR 결과가 없으면 검토할 수 없으므로 '검토 전'을 흐리게 보여주고 이유를 붙인다. */
export function reviewState(drawing: Pick<Drawing, "ocr_status" | "review_status">) {
  if (drawing.review_status === "reviewed") return { label: "검토 완료", tone: "ok" as Tone, hint: "" };
  const hasResult = !!drawing.review_status || drawing.ocr_status === "completed";
  return {
    label: "검토 전",
    tone: (hasResult ? "warn" : "muted") as Tone,
    hint: hasResult ? "관리자 검토가 끝나야 작업자가 측정을 저장할 수 있습니다." : "OCR 결과가 있어야 관리자 검토를 할 수 있습니다.",
  };
}

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 py-px text-[10.5px] font-medium leading-4 ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/** OCR · 관리자 검토 배지 두 개 (항상 함께, 같은 기준) */
export function StatusBadges({ drawing }: { drawing: Pick<Drawing, "ocr_status" | "review_status"> }) {
  const ocr = ocrState(drawing);
  const review = reviewState(drawing);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={ocr.tone} title="OCR 상태">{ocr.label}</Badge>
      <Badge tone={review.tone} title={review.hint || "관리자 검토 상태"}>{review.label}</Badge>
    </span>
  );
}

/** 도면 첫 페이지 썸네일. 실패하면 문서 아이콘으로 대신한다. */
export function DrawingThumb({ drawing, size = "sm", className = "" }: { drawing: Drawing; size?: "sm" | "lg"; className?: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => setState("loading"), [drawing.drawing_id, size]);
  return (
    <span className={`relative flex items-center justify-center overflow-hidden bg-white/[0.04] ${className}`}>
      {state !== "error" && (
        <img
          src={drawingThumbnailUrl(drawing, size)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
          className={`h-full w-full bg-white object-contain transition-opacity ${state === "ready" ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {state === "loading" && <Loader2 aria-hidden="true" className="absolute h-4 w-4 animate-spin text-dx-faint" />}
      {state === "error" && (
        <span className="flex flex-col items-center gap-1 text-[10px] text-dx-faint">
          <FileText aria-hidden="true" className="h-5 w-5" />
          미리보기 없음
        </span>
      )}
    </span>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** 도면별 ⋯ 메뉴. 바깥을 누르거나 Esc 로 닫는다. */
export function DrawingMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <span ref={root} className="relative shrink-0" onDoubleClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} 메뉴`}
        title="더 보기"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="dx-btn dx-btn-ghost dx-icon-btn h-7"
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <span role="menu" className="absolute right-0 top-full z-30 mt-1 flex min-w-[140px] flex-col rounded-md border border-dx-line-strong bg-dx-panel py-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              className={`flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-white/5 ${item.danger ? "text-rose-300" : "text-dx-text"}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** 삭제 확인: 파일명과 영향(소프트 삭제 · 남는 기록)을 보여준다. 성공하면 onDeleted. */
export function DeleteDrawingDialog({ drawing, onCancel, onDeleted }: { drawing: Drawing; onCancel: () => void; onDeleted: (drawing: Drawing) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [impact, setImpact] = useState<DrawingDeleteImpact | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const name = drawing.original_filename || drawing.name;

  useEffect(() => {
    dialog.current?.showModal();
    const controller = new AbortController();
    fetchDeleteImpact(drawing.drawing_id, controller.signal)
      .then((data) => !controller.signal.aborted && setImpact(data))
      .catch((cause: unknown) => !controller.signal.aborted && setError(cause instanceof Error ? cause.message : "영향 확인 실패"));
    return () => controller.abort();
  }, [drawing.drawing_id]);

  async function confirm() {
    setDeleting(true);
    setError("");
    try {
      await deleteDrawing(drawing.drawing_id);
      onDeleted(drawing);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "삭제 실패");
      setDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="delete-drawing-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onCancel();
      }}
      className="fixed inset-0 m-auto w-[min(460px,92vw)] rounded-md border border-dx-line-strong bg-dx-panel p-0 text-dx-text shadow-2xl backdrop:bg-black/60"
    >
      <div className="space-y-3 p-4 text-xs">
        <h2 id="delete-drawing-title" className="text-[14px] font-semibold text-white">도면 삭제</h2>
        <p className="break-all">
          <b className="text-white">{name}</b> 을(를) 목록에서 삭제합니다.
        </p>
        <ul className="list-disc space-y-1 rounded border border-dx-line bg-dx-raised py-2 pl-6 pr-3 text-dx-muted">
          <li>부품의 도면 목록·개수·미리보기에서 바로 사라지고, 작업자는 더 이상 이 도면을 열 수 없습니다.</li>
          <li>원본 파일과 OCR 결과·검토·측정 기록은 서버에 그대로 보관됩니다 (영구 삭제 아님).</li>
          {impact && (
            <li>
              보관되는 기록: OCR {impact.has_ocr ? (impact.review_status === "reviewed" ? "결과 · 검토 완료" : "결과 · 검토 전") : "없음"} · 측정 기록 {impact.measurement_records}건 · 오류사례 연결 {impact.case_links}건
            </li>
          )}
          {impact?.review_status === "reviewed" && <li>검토 완료 도면입니다. 이 도면이 대표 도면이었다면 다음으로 최근 검토 완료된 도면이 대표가 됩니다.</li>}
        </ul>
        {!impact && !error && <p role="status" className="flex items-center gap-1.5 text-dx-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />영향을 확인하는 중…</p>}
        {impact?.ocr_active && <p role="alert" className="text-amber-200">OCR 대기·실행 중이라 지금은 삭제할 수 없습니다. 끝난 뒤 다시 시도해주세요.</p>}
        {error && <p role="alert" className="flex items-start gap-1.5 text-rose-300"><AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="dx-btn" disabled={deleting} onClick={onCancel}>취소</button>
          <button
            type="button"
            className="dx-btn border-rose-400/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
            disabled={deleting || !impact || impact.ocr_active}
            onClick={() => void confirm()}
          >
            {deleting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />삭제 중…</> : <><Trash2 className="h-3.5 w-3.5" />목록에서 삭제</>}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatType(mediaType: string) {
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType.startsWith("image/")) return mediaType.slice(6).toUpperCase();
  return mediaType || "—";
}

export { formatSize };

/** 도면 미리보기 본문: 첫 페이지 · 파일명 · 상태 배지 · 작업 시작. 작업 화면으로 이동하지 않는다. */
export function DrawingPreview({
  drawing,
  partName,
  onStart,
  menu,
  wide = false,
}: {
  drawing: Drawing;
  partName?: string;
  onStart: (drawing: Drawing) => void;
  menu?: ReactNode;
  /** true: 넓지 않은 화면에서는 썸네일을 왼쪽에 둔 가로 배치 (2xl 부터 세로) */
  wide?: boolean;
}) {
  const name = drawing.original_filename || drawing.name;
  const review = reviewState(drawing);
  return (
    <div className={`flex min-h-0 flex-col gap-2 ${wide ? "sm:flex-row sm:items-start sm:gap-3 2xl:flex-col 2xl:gap-2" : ""}`}>
      <a
        href={drawingFileUrl(drawing)}
        target="_blank"
        rel="noreferrer"
        title="원본을 새 탭에서 보기"
        className={`block shrink-0 overflow-hidden rounded border border-dx-line ${wide ? "sm:w-[220px] 2xl:w-full" : ""}`}
      >
        <DrawingThumb drawing={drawing} size="lg" className="aspect-[1.414] w-full" />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-all text-[13px] font-semibold leading-snug text-white">{name}</p>
          <p className="mt-0.5 text-[11px] text-dx-muted">
            {partName ? `${partName} · ` : ""}
            {formatType(drawing.media_type)} · {formatSize(drawing.size_bytes)} · {drawing.created_at?.slice(0, 16)}
          </p>
        </div>
        {menu}
      </div>
      <StatusBadges drawing={drawing} />
      {review.hint && <p className="text-[11px] text-dx-muted">{review.hint}</p>}
      <div className="flex gap-2 pt-0.5">
        <button type="button" className="dx-btn dx-btn-primary flex-1 justify-center" onClick={() => onStart(drawing)}>
          작업 시작
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <a href={drawingFileUrl(drawing)} target="_blank" rel="noreferrer" className="dx-btn" title="원본 파일을 새 탭에서 엽니다">
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          원본
        </a>
      </div>
      </div>
    </div>
  );
}
