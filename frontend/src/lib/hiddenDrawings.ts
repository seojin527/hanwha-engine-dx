// 도면 목록에서 "뺀" 도면을 이 브라우저(localStorage)에만 기록한다.
// 서버 DB, 업로드 파일, OCR 결과는 전혀 건드리지 않는다.
const KEY = "hiddenDrawings.v1";

export interface HiddenDrawing {
  partId: string;
  name: string;
}

export type HiddenMap = Record<string, HiddenDrawing>;

export function loadHidden(): HiddenMap {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as HiddenMap) : {};
  } catch {
    return {};
  }
}

export function saveHidden(map: HiddenMap): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에서만 적용된다.
  }
}
