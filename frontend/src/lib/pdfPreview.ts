/** 서버 썸네일이 실패해도 원본 PDF를 로컬 브라우저에서 그린다. 외부 서비스로 보내지 않는다. */
const previews = new Map<string, Promise<string>>();
let renderer: Promise<typeof import('pdfjs-dist')> | undefined;
let active = 0;
const waiting: Array<() => void> = [];
async function slot() {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  return () => { const next = waiting.shift(); if (next) next(); else active--; };
}
export function renderPdfPreview(url: string, width: number): Promise<string> {
  const key = `${url}:${width}`;
  const cached = previews.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const release = await slot();
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(response.status === 404
        ? '원본 도면 파일을 찾을 수 없습니다. 업로드 폴더를 확인해주세요.'
        : `원본 도면을 불러오지 못했습니다 (HTTP ${response.status}).`);
      renderer ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
        .then(([pdfjs, worker]) => { pdfjs.GlobalWorkerOptions.workerSrc = worker.default; return pdfjs; });
      const pdfjs = await renderer;
      task = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) });
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(width / base.width, 4) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('브라우저에서 도면을 그릴 수 없습니다.');
      await page.render({ canvasContext: context, viewport, background: 'white' }).promise;
      return canvas.toDataURL('image/png');
    } finally {
      try { await task?.destroy(); } finally { release(); }
    }
  })();
  previews.set(key, promise);
  promise.catch(() => { if (previews.get(key) === promise) previews.delete(key); });
  if (previews.size > 16) previews.delete(previews.keys().next().value!);
  return promise;
}
