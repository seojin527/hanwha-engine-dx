// 번호 마커 배치 보정
// - 기하공차 틀(여러 줄)은 마커를 같은 높이에서 좌우로 나란히 놓는다.
// - 그래도 서로 겹치는 마커는 겹치지 않을 만큼만 밀어낸다 (원래 위치에서 최대 maxShift px).
// 모든 계산은 화면(뷰어) 픽셀 기준이다. 마커 크기는 24px로 고정이다.

export type MarkerSide = "top" | "bottom" | "left" | "right" | "center";

export interface MarkerLayoutInput {
  id: number | string;
  /** 기준점(이미지 px) */
  x: number;
  y: number;
  side?: MarkerSide;
  rowIndex?: number;
  sourceId?: string;
  /** 기하공차 프레임의 좌우 가장자리(이미지 px). 있으면 줄 마커를 프레임 양옆에 나눠 붙인다 */
  frameLeft?: number;
  frameRight?: number;
}

export interface MarkerLayoutResult {
  /** 기하공차 틀 마커의 기준점·붙이는 방향을 바꾼 값(이미지 px). 틀이 아니면 없음 */
  x?: number;
  y?: number;
  side?: MarkerSide;
  /** 기본 배치에 더할 화면 px 이동량 */
  dx: number;
  dy: number;
}

const SIZE = 24;
const GAP = 3;
const ROW_STEP = 27;
const MIN_DIST = SIZE + 2;
const MAX_SHIFT = 24;
const ITERATIONS = 30;

// GDT_003_2 → 틀 키 "GDT_003", 줄 번호 2
function frameKey(sourceId?: string): string | null {
  const match = /^(.*GDT_\d+)_\d+$/.exec(sourceId || "");
  return match ? match[1] : null;
}

function sideOffset(side: MarkerSide): [number, number] {
  const d = SIZE / 2 + GAP;
  if (side === "left") return [-d, 0];
  if (side === "right") return [d, 0];
  if (side === "top") return [0, -d];
  if (side === "bottom") return [0, d];
  return [0, 0];
}

/**
 * scale: 이미지 1px이 뷰어에서 몇 px로 그려지는지.
 * 같은 입력이면 항상 같은 결과가 나온다 (id 순서로 계산).
 */
export function layoutMarkers(
  inputs: MarkerLayoutInput[],
  scale: number,
): Map<number | string, MarkerLayoutResult> {
  const result = new Map<number | string, MarkerLayoutResult>();
  if (!(scale > 0)) return result;

  const valid = inputs.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));

  // 1) 기하공차 틀: 같은 틀의 줄들은 평균 높이에 맞추고 좌우로 나란히 놓는다.
  const frames = new Map<string, MarkerLayoutInput[]>();
  for (const item of valid) {
    const key = frameKey(item.sourceId);
    if (!key || !item.rowIndex) continue;
    frames.set(key, [...(frames.get(key) || []), item]);
  }
  const rowY = new Map<number | string, number>();
  const rowDx = new Map<number | string, number>();
  const rowX = new Map<number | string, number>();
  const rowSide = new Map<number | string, MarkerSide>();
  for (const rows of frames.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => (a.rowIndex || 0) - (b.rowIndex || 0));
    const meanY = sorted.reduce((sum, item) => sum + item.y, 0) / sorted.length;
    const rights = sorted.map((item) => item.frameRight).filter((v): v is number => Number.isFinite(v));
    if (rights.length > 0) {
      // 프레임 가장자리를 알면: 첫째 줄은 프레임 왼쪽, 둘째 줄은 오른쪽, 셋째 줄은 왼쪽 바깥...
      const left = Math.min(...sorted.map((item) => item.frameLeft ?? item.x));
      const right = Math.max(...rights);
      sorted.forEach((item, order) => {
        const onLeft = order % 2 === 0;
        const depth = Math.floor(order / 2);
        rowY.set(item.id, meanY);
        rowX.set(item.id, onLeft ? left : right);
        rowSide.set(item.id, onLeft ? "left" : "right");
        rowDx.set(item.id, (onLeft ? -1 : 1) * depth * ROW_STEP);
      });
    } else {
      sorted.forEach((item, order) => {
        rowY.set(item.id, meanY);
        // 가장자리를 모르면 마커가 놓이는 바깥 방향으로 나란히 늘어놓는다
        rowDx.set(item.id, (item.side === "right" ? 1 : -1) * order * ROW_STEP);
      });
    }
  }

  // 2) 시작 위치(화면 px)
  const nodes = [...valid]
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
    .map((item) => {
      const [sx, sy] = sideOffset(rowSide.get(item.id) ?? item.side ?? "center");
      const baseX = (rowX.get(item.id) ?? item.x) * scale + sx;
      const baseY = (rowY.get(item.id) ?? item.y) * scale + sy;
      const startX = baseX + (rowDx.get(item.id) || 0);
      // 기하공차 틀의 마커는 줄 사이 간격(좌우 배치)을 유지하도록 고정하고, 다른 마커가 비켜 준다.
      const pinned = rowY.has(item.id);
      return { id: item.id, baseX, baseY, startX, startY: baseY, x: startX, y: baseY, pinned };
    });

  // 3) 겹치는 마커 밀어내기
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let vx = b.x - a.x;
        let vy = b.y - a.y;
        let dist = Math.hypot(vx, vy);
        if (dist >= MIN_DIST) continue;
        if (dist < 0.01) {
          // 완전히 같은 자리: 순서에 따라 가로로 갈라 놓는다
          vx = 1;
          vy = 0;
          dist = 1;
        }
        const push = MIN_DIST - dist + 0.5;
        const ux = vx / dist;
        const uy = vy / dist;
        // 고정된 쪽은 움직이지 않고 상대가 전부 비킨다. 둘 다 같은 상태면 절반씩 민다.
        const aShare = a.pinned === b.pinned ? 0.5 : a.pinned ? 0 : 1;
        const bShare = 1 - aShare;
        a.x -= ux * push * aShare;
        a.y -= uy * push * aShare;
        b.x += ux * push * bShare;
        b.y += uy * push * bShare;
        moved = true;
      }
    }
    // 원래 위치에서 너무 멀어지지 않게 제한
    for (const node of nodes) {
      if (node.pinned) {
        node.x = Math.max(node.startX - MAX_SHIFT, Math.min(node.startX + MAX_SHIFT, node.x));
        node.y = node.startY;
      }
      const ox = node.x - node.startX;
      const oy = node.y - node.startY;
      const d = Math.hypot(ox, oy);
      if (d > MAX_SHIFT) {
        node.x = node.startX + (ox / d) * MAX_SHIFT;
        node.y = node.startY + (oy / d) * MAX_SHIFT;
      }
    }
    if (!moved) break;
  }

  for (const node of nodes) {
    result.set(node.id, {
      x: rowX.get(node.id),
      y: rowY.get(node.id),
      side: rowSide.get(node.id),
      dx: node.x - node.baseX,
      dy: node.y - node.baseY,
    });
  }
  return result;
}
