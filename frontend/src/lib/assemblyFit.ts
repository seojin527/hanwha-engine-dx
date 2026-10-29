/**
 * 조립 전용 "결합 정보" 계산.
 * - 관리자가 구멍/축을 직접 지정한 지름 치수만 대상으로 한다 (시스템 기본값은 확정으로 보지 않는다).
 * - 짝 후보는 "다른 부품의, 검토 완료된 도면에서, 기준치수가 같고 형상이 반대인 항목"일 뿐이다.
 *   실제로 서로 결합하는 부품인지는 도면으로 확인해야 하며, 합격/불합격 기준은 만들지 않는다.
 */
import { fetchDrawings, fetchOcr, fetchParts } from './drawingAPI';
import type { OcrItem } from './ocr';

export type FitShape = 'HOLE' | 'SHAFT';

export interface Limits {
  lower: number;
  upper: number;
}

/** 이 치수의 결합 정보 상태 */
export type OwnFit =
  | { kind: 'hidden' } // 지름/구멍/축 치수가 아니면 카드를 보여주지 않는다
  | { kind: 'unconfirmed'; nominal: number; limits: Limits | null } // 구멍/축이 시스템 기본값
  | { kind: 'confirmed'; shape: FitShape; nominal: number; limits: Limits | null };

export interface PeerItem {
  drawingId: string;
  partId: string;
  partName: string;
  fileName: string;
  /** 도면 안에서 보이는 번호 (items 배열 순서 + 1, 작업 화면 번호와 같은 규칙) */
  number: number;
  itemId: string;
  rawText: string;
  shape: FitShape;
  nominal: number;
  limits: Limits;
}

export interface FitPair {
  peer: PeerItem;
  /** 간극(+) / 간섭(-). 구멍 한계 치수 - 축 한계 치수 */
  minClearance: number;
  maxClearance: number;
  kind: 'clearance' | 'transition' | 'interference';
}

const EPSILON = 1e-9;

function round(value: number): number {
  return Number(value.toFixed(6));
}

export function limitsOf(item: OcrItem): Limits | null {
  if (typeof item.lower_limit !== 'number' || typeof item.upper_limit !== 'number') return null;
  return { lower: item.lower_limit, upper: item.upper_limit };
}

/** 관리자가 구멍/축을 직접 고른 항목인가 (defaults_applied 에 feature_type 이 있으면 시스템 기본값) */
export function isShapeConfirmed(item: OcrItem): boolean {
  return (
    (item.feature_type === 'HOLE' || item.feature_type === 'SHAFT') &&
    !(item.defaults_applied ?? []).includes('feature_type')
  );
}

export function ownFit(item: OcrItem): OwnFit {
  if (item.category !== 'DIMENSION') return { kind: 'hidden' };
  if (typeof item.nominal_value !== 'number') return { kind: 'hidden' };
  const isDiameter = item.measurement_characteristic === 'DIAMETER';
  const isHoleOrShaft = item.feature_type === 'HOLE' || item.feature_type === 'SHAFT';
  if (!isDiameter && !isHoleOrShaft) return { kind: 'hidden' };

  const limits = limitsOf(item);
  if (isShapeConfirmed(item)) {
    return { kind: 'confirmed', shape: item.feature_type as FitShape, nominal: item.nominal_value, limits };
  }
  return { kind: 'unconfirmed', nominal: item.nominal_value, limits };
}

/** 구멍 쪽/축 쪽 한계 치수로 이론 간극 범위를 구한다. 음수는 간섭. */
export function clearanceRange(hole: Limits, shaft: Limits): { min: number; max: number } {
  return { min: round(hole.lower - shaft.upper), max: round(hole.upper - shaft.lower) };
}

export function classifyFit(min: number, max: number): FitPair['kind'] {
  if (min >= 0) return 'clearance';
  if (max <= 0) return 'interference';
  return 'transition';
}

/** 같은 기준치수 + 반대 형상 + 한계 치수가 모두 있는 항목만 짝 후보. */
export function findFitPairs(own: Extract<OwnFit, { kind: 'confirmed' }>, peers: PeerItem[]): FitPair[] {
  if (!own.limits) return [];
  const pairs: FitPair[] = [];
  for (const peer of peers) {
    if (peer.shape === own.shape) continue;
    if (Math.abs(peer.nominal - own.nominal) > EPSILON) continue;
    const hole = own.shape === 'HOLE' ? own.limits : peer.limits;
    const shaft = own.shape === 'SHAFT' ? own.limits : peer.limits;
    const { min, max } = clearanceRange(hole, shaft);
    pairs.push({ peer, minClearance: min, maxClearance: max, kind: classifyFit(min, max) });
  }
  return pairs.sort(
    (a, b) => a.peer.partName.localeCompare(b.peer.partName) || a.peer.fileName.localeCompare(b.peer.fileName) || a.peer.number - b.peer.number,
  );
}

/**
 * 다른 부품의 검토 완료 도면에서 짝 후보가 될 수 있는 항목을 모은다.
 * 조건: 검토 완료 + 관리자가 검사 기준을 확정한 치수 + 구멍/축을 직접 지정 + 기준치수·한계 치수 존재.
 */
export function collectPeerItems(
  drawing: { drawingId: string; partId: string; partName: string; fileName: string },
  items: OcrItem[],
): PeerItem[] {
  const peers: PeerItem[] = [];
  items.forEach((item, index) => {
    if (item.category !== 'DIMENSION') return;
    if (item.inspection_approved !== true) return;
    if (!isShapeConfirmed(item)) return;
    if (typeof item.nominal_value !== 'number') return;
    const limits = limitsOf(item);
    if (!limits) return;
    peers.push({
      ...drawing,
      number: index + 1,
      itemId: item.id,
      rawText: item.raw_text.replace(/\n/g, '  '),
      shape: item.feature_type as FitShape,
      nominal: item.nominal_value,
      limits,
    });
  });
  return peers;
}

/**
 * 서버에 등록된 모든 부품/도면을 읽어 짝 후보 항목을 모은다 (읽기 전용 조회만 한다).
 * 현재 도면과 같은 부품의 다른 버전은 짝이 될 수 없으므로 제외한다.
 * 도면 하나를 못 읽어도 나머지로 계속한다.
 */
export async function loadPeerItems(currentDrawingId: string, signal?: AbortSignal): Promise<PeerItem[]> {
  const { parts } = await fetchParts(signal);
  const lists = await Promise.all(
    parts.map(async (part) => {
      try {
        const { drawings } = await fetchDrawings(part.part_id, signal);
        return drawings.map((drawing) => ({ part, drawing }));
      } catch {
        return [];
      }
    }),
  );
  const all = lists.flat();
  const currentPartId = all.find((entry) => entry.drawing.drawing_id === currentDrawingId)?.part.part_id;

  const targets = all.filter((entry) => entry.part.part_id !== currentPartId);
  const loaded = await Promise.all(
    targets.map(async ({ part, drawing }) => {
      try {
        const snapshot = await fetchOcr(drawing.drawing_id, signal);
        const result = snapshot.result;
        if (snapshot.status !== 'completed' || !result || result.review_status !== 'reviewed') return [];
        return collectPeerItems(
          { drawingId: drawing.drawing_id, partId: part.part_id, partName: part.name, fileName: drawing.original_filename },
          result.items,
        );
      } catch {
        return [];
      }
    }),
  );
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  return loaded.flat();
}
