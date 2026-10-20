export function OcrLoadingOverlay({stage}: {stage?: string}) {
  return <div className="absolute inset-x-0 bottom-0 top-[49px] z-30 flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-[2px]">
    <style>{`
      @keyframes drawing-ocr-bar {0% {transform: translateX(-110%)} 100% {transform: translateX(290%)}}
      .drawing-ocr-bar {animation: drawing-ocr-bar 1.6s ease-in-out infinite;}
      @media (prefers-reduced-motion: reduce) {.drawing-ocr-bar {animation:none;transform:translateX(85%);}}
    `}</style>
    <div role="status" aria-live="polite" aria-atomic="true" className="w-full max-w-sm rounded-2xl border border-cyan-400/30 bg-slate-900/95 p-6 text-white shadow-2xl">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-700 bg-cyan-950 text-xl text-cyan-300">⌕</span>
        <div><h3 className="text-sm font-bold">도면 OCR 분석 중</h3><p className="mt-1 text-[11px] text-slate-400">원본 도면을 분석하고 측정항목을 추출합니다.</p></div>
      </div>
      <p className="mb-3 break-words text-xs font-semibold text-cyan-200">{stage || 'CPU OCR 작업 준비 중…'}</p>
      <div role="progressbar" aria-label="OCR 분석 진행 중" aria-valuetext="분석 중 · 완료 비율 미제공" className="h-1.5 overflow-hidden rounded-full bg-slate-700">
        <div className="drawing-ocr-bar h-full w-1/3 rounded-full bg-cyan-400" />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">완료되면 추출 도면과 번호가 자동으로 표시됩니다.<br/>CPU 분석은 도면에 따라 몇 분 걸릴 수 있습니다.</p>
    </div>
  </div>;
}
