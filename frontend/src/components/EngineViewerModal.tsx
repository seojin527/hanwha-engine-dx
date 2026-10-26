/**
 * 3D 뷰어 팝업.
 * public/engine-viewer/index.html 을 iframe 으로 열고, 현재 도면의 부품을 빨간색으로 강조한다.
 * 도면·OCR·검토 상태는 읽기만 하며 바꾸지 않는다. 팝업을 열 때만 iframe 을 만들고 닫으면 제거한다.
 */

import React, { useEffect, useRef } from "react";
import { ENGINE_PART_LABEL, toEnginePartKey } from "../lib/engineParts";

interface EngineViewerModalProps {
  /** 현재 도면의 부품 이름 (OCR 결과의 part_name, 데모 화면은 목업 부품명) */
  partName?: string | null;
  /** 부품 이름이 목업(데모 화면)에서 온 값이면 true */
  isMockName?: boolean;
  onClose: () => void;
}

export const EngineViewerModal: React.FC<EngineViewerModalProps> = ({ partName, isMockName, onClose }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const partKey = toEnginePartKey(partName);

  // 닫기: 뷰어 안의 닫기 버튼(postMessage) · Esc
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "engine-viewer:close") onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const src = `${import.meta.env.BASE_URL}engine-viewer/index.html?popup=1${partKey ? `&highlight=${partKey}` : ""}`;
  const shownName = (partName ?? "").trim();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="3D 뷰어"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[92vh] w-[min(1500px,96vw)] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 px-4 py-2 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-bold text-slate-100">3D 뷰어</span>
            {partKey ? (
              <span className="truncate rounded border border-red-800 bg-red-950 px-2 py-0.5 text-red-300">
                현재 도면 부품: {ENGINE_PART_LABEL[partKey]} (빨간색으로 표시)
                {isMockName ? " · 목업 부품명 기준" : ""}
              </span>
            ) : (
              <span className="truncate rounded border border-amber-800 bg-amber-950 px-2 py-0.5 text-amber-300">
                {shownName
                  ? `이 도면의 부품(${shownName})은 3D 모델에 없어 엔진 전체만 표시합니다.`
                  : "도면의 부품 이름을 알 수 없어 엔진 전체만 표시합니다."}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-slate-600 bg-slate-800 px-2.5 py-1 font-semibold text-slate-200 hover:bg-slate-700"
          >
            닫기 (Esc)
          </button>
        </div>
        <iframe ref={frameRef} title="3D 뷰어" src={src} className="min-h-0 w-full flex-1 border-0 bg-slate-950" />
      </div>
    </div>
  );
};

/** 3D 뷰어를 열 수 없을 때 보여주는 작은 안내 창 */
export const EngineViewerNotice: React.FC<{ message: string; onClose: () => void }> = ({ message, onClose }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label="3D 뷰어 안내"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-[min(460px,92vw)] rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-2 text-sm font-bold text-slate-100">3D 뷰어를 열 수 없습니다</div>
        <p className="text-xs leading-relaxed text-slate-300">{message}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded border border-slate-600 bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
