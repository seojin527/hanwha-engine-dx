/**
 * 화면 역할. 서버 인증이 없으므로 시작 화면에서 고른 값으로 화면 진입만 나눈다 (권한 보안이 아님).
 *
 * - 관리자: 공통 부품·도면·OCR·검토를 다루는 통합 관리자 화면 하나만 쓴다.
 * - 작업자: 자기 업무(부품제작·조립·검증) 페이지에서 입력하고, 다른 업무 페이지는 조회만 한다.
 */
import { WORK_PURPOSES, type WorkPurpose } from "./purpose";

export type UserRole = { kind: "admin" } | { kind: "worker"; purpose: WorkPurpose };

export const ROLE_OPTIONS: { key: string; role: UserRole; label: string; description: string }[] = [
  { key: "admin", role: { kind: "admin" }, label: "관리자", description: "부품·도면·OCR·검토 관리" },
  ...WORK_PURPOSES.map((entry) => ({
    key: entry.value,
    role: { kind: "worker", purpose: entry.value } as UserRole,
    label: `${entry.label} 작업자`,
    description: `${entry.label} 측정·오류 기록`,
  })),
];

export function roleLabel(role: UserRole | null): string {
  if (!role) return "";
  if (role.kind === "admin") return "관리자";
  return `${WORK_PURPOSES.find((entry) => entry.value === role.purpose)?.label ?? ""} 작업자`;
}

export function roleKey(role: UserRole | null): string {
  if (!role) return "";
  return role.kind === "admin" ? "admin" : role.purpose;
}
