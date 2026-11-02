export function OcrLoadingOverlay({stage}: {stage?: string}) {
  return <div className="absolute inset-x-0 bottom-0 top-9 z-30 flex items-center justify-center bg-slate-900/25 p-5 backdrop-blur-[2px]">
    <style>{`
      @keyframes drawing-ocr-bar {0% {transform: translateX(-110%)} 100% {transform: translateX(290%)}}
      .drawing-ocr-bar {animation: drawing-ocr-bar 1.6s ease-in-out infinite;}
      @media (prefers-reduced-motion: reduce) {.drawing-ocr-bar {animation:none;transform:translateX(85%);}}
    `}</style>
    <div role="status" aria-live="polite" aria-atomic="true" className="w-full max-w-sm rounded-md border border-dx-line-strong bg-dx-panel p-6 text-dx-strong shadow-2xl">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded border border-dx-line-strong bg-dx-raised text-xl text-cyan-700">⌕</span>
        <div><h3 className="text-[13px] font-semibold">도면 OCR 분석 중</h3><p className="mt-1 text-[11px] text-dx-muted">원본 도면을 분석하고 측정항목을 추출합니다.</p></div>
      </div>
      <p className="mb-3 break-words text-xs font-medium text-cyan-700">{stage || 'CPU OCR 작업 준비 중…'}</p>
      <div role="progressbar" aria-label="OCR 분석 진행 중" aria-valuetext="분석 중 · 완료 비율 미제공" className="h-1.5 overflow-hidden rounded-full bg-dx-line">
        <div className="drawing-ocr-bar h-full w-1/3 rounded-full bg-cyan-600" />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-dx-muted">완료되면 추출 도면과 번호가 자동으로 표시됩니다.<br/>CPU 분석은 도면에 따라 몇 분 걸릴 수 있습니다.</p>
    </div>
  </div>;
}
