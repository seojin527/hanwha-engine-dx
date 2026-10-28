import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, type ErrorCandidate } from "./drawingAPI";
import type { MeasurementRecord } from "./measurementAPI";

/** 부품제작(가공 중 측정) 황삭·중삭·정삭 API. backend/machining_api.py */

export type StageKey = "1" | "2" | "3";
export const STAGE_KEYS: StageKey[] = ["1", "2", "3"];
export const STAGE_NAME: Record<StageKey, string> = { "1": "황삭", "2": "중삭", "3": "정삭" };

export interface StageCriteria {
  role: "finish" | "allowance" | "final";
  mode: "numeric" | "gauge";
  /** roughness: 표면 거칠기(Ra, µm, 상한만) · fit: 괄호로 적은 끼워맞춤 공차를 이 모듈이 읽은 경우 */
  kind?: "roughness" | "fit";
  target: number | null;
  allowance: number;
  lower_limit: number | null;
  upper_limit: number | null;
  text: string;
}

export interface MachiningItem {
  item_id: string;
  raw_text: string;
  plan: "R" | "RF" | "F" | "S" | "none";
  plan_label: string;
  label: string;
  source: "template" | "rule";
  template_key: string | null;
  stages: Record<StageKey, StageCriteria | null>;
}

export interface MachiningRecord extends MeasurementRecord {
  serial: string;
  stage: StageKey;
  zero_checked: boolean;
  criteria: StageCriteria;
}

export interface StageStatus {
  required: number;
  recorded: number;
  passed: number;
  failed: number;
  complete: boolean;
  unlocked: boolean;
}

export interface MachiningPlan {
  drawing_id: string;
  revision: string;
  serial: string;
  serials: string[];
  part_key: string | null;
  part_label: string;
  stage_labels: Record<StageKey, string>;
  template_found: boolean;
  items: MachiningItem[];
  records: MachiningRecord[];
  status: Record<StageKey, StageStatus>;
}

export interface StageRecordBody {
  measured_value: string;
  gauge_result: "pass" | "fail" | null;
  confirmed: boolean;
  zero_checked: boolean;
  instrument: string;
  note: string;
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `요청 실패 (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((e: { msg?: string }) => e.msg ?? String(e)).join("\n");
    } catch {
      // 기본 메시지 사용
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const base = (drawingId: string) => `/api/machining/${encodeURIComponent(drawingId)}`;

export async function fetchMachiningPlan(drawingId: string, revision: string, serial: string, signal?: AbortSignal) {
  const query = `revision=${encodeURIComponent(revision)}&serial=${encodeURIComponent(serial)}`;
  return read<MachiningPlan>(await fetch(apiUrl(`${base(drawingId)}/plan?${query}`), { signal }));
}

export async function saveStageRecord(
  drawingId: string,
  itemId: string,
  body: StageRecordBody & { revision: string; serial: string; stage: StageKey },
) {
  return read<MachiningRecord>(
    await fetch(apiUrl(`${base(drawingId)}/items/${encodeURIComponent(itemId)}/record`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** 선택한 단계(+가공 공통)의 오류사례만 찾는다. */
export async function fetchStageErrors(drawingId: string, itemId: string, stage: StageKey, signal?: AbortSignal) {
  return read<{ item_id: string; stage: StageKey; errors: ErrorCandidate[] }>(
    await fetch(apiUrl(`${base(drawingId)}/items/${encodeURIComponent(itemId)}/errors?stage=${stage}`), { signal }),
  );
}

export function stageReportUrl(drawingId: string, revision: string) {
  return apiUrl(`${base(drawingId)}/report.xlsx?revision=${encodeURIComponent(revision)}`);
}

/** 목표·허용 범위 가운데 (보정값 계산 기준) */
export function criteriaCenter(criteria: StageCriteria): number | null {
  if (criteria.kind === "roughness") return null; // 조도는 공구 보정량 안내를 하지 않는다
  if (criteria.role === "allowance") return criteria.target;
  if (typeof criteria.lower_limit === "number" && typeof criteria.upper_limit === "number") {
    return (criteria.lower_limit + criteria.upper_limit) / 2;
  }
  return null;
}

/**
 * 시연용 빠른 입력 값: 이번 단계 판정 범위의 가운데.
 * 여유치수 단계는 목표, 조도는 0 ~ Ra 의 절반, 나머지는 하한·상한의 가운데.
 */
export function criteriaMidpoint(criteria: StageCriteria): number | null {
  if (criteria.mode !== "numeric") return null;
  const low = criteria.lower_limit;
  const high = criteria.upper_limit;
  let mid: number | null = null;
  if (criteria.role === "allowance" && typeof criteria.target === "number") mid = criteria.target;
  else if (typeof low === "number" && typeof high === "number") mid = (low + high) / 2;
  return mid === null ? null : Number(mid.toFixed(4));
}

const QUICK_FILL_KEY = "machining-quick-fill";
/** 시연용 빠른 입력(가운데 값 자동 입력·0점 자동 체크·합격 후 다음 항목) 켜짐 여부 */
export const quickFillRemembered = () => remembered(QUICK_FILL_KEY) === "on";
export const rememberQuickFill = (on: boolean) => remember(QUICK_FILL_KEY, on ? "on" : "off");

function remembered(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 브라우저 저장소를 못 쓰면 기억하지 않는다.
  }
}

export interface MachiningState {
  plan: MachiningPlan | null;
  loading: boolean;
  error: string;
  stage: StageKey;
  setStage: (stage: StageKey) => void;
  serial: string;
  setSerial: (serial: string) => void;
  refresh: () => void;
  /** 현재 단계에서 재야 하는 item_id (계획이 없으면 null) */
  stageItemIds: Set<string> | null;
  /** 현재 단계 기록 (item_id → 기록) */
  stageRecords: Record<string, MachiningRecord>;
  itemPlan: (itemId: string | undefined) => MachiningItem | undefined;
  /** 이 제품·단계에서 0점 확인한 측정기 */
  zeroChecked: (instrument: string) => boolean;
  markZeroChecked: (instrument: string, checked: boolean) => void;
}

/** 도면·버전·제품 번호별 가공 단계 계획과 기록. */
export function useMachining(drawingId: string | null, revision: string | undefined): MachiningState {
  const [plan, setPlan] = useState<MachiningPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStageState] = useState<StageKey>("1");
  const [serial, setSerialState] = useState("");
  const [tick, setTick] = useState(0);
  const [zero, setZero] = useState<Set<string>>(new Set());
  const chosen = useRef("");
  const target = `${drawingId}:${revision}`;

  // 도면이 바뀌면 그 도면에서 마지막으로 쓴 제품 번호를 불러온다.
  useEffect(() => {
    setSerialState(drawingId ? remembered(`machining-serial:${drawingId}`) : "");
    chosen.current = "";
  }, [drawingId]);

  useEffect(() => {
    if (!drawingId || !revision) {
      setPlan(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchMachiningPlan(drawingId, revision, serial, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setPlan(next);
        // 제품 번호가 없으면 부품 기호 + 01 (예: PR01)
        if (!serial) {
          setSerialState(next.serials[next.serials.length - 1] || `${next.part_key ?? "S"}01`);
          return;
        }
        // 도면·제품을 처음 열 때만: 열려 있는 마지막 단계부터 보여준다.
        const key = `${target}:${serial}`;
        if (chosen.current !== key) {
          chosen.current = key;
          const open = [...STAGE_KEYS].reverse().find((s) => next.status[s].unlocked && next.status[s].required > 0);
          setStageState(open ?? "1");
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "가공 단계 조회 실패");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [drawingId, revision, serial, target, tick]);

  const setStage = useCallback((next: StageKey) => setStageState(next), []);
  const setSerial = useCallback(
    (next: string) => {
      const value = next.trim();
      if (!value) return;
      if (drawingId) remember(`machining-serial:${drawingId}`, value);
      setSerialState(value);
      setZero(new Set());
    },
    [drawingId],
  );
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const valid =
    plan && plan.drawing_id === drawingId && plan.revision === revision && plan.serial === serial ? plan : null;
  const stageItemIds = valid
    ? new Set([
        ...valid.items.filter((item) => item.stages[stage]).map((item) => item.item_id),
      ])
    : null;
  const stageRecords: Record<string, MachiningRecord> = {};
  for (const record of valid?.records ?? []) {
    if (record.stage === stage) stageRecords[record.item_id] = record;
  }
  const zeroKey = (instrument: string) => `${serial}|${stage}|${instrument.trim()}`;

  return {
    plan: valid,
    loading,
    error,
    stage,
    setStage,
    serial,
    setSerial,
    refresh,
    stageItemIds,
    stageRecords,
    itemPlan: (itemId) => valid?.items.find((item) => item.item_id === itemId),
    zeroChecked: (instrument) => zero.has(zeroKey(instrument)),
    markZeroChecked: (instrument, checked) =>
      setZero((previous) => {
        const next = new Set(previous);
        if (checked) next.add(zeroKey(instrument));
        else next.delete(zeroKey(instrument));
        return next;
      }),
  };
}
