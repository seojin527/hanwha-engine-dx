import { useState, type ReactNode } from "react";
import { ArrowRight, ExternalLink, FileText, Loader2 } from "lucide-react";
import { drawingFileUrl, drawingThumbnailUrl, type Drawing } from "../../lib/drawingAPI";
type Tone = "ok" | "warn" | "bad" | "info" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-400/40 bg-emerald-400/10 text-emerald-700",
  warn: "border-amber-400/40 bg-amber-400/10 text-amber-700",
  bad: "border-rose-400/40 bg-rose-400/10 text-rose-700",
  info: "border-cyan-400/40 bg-cyan-400/10 text-cyan-700",
  muted: "border-dx-line bg-dx-raised text-dx-muted",
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
    <span title={title} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 py-px text-sm font-medium leading-4 ${TONE_CLASS[tone]}`}>
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
export function DrawingThumb(props: { drawing: Drawing; size?: "sm" | "lg"; className?: string }) {
  return <DrawingThumbImage key={`${props.drawing.drawing_id}:${props.size ?? "sm"}`} {...props} />;
}

function DrawingThumbImage({ drawing, size = "sm", className = "" }: { drawing: Drawing; size?: "sm" | "lg"; className?: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

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
  /** true: 넓지 않은 화면에서는 썸네일을 왼쪽에 둔 가로 배치 */
  wide?: boolean;
}) {
  const name = drawing.original_filename || drawing.name;
  const review = reviewState(drawing);
  return (
    <div className={`flex min-h-0 flex-col gap-2 ${wide ? "sm:flex-row sm:items-start sm:gap-3" : ""}`}>
      <a
        href={drawingFileUrl(drawing)}
        target="_blank"
        rel="noreferrer"
        title="원본을 새 탭에서 보기"
        className={`block shrink-0 overflow-hidden rounded border border-dx-line ${wide ? "sm:w-[220px]" : ""}`}
      >
        <DrawingThumb drawing={drawing} size="lg" className="aspect-[1.414] w-full" />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-all text-[13px] font-semibold leading-snug text-dx-strong">{name}</p>
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
