/**
 * 검증 작업자 페이지. 배치는 조립과 같고(MeasureWorkPage), 오류사례·측정 기록은 검증 저장소만 쓴다.
 * 검증 작업자가 아니면 readOnly 로 열려 조회만 한다. 관리자 검토는 통합 관리자 페이지(AdminPage)에서 한다.
 */
import { MeasureWorkPage } from "./MeasureWorkPage";
import type { WorkspacePageProps } from "./workspaceTypes";

export function VerificationPage(props: WorkspacePageProps) {
  return <MeasureWorkPage purpose="verification" {...props} />;
}
