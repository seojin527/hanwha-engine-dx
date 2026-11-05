/**
 * 선택한 부품에 도면 등록 (기존 업로드 API: POST /api/parts/{part_id}/drawings).
 * - 등록 대상(3D 부품 종류 · 등록 부품)을 계속 보여준다.
 * - 진행률 · 취소 · 실패 후 재시도. 성공하면 부모가 목록을 새로 고치고 등록한 도면을 연다.
 * - 도면 번호·개정 입력란은 두지 않는다: 현재 데이터 모델(drawings)에 해당 필드가 없다. 파일명이 도면 이름이 된다.
 * - OCR 은 자동 OCR 서버(app_auto)로 실행 중이면 업로드 직후 시작되고, 아니면 도면 화면의 「OCR 실행」으로 시작한다.
 */
import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, RotateCw, X, XCircle } from "lucide-react";
import { uploadDrawingWithProgress, type Drawing, type Part } from "../../lib/drawingAPI";
import { useReportUnsaved } from "../../lib/unsavedChanges";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".png,.jpg,.jpeg,.pdf";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; loaded: number; total: number }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" }
  | { kind: "done"; drawing: Drawing };

export function RegisterDrawingPanel({
  engineName,
  part,
  onUploaded,
  onClose,
}: {
  /** 3D 부품 종류 이름 (3D와 연결되지 않은 부품이면 null) */
  engineName: string | null;
  part: Part;
  onUploaded: (drawing: Drawing) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<(() => void) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  useReportUnsaved(!!file && state.kind !== "done");

  function choose(next: File | null) {
    setState({ kind: "idle" });
    setFileError("");
    if (!next) return setFile(null);
    const extension = next.name.toLowerCase().slice(next.name.lastIndexOf("."));
    if (![".png", ".jpg", ".jpeg", ".pdf"].includes(extension)) {
      setFile(null);
      setFileError("PNG, JPG, JPEG, PDF 파일만 등록할 수 있습니다.");
      return;
    }
    if (next.size > MAX_BYTES) {
      setFile(null);
      setFileError("파일은 20MB 이하여야 합니다.");
      return;
    }
    setFile(next);
  }

  async function start() {
    if (!file) return;
    setState({ kind: "uploading", loaded: 0, total: file.size });
    const upload = uploadDrawingWithProgress(part.part_id, file, (loaded, total) =>
      setState({ kind: "uploading", loaded, total }),
    );
    abort.current = upload.abort;
    try {
      const drawing = await upload.promise;
      setState({ kind: "done", drawing });
      onUploaded(drawing);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") setState({ kind: "cancelled" });
      else setState({ kind: "failed", message: cause instanceof Error ? cause.message : "업로드 실패" });
    } finally {
      abort.current = null;
    }
  }

  const uploading = state.kind === "uploading";
  const percent = uploading && state.total ? Math.round((state.loaded / state.total) * 100) : 0;

  return (
    <section aria-label="도면 등록" className="space-y-3 p-3 text-xs">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-white">도면 등록</h3>
          <p className="mt-0.5 text-dx-muted">
            등록 대상: {engineName ? <>{engineName} › </> : null}
            <b className="text-dx-text">{part.name}</b>
          </p>
        </div>
        <button type="button" disabled={uploading} onClick={onClose} className="dx-btn dx-btn-ghost dx-icon-btn" aria-label="등록 닫기">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!uploading) choose(event.dataTransfer.files[0] ?? null);
        }}
        className="rounded border border-dashed border-dx-line-strong bg-dx-bg/60 p-4 text-center"
      >
        <FileUp aria-hidden="true" className="mx-auto h-6 w-6 text-dx-faint" />
        <p className="mt-2 text-dx-muted">도면 파일을 끌어다 놓거나 선택하세요</p>
        <p className="mt-0.5 text-[11px] text-dx-faint">PNG · JPG · PDF, 20MB 이하</p>
        <button type="button" disabled={uploading} onClick={() => input.current?.click()} className="dx-btn mt-3">
          파일 선택
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label="도면 파일 선택"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <p className="flex items-center justify-between gap-2 rounded border border-dx-line bg-dx-raised px-2.5 py-2">
          <span className="min-w-0 truncate text-dx-text">{file.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-dx-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
        </p>
      )}
      {fileError && <p role="alert" className="flex items-center gap-1.5 text-rose-300"><XCircle className="h-3.5 w-3.5" />{fileError}</p>}

      <p className="text-[11px] text-dx-faint">
        도면 번호·개정 입력란은 현재 데이터 모델에 없어 두지 않았습니다. 파일명이 도면 이름이 되며, OCR 결과 버전으로 변경을 구분합니다.
      </p>

      {uploading && (
        <div role="status" className="space-y-1.5">
          <div className="flex items-center justify-between text-dx-muted">
            <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-dx-accent" />업로드 중</span>
            <span className="font-mono">{percent}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded bg-dx-line">
            <div className="h-full bg-dx-accent transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="flex items-start gap-1.5 text-rose-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {state.message} 파일은 그대로 두었습니다. 다시 시도할 수 있습니다.
        </p>
      )}
      {state.kind === "cancelled" && <p role="status" className="text-amber-200">업로드를 취소했습니다. 등록되지 않았습니다.</p>}
      {state.kind === "done" && (
        <p role="status" className="flex items-center gap-1.5 text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          등록했습니다: {state.drawing.original_filename}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {uploading ? (
          <button type="button" className="dx-btn" onClick={() => abort.current?.()}>
            업로드 취소
          </button>
        ) : (
          <button type="button" className="dx-btn" onClick={onClose}>
            닫기
          </button>
        )}
        <button type="button" disabled={!file || uploading || state.kind === "done"} onClick={() => void start()} className="dx-btn dx-btn-primary">
          {state.kind === "failed" || state.kind === "cancelled" ? <><RotateCw className="h-3.5 w-3.5" />다시 시도</> : "등록"}
        </button>
      </div>
    </section>
  );
}
