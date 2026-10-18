import { useEffect, useRef, useState } from "react";
import {
  createPart,
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
}

export function DrawingLibrary({
  onSelectDrawing,
  onClearDrawing,
  uploadRequest = 0,
}: DrawingLibraryProps) {
  const [parts, setParts] = useState<Part[]>([]);
  const [selectedPartId, setSelectedPartId] = useState("");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState("");
  const [newPartName, setNewPartName] = useState("");
  const [showPartInput, setShowPartInput] = useState(false);
  const [loadingParts, setLoadingParts] = useState(true);
  const [loadingDrawings, setLoadingDrawings] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const selectedPartRef = useRef("");
  const listVersionRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!uploadRequest) return;
    if (!selectedPartRef.current) {
      setError("도면을 등록할 부품을 먼저 선택해주세요.");
      return;
    }
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
    if (partId === selectedPartRef.current) return;

    selectedPartRef.current = partId;
    listVersionRef.current += 1;

    setSelectedPartId(partId);
    setDrawings([]);
    setSelectedDrawingId("");
    setLoadingDrawings(true);
    setError("");
    setNotice("");
    onClearDrawing();
  }

  async function handleAddPart() {
    const name = newPartName.trim();
    if (!name || addingPart) return;

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
    if (!targetPartId || uploading) return;

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
        setNotice("도면이 등록됐습니다. OCR은 아직 실행하지 않았습니다.");
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

  return (
    <section className="shrink-0 border-b border-slate-700 bg-slate-900 text-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <span className="mr-1 text-xs font-semibold text-slate-400">
          부품
        </span>

        {loadingParts && (
          <span className="text-xs text-slate-400">
            부품 불러오는 중...
          </span>
        )}

        {parts.map((part) => (
          <button
            key={part.part_id}
            type="button"
            onClick={() => selectPart(part.part_id)}
            aria-pressed={selectedPartId === part.part_id}
            className={`rounded border px-3 py-1.5 text-xs ${
              selectedPartId === part.part_id
                ? "border-cyan-400 bg-cyan-950 text-cyan-200"
                : "border-slate-600 bg-slate-800 hover:bg-slate-700"
            }`}
          >
            {part.name}
            <span className="ml-2 text-slate-400">
              {part.drawing_count}
            </span>
          </button>
        ))}

        {!loadingParts && parts.length === 0 && (
          <span className="text-xs text-slate-400">
            등록된 부품이 없습니다.
          </span>
        )}

        <button
          type="button"
          onClick={() => setShowPartInput((value) => !value)}
          className="rounded border border-dashed border-slate-500 px-3 py-1.5 text-xs"
        >
          + 부품 추가
        </button>

        {showPartInput && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAddPart();
            }}
          >
            <input
              value={newPartName}
              onChange={(event) => setNewPartName(event.target.value)}
              placeholder="새 부품명"
              aria-label="새 부품명"
              maxLength={100}
              className="w-36 rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={addingPart || !newPartName.trim()}
              className="rounded bg-cyan-700 px-3 py-1 text-xs disabled:opacity-50"
            >
              {addingPart ? "등록 중..." : "등록"}
            </button>
          </form>
        )}
      </div>

      {selectedPartId ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-4 py-2">
          <span className="mr-1 text-xs text-slate-400">
            등록 도면
          </span>

          {loadingDrawings ? (
            <span className="text-xs text-slate-400">
              도면 불러오는 중...
            </span>
          ) : drawings.length === 0 ? (
            <span className="text-xs text-slate-400">
              등록된 도면이 없습니다.
            </span>
          ) : (
            drawings.map((drawing) => (
              <button
                key={drawing.drawing_id}
                type="button"
                onClick={() => {
                  setSelectedDrawingId(drawing.drawing_id);
                  onSelectDrawing(drawing, drawingFileUrl(drawing));
                }}
                aria-pressed={
                  selectedDrawingId === drawing.drawing_id
                }
                className={`max-w-64 truncate rounded border px-3 py-1.5 text-xs ${
                  selectedDrawingId === drawing.drawing_id
                    ? "border-cyan-400 bg-cyan-950 text-cyan-200"
                    : "border-slate-600 hover:bg-slate-800"
                }`}
                title={drawing.original_filename}
              >
                {drawing.original_filename}
              </button>
            ))
          )}

          <button
            type="button"
            disabled={uploading || loadingDrawings}
            onClick={() => inputRef.current?.click()}
            className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {uploading ? "업로드 중..." : "+ 도면 등록"}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleUpload(file);
            }}
          />
        </div>
      ) : (
        <p className="px-4 pb-2 text-xs text-slate-400">
          부품을 선택하면 등록된 도면을 볼 수 있습니다.
        </p>
      )}

      {error && (
        <p role="alert" className="px-4 pb-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="px-4 pb-2 text-xs text-cyan-300">
          {notice}
        </p>
      )}
    </section>
  );
}