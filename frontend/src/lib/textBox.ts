// 치수·기하공차 글자 영역(text_box)과 번호 마커를 붙일 기준점(label_anchor)을 정한다.
//
// 데모 도면(HDH_63_01~10)의 JSON에는 이 두 값이 들어 있다. 서버 OCR 도면은 글자 "중심 좌표"만 있고
// 글자 영역이 없으므로, 이 경우에만 글자 수와 이미지 폭으로 영역을 "추정"한다.
// 추정값은 estimated=true 로 표시해 화면에서 점선 등으로 실제 값과 구분한다. (정확한 값이 아님)
// 정확한 값은 OCR 단계(eDOCr2)에서 글자 박스를 함께 내보내야 얻을 수 있다.

export type Box = [number, number, number, number];
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';
export interface Anchor { x: number; y: number; side: AnchorSide }

export interface GeometryItem {
  category: string;
  raw_text: string;
  position: { x: number; y: number };
  row_index?: number;
  text_box?: Box;
  label_anchor?: Anchor;
}

export interface ItemGeometry {
  textBox?: Box;
  labelAnchor?: Anchor;
  /** 추정한 값인가 (false 이거나 없으면 도면 데이터에 있던 값) */
  estimated: boolean;
  /** 기하공차 프레임의 왼쪽·오른쪽 가장자리 x(px). 줄 마커를 프레임 좌우에 나눠 붙일 때 쓴다 */
  frameLeft?: number;
  frameRight?: number;
}

/** 글자 높이 어림값(px). 데모 도면 2339px 폭에서 약 42px */
const charHeight = (imageWidth: number) => Math.max(12, Math.round(imageWidth / 55));

/**
 * 기하공차 항목의 프레임 안 줄 번호(1부터).
 * eDOCr2 는 틀 하나에 좌표를 하나만 주므로 같은 프레임의 줄들은 position 이 같다.
 * row_index 가 없으면 "같은 좌표의 기하공차 항목" 중 몇 번째인지로 줄을 나눈다. 치수는 0.
 */
export function gdtRowIndexes(items: Array<Pick<GeometryItem, 'category' | 'position' | 'row_index'>>): number[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    if (item.category !== 'GDT') return 0;
    const key = `${item.position.x},${item.position.y}`;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return item.row_index || count;
  });
}

/**
 * 기하공차 프레임 폭 어림값(px). 칸 구분 '|' 로 나뉜 글자("기호|공차값|데이텀...")로 계산한다.
 * 실제 프레임 폭이 아니라 추정이다. 글자 박스가 없는 서버 OCR 도면에서만 쓴다.
 */
export function estimateGdtFrameWidth(rawText: string, imageWidth: number): number {
  const ch = charHeight(imageWidth);
  const cells = String(rawText || '').split('|').map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2) return Math.round(ch * (0.8 + 0.3 * Math.max(1, String(rawText || '').length)));
  const [, ...rest] = cells;
  const body = rest.reduce((sum, cell) => sum + 0.25 * cell.length + 0.5, 0);
  return Math.round(ch * (0.8 + body + 0.3));
}

export function resolveGeometry(item: GeometryItem, imageWidth: number, rowIndex?: number): ItemGeometry {
  if (item.text_box || item.label_anchor) {
    const box = item.text_box;
    return {
      textBox: box, labelAnchor: item.label_anchor, estimated: false,
      ...(box && item.category === 'GDT' ? { frameLeft: box[0], frameRight: box[2] } : {}),
    };
  }
  const { x, y } = item.position;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(imageWidth > 0)) return { estimated: false };
  const ch = charHeight(imageWidth);

  if (item.category === 'GDT') {
    // 기하공차는 position 이 프레임 왼쪽 위 모서리이고, 한 프레임에 줄이 여러 개 있다.
    // 프레임 폭을 알 수 없어 박스는 만들지 않고, 줄마다 프레임 왼쪽 바깥에 마커를 붙인다.
    const rowHeight = Math.round(ch * 1.3);
    const row = Math.max(1, item.row_index || rowIndex || 1);
    return {
      labelAnchor: { x, y: y + rowHeight * (row - 0.5), side: 'left' }, estimated: true,
      frameLeft: x, frameRight: x + estimateGdtFrameWidth(item.raw_text, imageWidth),
    };
  }

  const cw = ch * 0.62;
  const width = cw * Math.max(1, item.raw_text.length) + 8;
  const height = ch + 2;
  const box: Box = [x - width / 2, y - height / 2, x + width / 2, y + height / 2].map(Math.round) as Box;
  return { textBox: box, labelAnchor: { x: box[2], y, side: 'right' }, estimated: true };
}
