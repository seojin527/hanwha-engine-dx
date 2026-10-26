/**
 * 검증 오류사례 등록 폼 정의.
 * 이 파일만 고치면 검증 페이지의 등록 폼 항목을 바꿀 수 있다.
 * 서버 쪽 필드·검증은 backend/purpose_errors/schemas/verification.py 와 맞춘다.
 */
import type { ErrorFormDefinition } from "./types";

export const verificationErrorForm: ErrorFormDefinition = {
  purpose: "verification",
  categories: ["측정", "가공", "환경", "기타"],
  fields: [
    { key: "case_title", label: "오류 제목", required: true, rows: 1 },
    { key: "error_description", label: "발생한 오류", required: true },
    { key: "recommended_instrument", label: "측정기" },
    { key: "cause", label: "원인" },
    { key: "corrective_action", label: "조치 내용" },
    { key: "precaution", label: "주의사항·재발 방지", required: true },
    { key: "applicable_condition", label: "적용 조건" },
    { key: "exclude_condition", label: "제외·확인 조건" },
  ],
};
