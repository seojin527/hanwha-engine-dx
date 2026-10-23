import React, { useState } from "react";
import { formatLogTime, type AppMode, type EditLogEntry } from "../lib/admin/adminStore";

interface EditHistoryPopoverProps {
  entries: EditLogEntry[];
  mode: AppMode;
  /** 지금 보고 있는 도면 id. 없으면 "현재 도면만" 선택을 쓸 수 없다. */
  activeDrawingId: string | null;
  onClose: () => void;
  /** 관리자 모드에서만 전달된다. 내역을 모두 지운다. */
  onClear?: () => void;
}

/**
 * 관리자 수정 내역을 보여주는 작은 창. 작업자·관리자 모드 모두에서 헤더의 "수정 내역" 버튼으로 여닫는다.
 * 내역은 이 브라우저에만 저장된다.
 */
export const EditHistoryPopover: React.FC<EditHistoryPopoverProps> = ({
  entries,
  mode,
  activeDrawingId,
  onClose,
  onClear,
}) => {
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const shown = entries.filter((e) => !onlyCurrent || !activeDrawingId || e.drawingId === activeDrawingId);

  return (
    <div
      role="dialog"
      aria-label="관리자 수정 내역"
      className="fixed right-4 top-[72px] z-40 flex max-h-[70vh] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700 bg-slate-800 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">관리자 수정 내역</div>
          <div className="text-[11px] text-slate-400">서버에 저장된 검토 기록 · 최신순 · {shown.length}건</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
        >
          닫기
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-300">
        <label className={`flex items-center gap-1.5 ${activeDrawingId ? "" : "opacity-50"}`}>
          <input
            type="checkbox"
            checked={onlyCurrent && !!activeDrawingId}
            disabled={!activeDrawingId}
            onChange={(e) => setOnlyCurrent(e.target.checked)}
          />
          현재 도면만 보기
        </label>
        {mode === "admin" && onClear && entries.length > 0 && (
          <button type="button" onClick={onClear} className="text-rose-300 hover:underline">
            내역 모두 지우기
          </button>
        )}
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-slate-800 overflow-y-auto">
        {shown.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-slate-400">아직 수정 내역이 없습니다.</li>
        )}
        {shown.map((e) => (
          <li key={e.id} className="px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="font-mono">{formatLogTime(e.at)}</span>
              <span className="font-mono">{e.drawingId}</span>
            </div>
            <div className="mt-0.5 font-medium text-slate-100">
              {e.itemNo > 0 ? `#${e.itemNo} ` : ""}
              {e.itemName}
            </div>
            <div className="mt-0.5 text-slate-300">
              <span className="text-slate-400">{e.field}:</span>{" "}
              <span className="font-mono text-slate-500 line-through">{e.from}</span>
              <span className="mx-1 text-slate-500">→</span>
              <span className="font-mono font-semibold text-cyan-300">{e.to}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
