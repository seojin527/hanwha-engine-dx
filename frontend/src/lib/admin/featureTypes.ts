// 관리자가 항목에 지정하는 형상 목록. 서버에는 영문 코드(feature_type)로 저장하고 화면에는 한글로 보여 준다.

export const FEATURE_OPTIONS = [
  { value: "SHAFT_OD", label: "축 외경" },
  { value: "STEP_FACE", label: "단차면" },
  { value: "STEP_LENGTH", label: "단차길이" },
  { value: "OVERALL_LENGTH", label: "전장" },
  { value: "KEYWAY", label: "키홈" },
] as const;

/** 형상 코드를 화면 문구로. 비었거나 UNKNOWN 이면 미확정, 목록에 없는 기존 값은 코드 그대로 보여 준다. */
export function featureLabel(code: string | null | undefined): string {
  if (!code || code === "UNKNOWN") return "미확정";
  return FEATURE_OPTIONS.find((option) => option.value === code)?.label ?? code;
}
