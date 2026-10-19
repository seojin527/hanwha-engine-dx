/**
 * 도면 업로드 (백엔드 없이 브라우저에서 처리)
 * - PDF는 첫 페이지를 이미지로 그리고, PNG/JPG는 그대로 읽는다.
 * - 파일명이 추출 결과가 있는 도면(예: HDH_63_05.pdf)과 같으면
 *   그 도면의 추출 데이터 좌표계(가로·세로 px)에 맞춰 그려 측정 항목을 바로 연결한다.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DemoDrawingEntry } from "./demoDrawings";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg";
const MAX_SIZE = 30 * 1024 * 1024;
const DEFAULT_DPI = 200; // eDOCr2 변환과 같은 해상도

export interface RasterResult {
  url: string;
  width: number;
  height: number;
  /** 요청한 크기(추출 데이터 좌표계)에 맞춰 그렸는지 */
  fitted: boolean;
}

export function validateUpload(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) return "PDF, PNG, JPG 파일만 올릴 수 있습니다.";
  if (file.size === 0) return "빈 파일입니다.";
  if (file.size > MAX_SIZE) return "파일은 30MB 이하여야 합니다.";
  return null;
}

/** 파일명으로 추출 결과가 있는 도면 찾기: HDH_63_05.pdf, hdh-63-5.png → HDH_63_05 */
export function matchDrawingId(fileName: string, index: DemoDrawingEntry[]): string | null {
  const stem = fileName.replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const ids = index.map((entry) => entry.id.toUpperCase());
  const exact = index.find((entry) => entry.id.toUpperCase() === stem);
  if (exact) return exact.id;
  const hdh = stem.match(/HDH_?(\d+)_?(\d+)/);
  if (hdh) {
    const id = `HDH_${hdh[1]}_${hdh[2].padStart(2, "0")}`;
    if (ids.includes(id)) return index[ids.indexOf(id)].id;
  }
  return null;
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("이미지 변환 실패"))), "image/png")
  );
}

function whiteCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

const sameAspect = (w1: number, h1: number, w2: number, h2: number) =>
  Math.abs(w1 / h1 - w2 / h2) / (w2 / h2) < 0.02;

/** 업로드 파일 → 화면 표시용 PNG. target이 있으면 그 크기에 맞춘다(비율이 같을 때만). */
export async function rasterizeUpload(file: File, target?: { width: number; height: number }): Promise<RasterResult> {
  const isPdf = file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const fitted = !!target && sameAspect(base.width, base.height, target.width, target.height);
    const scale = fitted ? target!.width / base.width : DEFAULT_DPI / 72;
    const viewport = page.getViewport({ scale });
    const { canvas, context } = whiteCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    pdf.destroy();
    return { url: await canvasToUrl(canvas), width: canvas.width, height: canvas.height, fitted };
  }

  const bitmap = await createImageBitmap(file);
  const fitted = !!target && sameAspect(bitmap.width, bitmap.height, target.width, target.height);
  const width = fitted ? target!.width : bitmap.width;
  const height = fitted ? target!.height : bitmap.height;
  const { canvas, context } = whiteCanvas(width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { url: await canvasToUrl(canvas), width, height, fitted };
}
