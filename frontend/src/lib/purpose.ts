/** 작업 목적. 오류사례 등록·검색·이력·재시도는 이 목적의 저장소만 사용한다. */
export type WorkPurpose = "manufacturing" | "assembly" | "verification";

export const WORK_PURPOSES: { value: WorkPurpose; label: string }[] = [
  { value: "manufacturing", label: "부품제작" },
  { value: "assembly", label: "조립" },
  { value: "verification", label: "검증" },
];
