/**
 * 측정기 선택 목록과 측정 형상 규칙.
 * 오류사례 DB 4종(피스톤로드 HDH_PR_01·피스톤헤드·커넥팅로드·크랭크샤프트)의
 * '추천 측정기' 칸을 형상·기하공차 종류별로 묶었다. 목록에 없으면 '기타(직접 입력)'.
 */

export const FEATURE_LABEL: Record<string, string> = {
  HOLE: "구멍·내경",
  SHAFT: "축·외경",
  PLANE: "평면·길이",
  SLOT: "홈",
  THREAD: "나사",
  EDGE: "모서리",
  RADIUS: "반지름",
  CHAMFER: "모따기",
};

export const FEATURE_OPTIONS = Object.keys(FEATURE_LABEL);

const BY_FEATURE: Record<string, string[]> = {
  SHAFT: ["외경 마이크로미터", "대형 외측 마이크로미터", "하이트 게이지", "대형 버니어 캘리퍼스", "버니어 캘리퍼스", "파이 테이프", "다이얼게이지", "CMM"],
  HOLE: ["실린더 게이지", "내측 마이크로미터", "봉 마이크로미터(내측)", "핀 게이지", "내시경", "CMM"],
  PLANE: ["버니어 캘리퍼스", "대형 버니어 캘리퍼스", "하이트 게이지", "깊이 마이크로미터", "줄자", "블록게이지", "CMM"],
  SLOT: ["블록게이지", "링 홈 게이지", "버니어 캘리퍼스", "하이트 게이지", "깊이 게이지", "필러 게이지", "CMM"],
  THREAD: ["나사 플러그 게이지", "나사 링 게이지", "깊이 게이지"],
  EDGE: ["확대경", "투영기", "육안 확인"],
  RADIUS: ["R 템플릿", "투영기", "윤곽 측정기", "CMM"],
  CHAMFER: ["모따기 게이지", "버니어 캘리퍼스", "투영기", "확대경"],
};

// 기하공차 기호별 추천 측정기 (기호가 여러 개면 합쳐서 보여준다)
const BY_GDT_SYMBOL: Record<string, string[]> = {
  "⏥": ["정반 + 평면 다이얼게이지", "정반 + 다이얼게이지", "평면도 측정기", "CMM"],
  "○": ["진원도 측정기", "V블록 + 다이얼게이지", "CMM"],
  "⌭": ["원통도 측정기", "진원도 측정기", "대형 외측 마이크로미터", "실린더 게이지", "CMM"],
  "⏤": ["레이저 진직도 측정기", "직선자 + 필러 게이지", "롤러 받침 + 다이얼게이지", "V블록 + 다이얼게이지", "CMM"],
  "⫽": ["정반 + 다이얼게이지", "맨드릴 + 평면 다이얼게이지", "롤러 받침 + 다이얼게이지", "하이트 게이지", "CMM"],
  "⏊": ["CMM", "맨드릴 + 다이얼게이지", "롤러 받침 + 다이얼게이지", "정반 + 다이얼게이지", "직각자"],
  "⊥": ["CMM", "맨드릴 + 다이얼게이지", "롤러 받침 + 다이얼게이지", "정반 + 다이얼게이지", "직각자"],
  "∠": ["정반 + 다이얼게이지", "CMM"],
  "◎": ["V블록 + 다이얼게이지", "진원도 측정기", "CMM"],
  "↗": ["롤러 받침 + 다이얼게이지", "회전 테이블 + 다이얼게이지", "V블록 + 다이얼게이지", "다이얼게이지 + 터닝 장치", "CMM"],
  "⌰": ["롤러 받침 + 다이얼게이지", "회전 테이블 + 다이얼게이지", "V블록 + 다이얼게이지", "CMM"],
  "⌖": ["CMM", "CMM(휴대형 측정 암)", "위치도 전용 지그", "나사 게이지 핀"],
  "⌯": ["CMM", "하이트 게이지"],
  "⌒": ["윤곽 측정기", "투영기", "CMM"],
  "⌓": ["윤곽 측정기", "CMM"],
};

/** 기하공차 기호 목록 (기호 수정용). eDOCr2 기호 알파벳과 같은 글자. */
export const GDT_SYMBOLS: Array<{ symbol: string; name: string }> = [
  { symbol: "⏤", name: "진직도" },
  { symbol: "⏥", name: "평면도" },
  { symbol: "○", name: "진원도" },
  { symbol: "⌭", name: "원통도" },
  { symbol: "⌒", name: "선의 윤곽도" },
  { symbol: "⌓", name: "면의 윤곽도" },
  { symbol: "⏊", name: "직각도" },
  { symbol: "∠", name: "경사도" },
  { symbol: "⫽", name: "평행도" },
  { symbol: "⌖", name: "위치도" },
  { symbol: "◎", name: "동심도" },
  { symbol: "⌯", name: "대칭도" },
  { symbol: "↗", name: "원주 흔들림" },
  { symbol: "⌰", name: "온 흔들림" },
];

export function gdtSymbolName(symbol: string): string {
  if (symbol === "⊥") return "직각도";
  return GDT_SYMBOLS.find((entry) => entry.symbol === symbol)?.name ?? "기하공차";
}

/** 모양 공차: 데이텀이 붙지 않는다. 데이텀이 있으면 기호를 잘못 읽었을 가능성이 크다. */
export const FORM_SYMBOLS = new Set(["⏤", "⏥", "○", "⌭"]);

// 기하공차 기호별로 걸 수 있는 형상
const GDT_FEATURES: Record<string, string[]> = {
  "⏥": ["PLANE"],
  "⏤": ["SHAFT", "HOLE", "PLANE"],
  "○": ["SHAFT", "HOLE"],
  "⌭": ["SHAFT", "HOLE"],
  "⌒": ["PLANE", "RADIUS", "EDGE"],
  "⌓": ["PLANE", "RADIUS"],
  "⏊": ["PLANE", "SHAFT", "HOLE", "SLOT"],
  "⊥": ["PLANE", "SHAFT", "HOLE", "SLOT"],
  "⫽": ["PLANE", "SHAFT", "HOLE", "SLOT"],
  "∠": ["PLANE", "SHAFT", "HOLE", "SLOT"],
  "⌯": ["SLOT", "PLANE", "HOLE"],
  "⌖": ["HOLE", "THREAD", "SHAFT", "SLOT"],
  "◎": ["SHAFT", "HOLE"],
  "↗": ["SHAFT", "HOLE", "PLANE"],
  "⌰": ["SHAFT", "HOLE", "PLANE"],
};

/**
 * 이 항목에 고를 수 있는 측정 형상.
 * 치수: 표기 앞글자로 (⌀ → 축·구멍, C → 모따기, R → 반지름, M → 나사, 숫자만 → 길이 계열)
 * 기하공차: 기호로 (2단 틀이면 두 기호 모두에 맞는 형상)
 */
export function allowedFeatures(options: { dimensionKind?: string | null; gdtSymbols?: string[] }): string[] {
  const symbols = options.gdtSymbols ?? [];
  if (symbols.length) {
    const lists = symbols.map((symbol) => GDT_FEATURES[symbol] ?? FEATURE_OPTIONS);
    const common = lists.reduce((acc, list) => acc.filter((feature) => list.includes(feature)));
    return common.length ? common : Array.from(new Set(lists.flat()));
  }
  switch (options.dimensionKind) {
    case "DIAMETER":
      return ["SHAFT", "HOLE"];
    case "CHAMFER_SIZE":
      return ["CHAMFER"];
    case "RADIUS":
      return ["RADIUS"];
    case "THREAD_SPEC":
      return ["THREAD"];
    case "LINEAR_DIMENSION":
      return ["PLANE", "SHAFT", "HOLE", "SLOT", "EDGE"];
    default:
      return FEATURE_OPTIONS;
  }
}

export const ALL_INSTRUMENTS: string[] = Array.from(
  new Set([...Object.values(BY_FEATURE).flat(), ...Object.values(BY_GDT_SYMBOL).flat()]),
).sort((a, b) => a.localeCompare(b, "ko"));

/**
 * 추천 측정기: 기하공차 기호 기준 → 형상 기준 순서.
 * 형상을 아직 안 골랐으면 고를 수 있는 형상들(예: ⌀ → 축·구멍)의 측정기를 모두 보여준다.
 */
export function recommendedInstruments(options: {
  feature?: string;
  gdtSymbols?: string[];
  candidateFeatures?: string[];
}): string[] {
  const list: string[] = [];
  for (const symbol of options.gdtSymbols ?? []) {
    for (const ch of symbol) list.push(...(BY_GDT_SYMBOL[ch] ?? []));
  }
  const features = options.feature ? [options.feature] : options.candidateFeatures ?? [];
  for (const feature of features) list.push(...(BY_FEATURE[feature] ?? []));
  return Array.from(new Set(list));
}

// 미터 보통나사 피치 (KS B 0201 / ISO 261)
const COARSE_PITCH: Record<number, number> = {
  3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5,
  22: 2.5, 24: 3, 27: 3, 30: 3.5, 33: 3.5, 36: 4, 39: 4, 42: 4.5, 45: 4.5, 48: 5, 52: 5,
  56: 5.5, 60: 5.5, 64: 6, 68: 6,
};

/** 나사 게이지 판정 기준 문구. 예: M36 (보통나사 P4) 나사 게이지: GO 끝까지 통과 · NO-GO 2회전 이내 정지 · 나사산 손상 없음 */
export function threadCriteria(text: string): string {
  const match = text.trim().match(/^M\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?$/);
  if (!match) return `${text} 나사 게이지: GO 끝까지 통과 · NO-GO 2회전 이내 정지 · 나사산 손상 없음이면 합격`;
  const size = Number(match[1]);
  const pitch = match[2]
    ? `가는나사 P${Number(match[2])}`
    : COARSE_PITCH[size] !== undefined
      ? `보통나사 P${COARSE_PITCH[size]}`
      : "피치 확인";
  return `M${match[1]}${match[2] ? `x${match[2]}` : ""} (${pitch}) 나사 게이지: GO 끝까지 통과 · NO-GO 2회전 이내 정지 · 나사산 손상 없음이면 합격`;
}
