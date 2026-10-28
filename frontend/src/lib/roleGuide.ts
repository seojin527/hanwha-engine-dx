import type { WorkPurpose } from "./purpose";

/**
 * 휴대폰 업무 선택·작업 화면에 쓰는 업무 설명. 실제 코드의 동작만 적는다.
 * - 부품제작: 제품 번호별 황삭·중삭·정삭 단계 목표 범위 측정, 앞 단계가 모두 합격해야 다음 단계 (machining_api)
 * - 조립·검증: 도면 공차 기준 측정·판정을 각 업무 저장소에 기록, 업무별 오류사례 DB 를 다르게 검색 (measurement_api · purpose_errors)
 *   조립 오류 DB 는 조립 전·조립 중 확인(체결 상태·상대 부품 간극), 검증 오류 DB 는 최종 검사(측정 자세·판독) 사례가 중심이다.
 */
export const ROLE_GUIDE: Record<WorkPurpose, { title: string; short: string; summary: string; doNow: string; caution: string }> = {
  manufacturing: {
    title: "부품제작",
    short: "가공 단계별 치수 확인",
    summary: "황삭 → 중삭 → 정삭 단계마다 이번 단계에서 잴 치수만 목표 범위로 재고, 앞 단계가 모두 합격해야 다음 단계로 넘어갑니다.",
    doNow: "측정기 0점을 확인하고 이번 단계 목표 범위로 실측값을 입력하세요",
    caution: "가공 단계별 오류사례",
  },
  assembly: {
    title: "조립",
    short: "조립 전·중 치수 확인",
    summary: "조립 전에 이 부품 치수를 도면 공차로 재어 적합 여부를 남기고, 체결 상태·상대 부품 간극 같은 조립 오류사례를 확인합니다.",
    doNow: "조립 오류사례를 확인하고 도면 공차로 실측값을 입력하세요",
    caution: "조립 전·조립 중 오류사례",
  },
  verification: {
    title: "검증",
    short: "최종 검사 합격 판정",
    summary: "완성된 부품 치수를 도면 공차 기준으로 최종 검사해 합격·불합격을 판정하고, 측정 자세·판독 같은 검사 오류사례를 확인합니다.",
    doNow: "검사 오류사례를 확인하고 실측값으로 합격 여부를 판정하세요",
    caution: "최종 검사 오류사례",
  },
};

export const ROLE_ORDER: WorkPurpose[] = ["manufacturing", "assembly", "verification"];
