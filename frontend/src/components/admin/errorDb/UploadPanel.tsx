/**
 * 목적별 엑셀 일괄 업로드·다운로드.
 * 흐름: 목적 선택 → 파일 선택 → 서버 검증 → 미리보기(신규·갱신·변경 없음) → 반영(서버에서 다시 검증) → 결과
 * 검증 규칙은 서버(purpose_errors/excel.py)에만 있고, 명령줄 적재와 같다.
 */
import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import type { WorkPurpose } from "../../../lib/purpose";
import { useReportUnsaved } from "../../../lib/unsavedChanges";
import {
  AdminApiError,
  applyUpload,
  exportUrl,
  fetchUploads,
  previewUpload,
  type PurposeSchema,
  type UploadError,
  type UploadPreview,
  type UploadRecord,
  type UploadResult,
} from "../../../lib/admin/errorDbAPI";
import { Empty, ErrorNote, Loading, Tag } from "../adminUi";

const VECTOR_TEXT: Record<string, string> = { none: "반영할 사례 없음", pending: "반영 중", ready: "반영 완료", failed: "반영 실패" };

export function UploadPanel({
  purpose,
  schema,
  refreshKey,
  onChanged,
}: {
  purpose: WorkPurpose;
  schema: PurposeSchema | null;
  refreshKey: number;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [rejected, setRejected] = useState<UploadError[]>([]);
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<UploadRecord[] | null>(null);
  const [reload, setReload] = useState(0);

  // 파일을 고르고 반영하지 않은 상태는 메뉴 이동 때 확인한다.
  useReportUnsaved(files.length > 0 && !result);

  useEffect(() => {
    reset();
  }, [purpose]);

  useEffect(() => {
    const controller = new AbortController();
    setUploads(null);
    fetchUploads(purpose, controller.signal)
      .then((data) => !controller.signal.aborted && setUploads(data.items))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "업로드 이력 조회 실패");
      });
    return () => controller.abort();
  }, [purpose, reload, refreshKey]);

  function reset() {
    setFiles([]);
    setPreview(null);
    setResult(null);
    setRejected([]);
    setError("");
    if (input.current) input.current.value = "";
  }

  async function runPreview(selected: File[]) {
    setBusy("preview");
    setError("");
    setPreview(null);
    setResult(null);
    setRejected([]);
    try {
      setPreview(await previewUpload(purpose, selected));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "검증 요청 실패");
    } finally {
      setBusy("");
    }
  }

  async function runApply() {
    setBusy("apply");
    setError("");
    try {
      setResult(await applyUpload(purpose, files));
      onChanged();
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.errors.length) setRejected(cause.errors);
      setError(cause instanceof Error ? cause.message : "반영 실패");
    } finally {
      setBusy("");
      setReload((v) => v + 1);
    }
  }

  const label = schema?.label ?? "";
  const canApply = preview?.ok && !result && busy === "";

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <section aria-label="엑셀 업로드" className="card flex min-h-[320px] flex-col overflow-hidden">
        <header className="card-header">
          <h3 className="text-xs font-semibold text-white">{label} 엑셀 업로드</h3>
          <a href={exportUrl(purpose)} download className="btn btn-secondary">
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
            {label} 사례 내려받기
          </a>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-400">
            {["목적 선택", "파일 선택", "서버 검증", "미리보기", "반영", "결과 확인"].map((step, index) => (
              <li key={step}><span className="tabular-nums text-neutral-500">{index + 1}.</span> {step}</li>
            ))}
          </ol>
          <p className="text-[11px] text-neutral-400">
            {schema && <>시트 「{schema.excel.sheet}」 · 필수 열 {schema.excel.required_columns.join(", ")}. </>}
            같은 case_id 는 갱신하고 파일에 없는 사례는 그대로 둡니다. 활성·비활성 상태는 업로드로 바뀌지 않습니다
            {schema && <> (내보낸 파일의 {schema.excel.info_columns.join(", ")} 열은 참고용으로 읽지 않습니다)</>}.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              multiple
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="엑셀 파일 선택"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                setFiles(selected);
                setResult(null);
                if (selected.length) void runPreview(selected);
                else setPreview(null);
              }}
              className="field w-auto max-w-full file:mr-2 file:rounded file:border-0 file:bg-neutral-700 file:px-2 file:py-1 file:text-xs file:text-neutral-100"
            />
            {files.length > 0 && (
              <button type="button" onClick={reset} disabled={busy !== ""} className="btn btn-ghost">선택 취소</button>
            )}
          </div>

          {busy === "preview" && <Loading>서버에서 검증하는 중…</Loading>}
          <ErrorNote message={error} />
          {rejected.length > 0 && <ErrorTable errors={rejected} />}

          {preview && !preview.ok && (
            <>
              <p className="note note-error">검증에 실패했습니다. 아래 오류를 고친 뒤 다시 선택해주세요. 아무것도 저장하지 않았습니다.</p>
              <ErrorTable errors={preview.errors} />
            </>
          )}

          {preview?.ok && (
            <section aria-label="미리보기" className="space-y-2">
              <p className="text-neutral-200">
                검증 통과 · {preview.files?.length}개 파일 · 사례 {preview.rows}건 —
                <b className="ml-1 text-cyan-300">신규 {preview.created}</b>
                <b className="ml-2 text-amber-300">갱신 {preview.updated}</b>
                <span className="ml-2 text-neutral-400">변경 없음 {preview.unchanged}</span>
              </p>
              <table className="w-full border-separate border-spacing-0 text-left text-[11px]">
                <thead className="text-neutral-400">
                  <tr className="[&>th]:border-b [&>th]:border-neutral-700 [&>th]:px-2 [&>th]:py-1 [&>th]:font-medium">
                    <th>파일</th><th>시트</th><th className="text-right">사례</th><th className="text-right">신규</th><th className="text-right">갱신</th><th className="text-right">변경 없음</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-neutral-200">
                  {preview.files?.map((file) => (
                    <tr key={file.file} className="[&>td]:border-b [&>td]:border-neutral-800 [&>td]:px-2 [&>td]:py-1">
                      <td className="break-all">{file.file}</td><td>{file.sheet}</td>
                      <td className="text-right">{file.rows}</td><td className="text-right">{file.created}</td>
                      <td className="text-right">{file.updated}</td><td className="text-right">{file.unchanged}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <details>
                <summary className="cursor-pointer text-neutral-300">사례별 변경 내용 ({preview.changes?.filter((c) => c.action !== "unchanged").length ?? 0}건 신규·갱신)</summary>
                <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
                  {preview.changes?.filter((c) => c.action !== "unchanged").map((change) => (
                    <li key={change.case_id} className="flex gap-2">
                      <span className="w-14 shrink-0">{change.action === "created" ? <Tag tone="info">신규</Tag> : <Tag tone="warn">갱신</Tag>}</span>
                      <span className="w-36 shrink-0 break-all font-mono text-neutral-300">{change.case_id}</span>
                      <span className="min-w-0 flex-1 text-neutral-400">
                        {change.case_title}
                        {change.changed_fields.length > 0 && ` · ${change.changed_fields.join(", ")}`}
                        {change.active === false && " · 비활성 유지"}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
              <div className="flex items-center gap-2">
                <button type="button" disabled={!canApply} onClick={() => void runApply()} className="btn btn-primary">
                  <Upload aria-hidden="true" className="h-3.5 w-3.5" />
                  {busy === "apply" ? "반영 중…" : `${label} 오류 DB에 반영`}
                </button>
                <span className="text-[11px] text-neutral-400">반영할 때 서버가 파일을 다시 검증합니다.</span>
              </div>
            </section>
          )}

          {result && (
            <section aria-label="반영 결과" className="space-y-1.5">
              <p className="note note-ok">
                원문 저장 완료 — 사례 {result.rows}건 (신규 {result.created} · 갱신 {result.updated} · 변경 없음 {result.unchanged})
              </p>
              <p className={`note ${result.vector_status === "failed" ? "note-error" : "note-info"}`}>
                벡터 반영: {VECTOR_TEXT[result.vector_status]} — 반영 {result.vector_ready}건 · 실패 {result.vector_failed}건
                {result.vector_status === "failed" && " (원문은 저장돼 있습니다. 「벡터 반영」 단계에서 재시도하세요.)"}
              </p>
              <ul className="space-y-0.5 text-[11px] text-neutral-300">
                {result.files.map((file) => (
                  <li key={file.file}>
                    <FileSpreadsheet aria-hidden="true" className="mr-1 inline h-3 w-3 text-neutral-500" />
                    {file.file}: 사례 {file.rows}건 · 벡터 대상 {file.indexed}건 · {VECTOR_TEXT[file.vector_status]}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={reset} className="btn btn-secondary">다른 파일 올리기</button>
            </section>
          )}
        </div>
      </section>

      <section aria-label="업로드 이력" className="card flex min-h-[320px] flex-col overflow-hidden">
        <header className="card-header">
          <h3 className="text-xs font-semibold text-white">업로드 이력</h3>
          <span className="text-[11px] text-neutral-400">기능 도입 이후 기록</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!uploads ? (
            <Loading />
          ) : uploads.length === 0 ? (
            <Empty>기록된 업로드가 없습니다. 기존 사례는 그대로 있으며, 업로드 이력은 이 기능 도입 이후부터 남습니다.</Empty>
          ) : (
            <ul>
              {uploads.map((upload) => (
                <li key={upload.upload_id} className="space-y-0.5 border-b border-neutral-700 px-3 py-2 text-[11px]">
                  <p className="flex items-center gap-2">
                    {upload.status === "applied" ? <Tag tone="ok">반영</Tag> : <Tag tone="bad">거부</Tag>}
                    <span className="tabular-nums text-neutral-300">{upload.created_at}</span>
                    <span className="text-neutral-500">{upload.source === "cli" ? "명령줄" : "관리자 화면"}</span>
                  </p>
                  {upload.files.map((file) => (
                    <p key={file.file_index} className="break-all text-neutral-200">
                      {file.file_name}
                      {upload.status === "applied" && (
                        <span className="text-neutral-400"> · 사례 {file.row_count} (신규 {file.created_count} · 갱신 {file.updated_count} · 변경 없음 {file.unchanged_count}) · 벡터 {VECTOR_TEXT[file.vector_status] ?? file.vector_status}</span>
                      )}
                    </p>
                  ))}
                  {upload.status === "rejected" && (
                    <p className="text-rose-300">오류 {upload.errors.length}건 · 사례를 저장하지 않음{upload.errors[0] && ` — ${upload.errors[0].message}`}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function ErrorTable({ errors }: { errors: UploadError[] }) {
  return (
    <div className="max-h-64 overflow-auto rounded border border-rose-400/40">
      <table className="w-full border-separate border-spacing-0 text-left text-[11px]">
        <thead className="sticky top-0 bg-[#2e2e2e] text-neutral-400">
          <tr className="[&>th]:border-b [&>th]:border-neutral-700 [&>th]:px-2 [&>th]:py-1 [&>th]:font-medium">
            <th>파일</th><th>시트</th><th className="text-right">행</th><th>사례 ID</th><th>오류</th>
          </tr>
        </thead>
        <tbody className="text-neutral-200">
          {errors.map((entry, index) => (
            <tr key={index} className="[&>td]:border-b [&>td]:border-neutral-800 [&>td]:px-2 [&>td]:py-1 [&>td]:align-top">
              <td className="break-all">{entry.file || "—"}</td>
              <td>{entry.sheet || "—"}</td>
              <td className="text-right tabular-nums">{entry.row ?? "—"}</td>
              <td className="break-all font-mono">{entry.case_id || "—"}</td>
              <td className="text-rose-200">{entry.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

