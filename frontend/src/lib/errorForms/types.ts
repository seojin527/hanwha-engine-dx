import type { WorkPurpose } from "../purpose";

export interface ErrorFormField {
  /** 서버 MANUAL_FIELDS 의 필드 이름 */
  key: string;
  label: string;
  required?: boolean;
  /** 입력칸 줄 수 (기본 2) */
  rows?: number;
}

export interface ErrorFormDefinition {
  purpose: WorkPurpose;
  /** 오류 분류 선택지 (error_category) */
  categories: string[];
  fields: ErrorFormField[];
}
