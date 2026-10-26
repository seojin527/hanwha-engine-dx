import { useEffect, useRef, useState } from "react";
import type { OcrReviewHistoryEntry } from "../lib/ocr";

interface Props {
  history: OcrReviewHistoryEntry[];
  selectedItemId?: string;
  onClose: () => void;
}

function matchesItem(
  sourceId: string,
  changeId: string,
  type: string,
): boolean {
  const match = /^(DIMENSION|GDT)_(\d+)$/.exec(sourceId);
  if (!match) return false;

  const number = Number(match[2]);

  if (match[1] === "DIMENSION" && type === "DIMENSION") {
    return changeId === `D${String(number).padStart(2, "0")}`;
  }

  if (match[1] === "GDT" && type === "GDT") {
    const row = /^G(\d+)-(\d+)$/.exec(changeId);
    return !!row && Number(row[1]) === number;
  }

  return false;
}

function formatTime(value?: string): string {
  if (!value) return "시간 미기록";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ko-KR");
}

export default function DrawingReviewHistory({
  history,
  selectedItemId,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [onlySelected, setOnlySelected] = useState(!!selectedItemId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const records = [...history]
    .reverse()
    .map((entry) => ({
      ...entry,
      changes: entry.log.changes.filter(
        (change) =>
          change.action !== "confirmed" &&
          (!onlySelected ||
            !selectedItemId ||
            matchesItem(selectedItemId, change.item_id, change.type)),
      ),
    }))
    .filter((entry) => entry.changes.length > 0);

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      aria-labelledby="drawing-history-title"
      className="m-auto max-h-[80vh] w-[min(720px,92vw)] overflow-y-auto rounded-md border border-slate-300 bg-white p-4 text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="drawing-history-title" className="card-title">
          수정 이력
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-secondary"
          autoFocus
        >
          닫기
        </button>
      </div>

      {selectedItemId && (
        <label className="mt-4 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(event) => setOnlySelected(event.target.checked)}
          />
          선택한 항목만 보기 ({selectedItemId})
        </label>
      )}

      {records.length === 0 ? (
        <p className="mt-5 text-sm text-slate-600">
          {onlySelected
            ? "선택한 항목에 저장된 수정·추가 이력이 없습니다."
            : "저장된 수정·추가 이력이 없습니다."}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {records.map((entry) => (
            <section key={entry.revision} className="card p-3">
              <p className="text-xs text-slate-600">
                {formatTime(entry.log.reviewed_at)} · 검토자:{" "}
                {entry.log.reviewer || "미기록"}
              </p>

              <ul className="mt-2 space-y-2">
                {entry.changes.map((change, index) => (
                  <li
                    key={`${change.item_id}-${index}`}
                    className="rounded bg-slate-50 p-2 text-xs"
                  >
                    <p className="font-semibold">
                      {change.item_id} ·{" "}
                      {change.action === "added" ? "추가" : "수정"}
                    </p>
                    <p className="mt-1 break-all whitespace-pre-wrap">
                      {change.before ?? "(없음)"} → {change.after}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </dialog>
  );
}