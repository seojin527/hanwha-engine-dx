/**
 * 공개 배포의 체험(조회 전용) 모드 안내 (데스크톱). 서버가 read_only 를 돌려줄 때만 보인다.
 * 실제 변경 차단은 서버(deploy_guard.py)가 한다. 이 띠는 안내일 뿐이다.
 * 휴대폰 화면은 작업 화면마다 '체험 · 서버에 저장 안 됨' 표시와 로그인 안내가 대신한다.
 */
import { useCompactLayout } from "../../hooks/useCompactLayout";
import { useDeployMode } from "../../hooks/useDeployMode";

export function ReadOnlyBanner() {
  const { readOnly } = useDeployMode();
  const compact = useCompactLayout();
  if (!readOnly || compact) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-2 left-1/2 z-[100] -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/85 px-3 py-1 text-xs text-white shadow"
    >
      체험 모드 · 조회만 가능하며 저장·업로드는 막혀 있습니다
    </div>
  );
}
