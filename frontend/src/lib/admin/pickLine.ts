// 도면 위 한 지점을 눌렀을 때 그 자리의 "선 자체"를 찾는다. (관리자 치수 추가에서 측정 위치를 고르는 용도)
//  - 가까운 선분을 찾고, 같은 직선 위에 이어진 선분들을 한 줄로 묶는다.
//  - 짧은 선분이 이어진 곡선(호·원)이면 매끄럽게 이어지는 선분을 따라간다.
// 좌표는 도면 이미지 픽셀이다. 위치 정보만 쓰며 OCR과 무관하다.

import type { Point } from "./highlights";

type Seg = [number, number, number, number];

let cached: Seg[] | null = null;

/** 선 좌표를 한 번만 불러온다 (용량이 커서 처음 필요할 때 dynamic import) */
export async function loadSegments(): Promise<Seg[]> {
  if (cached) return cached;
  const { LINE_SEGMENTS } = await import("./lineGeometry");
  const segs: Seg[] = [];
  for (let i = 0; i + 3 < LINE_SEGMENTS.length; i += 4) {
    segs.push([LINE_SEGMENTS[i], LINE_SEGMENTS[i + 1], LINE_SEGMENTS[i + 2], LINE_SEGMENTS[i + 3]]);
  }
  cached = segs;
  return segs;
}

function distToSeg(px: number, py: number, s: Seg): number {
  const [x1, y1, x2, y2] = s;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const angleOf = (s: Seg) => ((Math.atan2(s[3] - s[1], s[2] - s[0]) % Math.PI) + Math.PI) % Math.PI;

/** 같은 직선 위에 이어진 선분들을 하나의 선(양 끝점)으로 묶는다 */
function collinearLine(segs: Seg[], i0: number): { line: Point[]; length: number } {
  const base = segs[i0];
  const a = angleOf(base);
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const c = nx * base[0] + ny * base[1];
  const GAP = 16;
  const pos = (s: Seg): [number, number] => {
    const p = ux * s[0] + uy * s[1];
    const q = ux * s[2] + uy * s[3];
    return p < q ? [p, q] : [q, p];
  };
  let [lo, hi] = pos(base);
  const used = new Set<number>([i0]);
  let changed = true;
  while (changed) {
    changed = false;
    segs.forEach((s, i) => {
      if (used.has(i)) return;
      const da = Math.abs((((angleOf(s) - a + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI - Math.PI / 2);
      if (da > 0.05) return;
      if (Math.abs(nx * s[0] + ny * s[1] - c) >= 2 || Math.abs(nx * s[2] + ny * s[3] - c) >= 2) return;
      const [p0, p1] = pos(s);
      if (p1 >= lo - GAP && p0 <= hi + GAP) {
        used.add(i);
        lo = Math.min(lo, p0);
        hi = Math.max(hi, p1);
        changed = true;
      }
    });
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    line: [
      { x: r(ux * lo + nx * c), y: r(uy * lo + ny * c) },
      { x: r(ux * hi + nx * c), y: r(uy * hi + ny * c) },
    ],
    length: hi - lo,
  };
}

/** 끝점이 맞닿고 꺾임이 작은 선분을 양쪽으로 따라가 곡선(호·원) 한 줄로 묶는다 */
function traceCurve(segs: Seg[], i0: number): Point[] {
  const JOIN = 2;
  const MAX_TURN = 0.6;
  const MAX_COUNT = 4000;
  const used = new Set<number>([i0]);
  const ends = (s: Seg): [Point, Point] => [
    { x: s[0], y: s[1] },
    { x: s[2], y: s[3] },
  ];
  const d = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

  const extend = (start: Point): Seg[] => {
    const out: Seg[] = [];
    let pt = start;
    let lastDir: number | null = null;
    let cur = i0;
    // 시작 선분에서 start 반대쪽 끝으로 나아간다
    {
      const [a, b] = ends(segs[cur]);
      const far = d(a, start) < d(b, start) ? b : a;
      const near = far === b ? a : b;
      lastDir = Math.atan2(far.y - near.y, far.x - near.x);
      pt = far;
    }
    while (out.length < MAX_COUNT) {
      let best: { turn: number; j: number; o: Point; dir: number } | null = null;
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j)) continue;
        const [a, b] = ends(segs[j]);
        for (const [e, o] of [[a, b], [b, a]] as Array<[Point, Point]>) {
          if (d(e, pt) <= JOIN) {
            const dir = Math.atan2(o.y - e.y, o.x - e.x);
            const turn = Math.abs((((dir - (lastDir as number) + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
            if (turn <= MAX_TURN && (!best || turn < best.turn)) best = { turn, j, o, dir };
          }
        }
      }
      if (!best) break;
      used.add(best.j);
      out.push(segs[best.j]);
      pt = best.o;
      lastDir = best.dir;
    }
    return out;
  };

  const [a, b] = ends(segs[i0]);
  const fwd = extend(a);
  const back = extend(b);
  const ordered: Seg[] = [...back.reverse(), segs[i0], ...fwd];

  // 선분들을 이어 점 목록으로
  const pts: Point[] = [];
  for (const s of ordered) {
    const [p, q] = ends(s);
    if (pts.length === 0) {
      pts.push(p, q);
      continue;
    }
    const last = pts[pts.length - 1];
    if (d(p, last) <= d(q, last)) pts.push(p, q);
    else pts.push(q, p);
  }
  // 첫 선분 방향 보정: 두 번째 선분과 이어지지 않는 쪽이 시작점이어야 한다
  if (ordered.length > 1 && pts.length >= 4) {
    const [n0, n1] = ends(ordered[1]);
    const dist0 = Math.min(d(pts[0], n0), d(pts[0], n1));
    const dist1 = Math.min(d(pts[1], n0), d(pts[1], n1));
    if (dist0 < dist1) {
      // 시작이 뒤바뀐 경우: 다시 처음 선분을 뒤집어 이어 붙인다
      const rebuilt: Point[] = [pts[1], pts[0]];
      for (const s of ordered.slice(1)) {
        const [p, q] = ends(s);
        const last = rebuilt[rebuilt.length - 1];
        if (d(p, last) <= d(q, last)) rebuilt.push(p, q);
        else rebuilt.push(q, p);
      }
      pts.splice(0, pts.length, ...rebuilt);
    }
  }
  const dedup: Point[] = [];
  for (const p of pts) if (dedup.length === 0 || d(p, dedup[dedup.length - 1]) > 0.01) dedup.push(p);
  return simplifyPolyline(dedup, 0.7);
}

function simplifyPolyline(points: Point[], eps: number): Point[] {
  const rnd = (p: Point): Point => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  const dp = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let dmax = 0;
    let idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const dd = Math.abs((b.y - a.y) * pts[i].x - (b.x - a.x) * pts[i].y + b.x * a.y - b.y * a.x) / len;
      if (dd > dmax) {
        dmax = dd;
        idx = i;
      }
    }
    if (dmax > eps) return [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))];
    return [a, b];
  };
  // 닫힌 도형(원)은 반으로 나눠 단순화해야 두 점으로 뭉개지지 않는다
  if (points.length > 4 && Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < 3) {
    const m = Math.floor(points.length / 2);
    return [...dp(points.slice(0, m + 1)).slice(0, -1), ...dp(points.slice(m))].map(rnd);
  }
  return dp(points).map(rnd);
}

/**
 * 도면 이미지 픽셀 좌표 pt 근처(radius 이내)의 선 하나를 찾는다.
 * 없으면 null. 반환값은 파란색으로 칠할 선(점 목록)이다.
 */
export function pickLineAt(segs: Seg[], pt: Point, radius = 20): Point[] | null {
  let best = -1;
  let bestD = Infinity;
  segs.forEach((s, i) => {
    const dd = distToSeg(pt.x, pt.y, s);
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  });
  if (best < 0 || bestD > radius) return null;
  const straight = collinearLine(segs, best);
  // 충분히 긴 직선이면 직선으로, 짧은 선분이 이어진 곡선이면 따라가서 묶는다
  if (straight.length >= 30) return straight.line;
  const curve = traceCurve(segs, best);
  return curve.length >= 2 ? curve : straight.line;
}
