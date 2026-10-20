// 관리자 모드의 수정값과 수정 내역을 담는 타입과 저장 도구.
//
// - 수정값은 도면 추출 결과(public/drawings/*.json)를 바꾸지 않고, 그 위에 덮어쓰는 값으로만 저장한다.
// - 이 브라우저의 localStorage에만 저장된다. 서버·계정·권한 확인은 없다(목업).
// - 도면 id(예: "HDH_63_01")별로 따로 저장하므로 도면을 바꿔도 수정값이 섞이지 않는다.

/** 관리자가 한 항목에 덮어쓴 값. 값이 없는 필드는 도면 추출 값을 그대로 쓴다. */
export interface ItemEdit {
  /** 치수: 기준 치수 */
  nominal?: number;
  /** 치수: 상한 공차(+, 양수) */
  plus?: number;
  /** 치수: 하한 공차(-, 양수로 입력) */
  minus?: number;
  /** 기하공차: 공차값 */
  toleranceValue?: number;
  /** 기하공차: 데이텀 */
  datum?: string;
  /** 측정기 */
  equipment?: string;
  /** 형상 (feature_type 코드. lib/admin/featureTypes.ts 의 목록 중 하나) */
  featureType?: string;
  /** 관리자가 확인을 마쳤는가 */
  confirmed?: boolean;
}

/** 도면 id → (항목 id → 수정값) */
export type AdminEditsByDrawing = Record<string, Record<string, ItemEdit>>;

export interface EditLogEntry {
  id: string;
  /** 수정한 시각 (ms) */
  at: number;
  drawingId: string;
  /** 화면에 표시되는 항목 번호. 0이면 도면 전체에 대한 기록 */
  itemNo: number;
  itemName: string;
  /** 바뀐 항목 이름. 예: 기준 치수, 상한 공차 */
  field: string;
  from: string;
  to: string;
}

export type AppMode = "worker" | "admin";

export const MODE_KEY = "hanwha_admin_mode_v1";
export const ADMIN_EDITS_KEY = "hanwha_admin_edits_v1";
export const ADMIN_LOG_KEY = "hanwha_admin_log_v1";
export const ADMIN_REVIEW_KEY = "hanwha_admin_review_v1";
export const ADMIN_ADDED_KEY = "hanwha_admin_added_v1";
export const MAX_LOG_ENTRIES = 300;

/** 관리자가 OCR이 놓친 치수를 직접 추가할 때 고르는 종류 */
export type AddKind = "LINEAR" | "DIAMETER" | "RADIUS" | "CHAMFER" | "THREAD";

/** 관리자가 추가한 치수 (도면 추출 결과에는 없는 항목) */
export interface AddedDimension {
  /** 항목 id. "ADM1", "ADM2"… (지워도 다시 쓰지 않는다) */
  id: string;
  order: number;
  kind: AddKind;
  nominal: number;
  /** 번호표를 놓을 위치 (이미지 px) */
  x: number;
  y: number;
  /** 측정 위치로 지정한 도면 선들 (이미지 px). 없을 수 있다 */
  lines?: Array<Array<{ x: number; y: number }>>;
}

export interface AddedState {
  nextOrder: number;
  items: AddedDimension[];
}

/** 도면 id → 추가한 치수 */
export type AddedByDrawing = Record<string, AddedState>;

/** 치수 추가 입력 (공차·측정기는 비워 둘 수 있다) */
export interface AddDraft {
  kind: AddKind;
  nominal: number;
  plus?: number;
  minus?: number;
  equipment?: string;
}

/** 도면 id → 관리자 검토 완료 기록. 기록이 있으면 검토가 끝난 도면이다. */
export type ReviewByDrawing = Record<string, { completedAt: number }>;

/** 값이 바뀌는 필드(확인 표시는 제외) */
const VALUE_FIELDS: Array<keyof ItemEdit> = ["nominal", "plus", "minus", "toleranceValue", "datum", "equipment", "featureType"];

/** 값 수정이 하나라도 있는가 (확인 표시만 있으면 false) */
export function hasValueEdit(edit: ItemEdit | undefined): boolean {
  return !!edit && VALUE_FIELDS.some((key) => edit[key] !== undefined);
}

/** 이 도면에 값 수정이 있는가 */
export function hasAnyValueEdit(edits: Record<string, ItemEdit> | undefined): boolean {
  return !!edits && Object.values(edits).some(hasValueEdit);
}

export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved) as T;
  } catch {
    // 저장 데이터가 없거나 잘못된 경우 기본값 사용
  }
  return fallback;
}

export function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 실패 무시
  }
}

export function loadMode(): AppMode {
  try {
    return localStorage.getItem(MODE_KEY) === "admin" ? "admin" : "worker";
  } catch {
    return "worker";
  }
}

/** 수정 내역에 쓰는 시각 표기 (예: 10/19 14:05) */
export function formatLogTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
