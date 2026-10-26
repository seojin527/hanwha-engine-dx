/**
 * 도면의 부품 이름 → 3D 엔진 뷰어(public/engine-viewer)의 부품 코드 대응.
 *
 * 3D 뷰어에는 아래 5종만 있다. 이름이 이 5종에 해당하지 않으면 null 이며,
 * 이 경우 뷰어는 강조 없이 엔진 전체만 보여준다.
 * 도면의 표제란 PART NO. 는 사용하지 않는다 (예: 크랭크샤프트 도면의 번호가 PM01-CR-6001 로
 * 커넥팅 로드(CR)와 헷갈릴 수 있음). 부품 이름만 기준으로 한다.
 */

export type EnginePartKey = "CS" | "CR" | "CH" | "PR" | "PH";

export const ENGINE_PART_LABEL: Record<EnginePartKey, string> = {
  CS: "크랭크 축",
  CR: "커넥팅 로드",
  CH: "크로스헤드",
  PR: "피스톤 로드",
  PH: "피스톤 헤드",
};

// 앞에서부터 먼저 맞는 규칙을 쓴다. (공백·대소문자는 무시)
const RULES: Array<[EnginePartKey, string[]]> = [
  ["PR", ["피스톤로드", "pistonrod"]],
  ["PH", ["피스톤헤드", "pistonhead"]],
  ["CR", ["커넥팅", "connectingrod", "conrod"]],
  ["CH", ["크로스헤드", "crosshead"]],
  ["CS", ["크랭크", "crankshaft"]],
];

export function toEnginePartKey(partName?: string | null): EnginePartKey | null {
  const name = (partName ?? "").replace(/\s+/g, "").toLowerCase();
  if (!name) return null;
  for (const [key, words] of RULES) {
    if (words.some((word) => name.includes(word))) return key;
  }
  return null;
}

export type EngineViewerCheck = { ok: true; partKey: EnginePartKey } | { ok: false; message: string };

/**
 * 3D 뷰어를 열 수 있는지 판단한다.
 * - 도면이 선택되지 않았으면 열지 않는다.
 * - 도면의 부품이 3D 모델에 없으면(또는 부품 이름을 알 수 없으면) 열지 않고 안내 문구만 돌려준다.
 */
export function checkEngineViewer(input: { hasDrawing: boolean; partName?: string | null }): EngineViewerCheck {
  if (!input.hasDrawing) {
    return { ok: false, message: "도면을 먼저 선택해 주세요. 선택한 도면의 부품을 3D 뷰어에서 빨간색으로 보여드립니다." };
  }
  const name = (input.partName ?? "").trim();
  if (!name) {
    return { ok: false, message: "이 도면의 부품 이름을 확인할 수 없어 3D 뷰어를 열 수 없습니다. (OCR 결과의 부품명이 필요합니다)" };
  }
  const partKey = toEnginePartKey(name);
  if (!partKey) {
    const available = Object.values(ENGINE_PART_LABEL).join(", ");
    return { ok: false, message: `이 도면의 부품(${name})은 3D 모델이 없어 3D 뷰어를 열 수 없습니다. 3D 모델이 있는 부품: ${available}` };
  }
  return { ok: true, partKey };
}
