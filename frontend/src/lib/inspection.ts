import { MeasurementPoint, MeasurementItemDef } from "../data/mockData";

export interface ItemInspectionRecord {
  itemId: string;
  measuredValue: string; // string input so user can edit freely
  judgement: "OK" | "NG" | "PENDING";
  deviation: number | null;
  limitDeviation?: number | null;
  limitDeviationText?: string | null;
  isCompleted: boolean; // checked
  updatedAt: string | null;
  summaryText: string;
  reasons: string[];
}

export interface PointInspectionRecord {
  pointId: number;
  items: Record<string, ItemInspectionRecord>;
  notes: string;
  updatedAt: string | null;
}

export interface ItemEvaluationResult {
  judgement: "OK" | "NG" | "PENDING";
  deviation: number | null;
  limitDeviation: number | null;
  limitDeviationText: string | null;
  summaryText: string;
  reasons: string[];
}

/**
 * Evaluates an individual measurement item against its engineering specification
 */
export function evaluateItemMeasurement(
  item: MeasurementItemDef,
  valueStr: string
): ItemEvaluationResult {
  const trimmed = valueStr.trim();
  if (trimmed === "") {
    return {
      judgement: "PENDING",
      deviation: null,
      limitDeviation: null,
      limitDeviationText: null,
      summaryText: "측정값 미입력 (대기)",
      reasons: [],
    };
  }

  const val = parseFloat(trimmed);
  if (isNaN(val)) {
    return {
      judgement: "PENDING",
      deviation: null,
      limitDeviation: null,
      limitDeviationText: null,
      summaryText: "유효하지 않은 수치 형식",
      reasons: ["숫자 형식을 정확히 입력해 주세요."],
    };
  }

  if (item.type === "DIMENSION") {
    const nominal = item.nominalValue ?? 0;
    const lower = item.lowerLimit ?? nominal;
    const upper = item.upperLimit ?? nominal;
    const deviation = Number((val - nominal).toFixed(4));

    if (val >= lower - 0.00005 && val <= upper + 0.00005) {
      return {
        judgement: "OK",
        deviation,
        limitDeviation: 0,
        limitDeviationText: null,
        summaryText: "OK — 규격 적합",
        reasons: [`허용 범위(${lower.toFixed(3)} ~ ${upper.toFixed(3)} mm)를 만족합니다.`],
      };
    } else {
      const isOver = val > upper;
      if (isOver) {
        const diff = Number((val - upper).toFixed(4));
        return {
          judgement: "NG",
          deviation,
          limitDeviation: diff,
          limitDeviationText: `상한 대비 편차: +${diff.toFixed(3)} mm`,
          summaryText: "NG — 상한 초과",
          reasons: [
            `치수 상한 초과 (+${diff.toFixed(3)} mm): 허용치 ${upper.toFixed(3)} mm / 실측치 ${val.toFixed(3)} mm`,
          ],
        };
      } else {
        const diff = Number((val - lower).toFixed(4)); // negative number (e.g. 249.023 - 249.990 = -0.967)
        return {
          judgement: "NG",
          deviation,
          limitDeviation: diff,
          limitDeviationText: `하한 대비 편차: ${diff.toFixed(3)} mm`,
          summaryText: "NG — 하한 미달",
          reasons: [
            `치수 하한 미달 (${diff.toFixed(3)} mm): 허용치 ${lower.toFixed(3)} mm / 실측치 ${val.toFixed(3)} mm`,
          ],
        };
      }
    }
  } else {
    // GEOMETRIC tolerance
    const maxAllowed = item.maxAllowed ?? 0.01;
    const deviation = Number(val.toFixed(4));

    if (val >= 0 && val <= maxAllowed + 0.00005) {
      return {
        judgement: "OK",
        deviation,
        limitDeviation: 0,
        limitDeviationText: null,
        summaryText: "OK — 규격 적합",
        reasons: [`기하공차 허용값(≤ ${maxAllowed.toFixed(3)} mm)을 만족합니다.`],
      };
    } else {
      const diff = Number((val - maxAllowed).toFixed(4));
      return {
        judgement: "NG",
        deviation,
        limitDeviation: diff,
        limitDeviationText: `공차 상한 대비 편차: +${diff.toFixed(3)} mm`,
        summaryText: "NG — 공차 초과",
        reasons: [
          `공차 상한 초과 (+${diff.toFixed(3)} mm): 허용 기준 ≤ ${maxAllowed.toFixed(3)} mm / 실측치 ${val.toFixed(3)} mm`,
        ],
      };
    }
  }
}

export interface PointStatusSummary {
  status: "COMPLETED" | "IN_PROGRESS" | "PENDING";
  statusText: "측정 완료" | "측정 중" | "측정 대기";
  isCompleted: boolean;
  completedCount: number;
  totalCount: number;
  overallJudgement: "OK" | "NG" | "PENDING";
  hasNG: boolean;
}

/**
 * Calculates point-level status and judgement by analyzing all its items
 */
export function getPointStatus(
  point: MeasurementPoint,
  record?: PointInspectionRecord
): PointStatusSummary {
  const items = point.items;
  const totalCount = items.length;

  if (!record || !record.items) {
    return {
      status: "PENDING",
      statusText: "측정 대기",
      isCompleted: false,
      completedCount: 0,
      totalCount,
      overallJudgement: "PENDING",
      hasNG: false,
    };
  }

  let completedCount = 0;
  let hasNG = false;

  for (const item of items) {
    const itemRec = record.items[item.id];
    if (itemRec?.isCompleted) {
      completedCount++;
      if (itemRec.judgement === "NG") {
        hasNG = true;
      }
    } else if (itemRec && itemRec.judgement === "NG") {
      // Even if not checked as completed yet, note if NG occurred
      hasNG = true;
    }
  }

  const isCompleted = completedCount === totalCount && totalCount > 0;
  const status: "COMPLETED" | "IN_PROGRESS" | "PENDING" = isCompleted
    ? "COMPLETED"
    : completedCount > 0
    ? "IN_PROGRESS"
    : "PENDING";

  const statusText: "측정 완료" | "측정 중" | "측정 대기" =
    status === "COMPLETED"
      ? "측정 완료"
      : status === "IN_PROGRESS"
      ? "측정 중"
      : "측정 대기";

  let overallJudgement: "OK" | "NG" | "PENDING" = "PENDING";
  if (hasNG) {
    overallJudgement = "NG";
  } else if (isCompleted) {
    overallJudgement = "OK";
  } else if (completedCount > 0) {
    overallJudgement = "OK";
  }

  return {
    status,
    statusText,
    isCompleted,
    completedCount,
    totalCount,
    overallJudgement,
    hasNG,
  };
}

export const STORAGE_KEYS = {
  RESULTS: "drawing_ai_measurement_results_v4",
  SELECTED_ID: "drawing_ai_selected_point_id_v4",
  SELECTED_ITEM_PREFIX: "drawing_ai_selected_item_v4_",
};

// Initial preset state: Points 1 and 2 completed (giving 2 / 5 완료), 3, 4, 5 pending
export const DEFAULT_INITIAL_RESULTS: Record<number, PointInspectionRecord> = {
  1: {
    pointId: 1,
    notes: "로드 본체 3개 단면 외경 양호. 래칫 3클릭 일관 토크 적용 완료.",
    updatedAt: "2026-10-06 14:15",
    items: {
      "p1-dia": {
        itemId: "p1-dia",
        measuredValue: "40.004",
        judgement: "OK",
        deviation: 0.004,
        isCompleted: true,
        updatedAt: "2026-10-06 14:12",
        summaryText: "OK — 규격 적합",
        reasons: ["허용 범위(39.990 ~ 40.010 mm)를 만족합니다."],
      },
    },
  },
  2: {
    pointId: 2,
    notes: "피스톤 안착 단차부 직경 규격 내 적합 (+0.002mm).",
    updatedAt: "2026-10-06 14:28",
    items: {
      "p2-mount": {
        itemId: "p2-mount",
        measuredValue: "30.002",
        judgement: "OK",
        deviation: 0.002,
        isCompleted: true,
        updatedAt: "2026-10-06 14:25",
        summaryText: "OK — 규격 적합",
        reasons: ["허용 범위(29.985 ~ 30.015 mm)를 만족합니다."],
      },
    },
  },
  3: {
    pointId: 3,
    notes: "",
    updatedAt: null,
    items: {
      "p3-length": {
        itemId: "p3-length",
        measuredValue: "",
        judgement: "PENDING",
        deviation: null,
        isCompleted: false,
        updatedAt: null,
        summaryText: "측정값 미입력 (대기)",
        reasons: [],
      },
    },
  },
  4: {
    pointId: 4,
    notes: "",
    updatedAt: null,
    items: {
      "p4-cir": {
        itemId: "p4-cir",
        measuredValue: "",
        judgement: "PENDING",
        deviation: null,
        isCompleted: false,
        updatedAt: null,
        summaryText: "측정값 미입력 (대기)",
        reasons: [],
      },
    },
  },
  5: {
    pointId: 5,
    notes: "",
    updatedAt: null,
    items: {
      "p5-runout": {
        itemId: "p5-runout",
        measuredValue: "",
        judgement: "PENDING",
        deviation: null,
        isCompleted: false,
        updatedAt: null,
        summaryText: "측정값 미입력 (대기)",
        reasons: [],
      },
    },
  },
};
