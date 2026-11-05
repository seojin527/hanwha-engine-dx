import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import {
  createPart,
  apiUrl,
  drawingFileUrl,
  fetchDrawings,
  fetchParts,
  uploadDrawing,
  type Drawing,
  type Part,
} from "../lib/drawingAPI";

interface DrawingLibraryProps {
  onSelectDrawing: (drawing: Drawing, fileUrl: string) => void;
  onClearDrawing: () => void;
  uploadRequest?: number;
  /** 툴바 왼쪽, 선택 요약 옆에 붙는 상태 표시 */
  status?: ReactNode;
  /** 툴바 오른쪽 작업 버튼 묶음 */
  actions?: ReactNode;
  /** 처음 표시할 부품·도면 (도면 선택 화면에서 고른 값). 마운트할 때만 읽는다. */
  initialPartId?: string;
  initialDrawingId?: string;
  /** 처음에 부품·도면 관리 영역을 펼칠지 */
  initialOpen?: boolean;
  /** 선택한 부품이 바뀌면 알린다 (선택 해제는 빈 문자열). */
  onSelectPart?: (partId: string) => void;
  /** 관리자만 true: 부품 추가·삭제, 도면 등록·삭제를 보여준다. 작업자는 선택만 한다. */
  canManage?: boolean;
}

export function DrawingLibrary({
  onSelectDrawing,
  onClearDrawing,
  uploadRequest = 0,
  initialPartId = "",
  initialDrawingId = "",
  initialOpen = false,
  onSelectPart,
  canManage = false,
  status,
  actions,
}: DrawingLibraryProps) {
  const [parts, setParts] = useState<Part[]>([]);
  const [selectedPartId, setSelectedPartId] = useState(initialPartId);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState(
    initialPartId ? initialDrawingId : "",
  );
  const [newPartName, setNewPartName] = useState("");
  const [showPartInput, setShowPartInput] = useState(false);
  const [loadingParts, setLoadingParts] = useState(true);
  const [loadingDrawings, setLoadingDrawings] = useState(Boolean(initialPartId));
  const [addingPart, setAddingPart] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(initialOpen);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  const busy = addingPart || uploading || deleting;

  const inputRef = useRef<HTMLInputElement>(null);
  const selectedPartRef = useRef(initialPartId);
  const listVersionRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
        if (!uploadRequest || !canManage) return;

    if (!selectedPartRef.current) {
      setLibraryOpen(true);
      setError("도면을 등록할 부품을 먼저 선택해주세요.");
      return;
    }

    if (inputRef.current?.disabled) return;

    inputRef.current?.click();
  }, [uploadRequest]);

  // 서버에서 등록된 부품 불러오기
  useEffect(() => {
    const controller = new AbortController();
    mountedRef.current = true;

    fetchParts(controller.signal)
      .then((data) => setParts(data.parts))
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "부품 조회 실패"
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingParts(false);
        }
      });

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  // 부품을 바꾸면 해당 부품의 도면만 조회
  useEffect(() => {
    if (!selectedPartId) return;

    const controller = new AbortController();
    const version = ++listVersionRef.current;

    setLoadingDrawings(true);

    fetchDrawings(selectedPartId, controller.signal)
      .then((data) => {
        if (version === listVersionRef.current) {
          setDrawings(data.drawings);
        }
      })
      .catch((err) => {
        if (
          !controller.signal.aborted &&
          version === listVersionRef.current
        ) {
          setError(
            err instanceof Error ? err.message : "도면 조회 실패"
          );
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          version === listVersionRef.current
        ) {
          setLoadingDrawings(false);
        }
      });

    return () => controller.abort();
  }, [selectedPartId]);

  function selectPart(partId: string) {
    if (uploading || deletingRef.current) return;
    if (partId === selectedPartRef.current) return;

    selectedPartRef.current = partId;
    listVersionRef.current += 1;

    setSelectedPartId(partId);
    setDrawings([]);
    setSelectedDrawingId("");
    setLoadingDrawings(Boolean(partId));
    setError("");
    setNotice("");
    onClearDrawing();
    onSelectPart?.(partId);
  }

  async function handleAddPart() {
    const name = newPartName.trim();
    if (!name || busy || deletingRef.current) return;

    setAddingPart(true);
    setError("");

    try {
      const part = await createPart(name);
      if (!mountedRef.current) return;

      setParts((previous) => [...previous, part]);
      setNewPartName("");
      setShowPartInput(false);
      selectPart(part.part_id);
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error ? err.message : "부품 등록 실패"
        );
      }
    } finally {
      if (mountedRef.current) setAddingPart(false);
    }
  }

  async function handleUpload(file: File) {
    const targetPartId = selectedPartRef.current;
        if (
      !targetPartId ||
      busy ||
      loadingDrawings ||
      deletingRef.current
    ) return;

    setUploading(true);
    setError("");
    setNotice("");

    try {
      const drawing = await uploadDrawing(targetPartId, file);
      if (!mountedRef.current) return;

      setParts((previous) =>
        previous.map((part) =>
          part.part_id === targetPartId
            ? { ...part, drawing_count: part.drawing_count + 1 }
            : part
        )
      );

      // 업로드 중 다른 부품으로 이동했다면
      // 현재 화면에 이전 부품의 도면을 표시하지 않음
      if (selectedPartRef.current === targetPartId) {
        listVersionRef.current += 1;
        setLoadingDrawings(false);

        setDrawings((previous) => [
          drawing,
          ...previous.filter(
            (entry) => entry.drawing_id !== drawing.drawing_id
          ),
        ]);

        setSelectedDrawingId(drawing.drawing_id);
        onSelectDrawing(drawing, drawingFileUrl(drawing));
        setNotice("도면이 등록됐습니다. CPU OCR을 자동으로 진행합니다.");
      }
    } catch (err) {
      if (
        mountedRef.current &&
        selectedPartRef.current === targetPartId
      ) {
        setError(
          err instanceof Error ? err.message : "도면 업로드 실패"
        );
      }
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }

    async function requestDelete(path: string) {
    const response = await fetch(apiUrl(path), {
      method: "DELETE",
    });

    if (!response.ok) {
      let message = `삭제 실패 (${response.status})`;

      try {
        const body = await response.json();
        if (typeof body.detail === "string") {
          message = body.detail;
        }
      } catch {
        // JSON 응답이 아니면 기본 오류 문구를 사용합니다.
      }

      throw new Error(message);
    }
  }

  function selectDrawing(drawingId: string) {
    const drawing = drawings.find(
      (entry) => entry.drawing_id === drawingId,
    );

    setSelectedDrawingId(drawing?.drawing_id ?? "");

    if (drawing) {
      onSelectDrawing(drawing, drawingFileUrl(drawing));
      setLibraryOpen(false);
    } else {
      onClearDrawing();
    }
  }

  async function handleDeleteDrawing() {
    if (busy || deletingRef.current || loadingDrawings) return;

    const drawing = drawings.find(
      (entry) => entry.drawing_id === selectedDrawingId,
    );
    if (!drawing) return;

    const accepted = window.confirm(
      `「${drawing.original_filename}」을 등록 목록에서 삭제할까요?\n\n` +
      "기존 검수·측정 기록과 파일은 서버에 보관됩니다.",
    );
    if (!accepted) return;

    deletingRef.current = true;
    setDeleting(true);
    setError("");
    setNotice("");

    try {
      await requestDelete(
        `/api/drawings/${encodeURIComponent(drawing.drawing_id)}`,
      );
      if (!mountedRef.current) return;

      listVersionRef.current += 1;

      setDrawings((previous) =>
        previous.filter(
          (entry) => entry.drawing_id !== drawing.drawing_id,
        ),
      );

      setParts((previous) =>
        previous.map((part) =>
          part.part_id === selectedPartRef.current
            ? {
                ...part,
                drawing_count: Math.max(0, part.drawing_count - 1),
              }
            : part,
        ),
      );

      setSelectedDrawingId("");
      onClearDrawing();
      setNotice("선택한 도면을 등록 목록에서 삭제했습니다.");
    } catch (cause: unknown) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error ? cause.message : "도면 삭제 실패",
        );
      }
    } finally {
      deletingRef.current = false;
      if (mountedRef.current) setDeleting(false);
    }
  }

  async function handleDeletePart() {
    if (busy || deletingRef.current || loadingDrawings) return;

    const part = parts.find(
      (entry) => entry.part_id === selectedPartRef.current,
    );
    if (!part) return;

    const accepted = window.confirm(
      `「${part.name}」 부품을 삭제할까요?\n\n` +
      "이 부품에 등록된 도면도 모두 목록에서 삭제됩니다.\n" +
      "기존 검수·측정 기록과 파일은 서버에 보관됩니다.",
    );
    if (!accepted) return;

    deletingRef.current = true;
    setDeleting(true);
    setError("");
    setNotice("");

    try {
      await requestDelete(
        `/api/parts/${encodeURIComponent(part.part_id)}`,
      );
      if (!mountedRef.current) return;

      listVersionRef.current += 1;
      selectedPartRef.current = "";

      setParts((previous) =>
        previous.filter((entry) => entry.part_id !== part.part_id),
      );
      setSelectedPartId("");
      setSelectedDrawingId("");
      setDrawings([]);
      setLoadingDrawings(false);

      onClearDrawing();
      onSelectPart?.("");
      setNotice("부품과 해당 부품의 도면을 등록 목록에서 삭제했습니다.");
    } catch (cause: unknown) {
      if (mountedRef.current) {
        setError(
          cause instanceof Error ? cause.message : "부품 삭제 실패",
        );
      }
    } finally {
      deletingRef.current = false;
      if (mountedRef.current) setDeleting(false);
    }
  }



  const selectedPartName = parts.find((part) => part.part_id === selectedPartId)?.name;
  const selectedDrawingName = drawings.find(
    (drawing) => drawing.drawing_id === selectedDrawingId,
  )?.original_filename;

  return (
    <section className="shrink-0 border-b border-slate-800 bg-slate-900 text-white">
      {/* 휴대폰: 줄바꿈 대신 한 줄 가로 스크롤 (도면 영역을 넓게) */}
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 compact:flex-nowrap compact:overflow-x-auto">
        <button
          type="button"
          aria-expanded={libraryOpen}
          aria-controls="drawing-library-controls"
          onClick={() => setLibraryOpen((previous) => !previous)}
          title="부품·도면 변경 및 등록"
          className={`flex h-7 min-w-0 max-w-full items-center gap-2 rounded border px-2.5 text-left text-xs transition-colors sm:max-w-[420px] compact:max-w-[200px] compact:shrink-0 ${
            libraryOpen
              ? "border-slate-500 bg-slate-800"
              : "border-slate-700 hover:border-slate-500 hover:bg-slate-800"
          }`}
        >
          <FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0 truncate">
            <span className={selectedPartName ? "text-slate-100" : "text-slate-400"}>
              {selectedPartName || "부품 미선택"}
            </span>
            <span className="px-1.5 text-slate-600">/</span>
            <span className={selectedDrawingName ? "text-slate-100" : "text-slate-400"}>
              {selectedDrawingName || "도면 미선택"}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${libraryOpen ? "rotate-180" : ""}`}
          />
        </button>

        {status && <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400 compact:shrink-0 compact:whitespace-nowrap">{status}</div>}

        {actions && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 compact:shrink-0 compact:flex-nowrap">{actions}</div>
        )}
      </div>

      <div id="drawing-library-controls" hidden={!libraryOpen} className="border-t border-slate-800">
      <div className="grid gap-x-6 gap-y-3 px-3 py-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="library-part"
              className="text-[11px] font-medium text-slate-400"
            >
              부품
            </label>

            <span className="text-[11px] text-slate-500">
              등록 {parts.length}개
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <select
              id="library-part"
              value={selectedPartId}
              disabled={loadingParts || busy}
              onChange={(event) => selectPart(event.target.value)}
              className="field-dark h-7 min-w-[160px] flex-1 py-0"
            >
              <option value="">
                {loadingParts ? "부품 불러오는 중…" : "부품을 선택하세요"}
              </option>

              {parts.map((part) => (
                <option key={part.part_id} value={part.part_id}>
                  {part.name} · 도면 {part.drawing_count}개
                </option>
              ))}
            </select>

            {canManage && (
              <>
                <button
                  type="button"
                  disabled={busy || loadingParts}
                  aria-expanded={showPartInput}
                  onClick={() => setShowPartInput((previous) => !previous)}
                  className="btn btn-dark"
                >
                  부품 추가
                </button>

                <button
                  type="button"
                  disabled={!selectedPartId || busy || loadingDrawings}
                  onClick={() => void handleDeletePart()}
                  className="btn btn-dark-danger"
                >
                  부품 삭제
                </button>
              </>
            )}
          </div>

          {canManage && showPartInput && (
            <form
              className="flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAddPart();
              }}
            >
              <input
                value={newPartName}
                disabled={busy}
                onChange={(event) => setNewPartName(event.target.value)}
                placeholder="새 부품명"
                aria-label="새 부품명"
                maxLength={100}
                className="field-dark h-7 min-w-0 flex-1 py-0"
              />

              <button
                type="submit"
                disabled={busy || !newPartName.trim()}
                className="btn btn-primary"
              >
                {addingPart ? "등록 중…" : "등록"}
              </button>
            </form>
          )}
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="library-drawing"
              className="text-[11px] font-medium text-slate-400"
            >
              등록 도면
            </label>

            <span className="text-[11px] text-slate-500">
              {loadingDrawings ? "조회 중…" : `등록 ${drawings.length}개`}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <select
              id="library-drawing"
              value={selectedDrawingId}
              disabled={!selectedPartId || loadingDrawings || busy}
              onChange={(event) => selectDrawing(event.target.value)}
              className="field-dark h-7 min-w-[160px] flex-1 py-0"
            >
              <option value="">
                {!selectedPartId
                  ? "부품을 먼저 선택하세요"
                  : loadingDrawings
                    ? "도면 불러오는 중…"
                    : drawings.length === 0
                      ? "등록된 도면이 없습니다"
                      : "도면을 선택하세요"}
              </option>

              {drawings.map((drawing) => (
                <option
                  key={drawing.drawing_id}
                  value={drawing.drawing_id}
                >
                  {drawing.original_filename}
                  {" · "}
                  {drawing.drawing_id.slice(0, 8)}
                </option>
              ))}
            </select>

            {canManage && (
              <>
                <button
                  type="button"
                  disabled={!selectedPartId || loadingDrawings || busy}
                  onClick={() => inputRef.current?.click()}
                  className="btn btn-primary"
                >
                  {uploading ? "등록 중…" : "도면 등록"}
                </button>

                <button
                  type="button"
                  disabled={!selectedDrawingId || loadingDrawings || busy}
                  onClick={() => void handleDeleteDrawing()}
                  className="btn btn-dark-danger"
                >
                  도면 삭제
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {selectedPartId && (
        <details className="mx-3 mb-3 rounded border border-slate-700">
          <summary className="cursor-pointer px-3 py-1.5 text-xs text-slate-300 hover:text-white">
            도면 등록 내역 · {drawings.length}개
          </summary>

          <div className="max-h-44 overflow-y-auto border-t border-slate-700">
            {loadingDrawings ? (
              <p className="p-3 text-xs text-slate-400">
                등록 내역을 불러오는 중…
              </p>
            ) : drawings.length === 0 ? (
              <p className="p-3 text-xs text-slate-400">
                등록된 도면이 없습니다.
              </p>
            ) : (
              drawings.map((drawing) => {
                const metadata = drawing as Drawing & {
                  created_at?: string;
                };
                const isSelected = selectedDrawingId === drawing.drawing_id;

                return (
                  <button
                    key={drawing.drawing_id}
                    type="button"
                    disabled={busy}
                    aria-current={isSelected || undefined}
                    onClick={() => selectDrawing(drawing.drawing_id)}
                    className={`flex w-full items-center justify-between gap-3 border-b border-l-2 border-b-slate-800 px-3 py-1.5 text-left last:border-b-0 disabled:opacity-40 ${
                      isSelected
                        ? "border-l-cyan-500 bg-slate-800 text-white"
                        : "border-l-transparent text-slate-200 hover:bg-slate-800/60"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {drawing.original_filename}
                      </span>

                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        등록 {metadata.created_at || "일시 정보 없음"}
                        {" · "}
                        ID {drawing.drawing_id.slice(0, 8)}
                      </span>
                    </span>

                    <span className="shrink-0 text-[11px] text-slate-400">
                      {isSelected ? "선택됨" : "열기"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </details>
      )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        disabled={!canManage || !selectedPartId || loadingDrawings || busy}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleUpload(file);
        }}
      />

      {deleting && (
        <p role="status" className="banner banner-info">
          삭제 처리 중…
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="banner banner-error whitespace-pre-wrap"
        >
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="banner banner-info">
          {notice}
        </p>
      )}
    </section>
  );
}
