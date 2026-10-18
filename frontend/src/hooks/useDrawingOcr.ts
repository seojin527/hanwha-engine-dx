import { useEffect, useRef, useState } from 'react';
import { apiUrl, applySampleOcr, fetchOcr } from '../lib/drawingAPI';
import type { OcrSnapshot } from '../lib/ocr';

type State = {
  drawingId: string | null;
  status: 'idle' | 'loading' | 'applying' | 'ready' | 'error';
  snapshot: OcrSnapshot | null;
  error: string;
};
const empty = (drawingId: string | null): State => ({ drawingId, status: 'idle', snapshot: null, error: '' });

// PNG를 먼저 읽어 크기를 검증한 뒤 메타데이터와 함께 화면에 적용한다.
async function prepare(snapshot: OcrSnapshot) {
  if (!snapshot.result || !snapshot.image_url) return snapshot;
  const url = apiUrl(snapshot.image_url);
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const expected = snapshot.result!.image;
      if (image.naturalWidth !== expected.width_px || image.naturalHeight !== expected.height_px) {
        reject(new Error('OCR PNG와 JSON의 이미지 크기가 다릅니다.')); return;
      }
      resolve();
    };
    image.onerror = () => reject(new Error('OCR 결과 PNG를 불러오지 못했습니다.'));
    image.src = url;
  });
  return snapshot;
}

export function useDrawingOcr(drawingId: string | null) {
  const [state, setState] = useState<State>(() => empty(drawingId));
  const sequence = useRef(0);
  const activeId = useRef(drawingId);
  activeId.current = drawingId;

  useEffect(() => {
    const token = ++sequence.current;
    const controller = new AbortController();
    setState({ ...empty(drawingId), status: drawingId ? 'loading' : 'idle' });
    if (drawingId) {
      fetchOcr(drawingId, controller.signal).then(prepare).then((snapshot) => {
        if (token === sequence.current && !controller.signal.aborted) {
          setState({ drawingId, snapshot, status: snapshot.result ? 'ready' : 'idle', error: '' });
        }
      }).catch((error) => {
        if (token === sequence.current && !controller.signal.aborted) {
          setState({ ...empty(drawingId), status: 'error', error: String(error.message || error) });
        }
      });
    }
    return () => { controller.abort(); ++sequence.current; };
  }, [drawingId]);

  async function applySample() {
    if (!drawingId) return;
    const target = drawingId;
    const token = ++sequence.current;
    setState((previous) => ({ ...previous, drawingId: target, status: 'applying', error: '' }));
    try {
      const snapshot = await prepare(await applySampleOcr(target));
      if (token === sequence.current && activeId.current === target) {
        setState({ drawingId: target, status: 'ready', snapshot, error: '' });
      }
    } catch (error) {
      if (token === sequence.current && activeId.current === target) {
        setState((previous) => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : '결과 적용 실패' }));
      }
    }
  }
  const visible = state.drawingId === drawingId ? state : empty(drawingId);
  return { ...visible, applySample };
}
