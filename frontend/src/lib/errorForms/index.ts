import type { WorkPurpose } from "../purpose";
import type { ErrorFormDefinition } from "./types";
import { manufacturingErrorForm } from "./manufacturing";
import { assemblyErrorForm } from "./assembly";
import { verificationErrorForm } from "./verification";

export type { ErrorFormDefinition, ErrorFormField } from "./types";

/** 목적별 오류사례 등록 폼. 각 정의는 목적별 파일에서 독립적으로 수정한다. */
export const ERROR_FORMS: Record<WorkPurpose, ErrorFormDefinition> = {
  manufacturing: manufacturingErrorForm,
  assembly: assemblyErrorForm,
  verification: verificationErrorForm,
};
