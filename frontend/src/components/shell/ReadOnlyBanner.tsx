/**
 * 공개 배포의 체험(조회 전용) 모드 안내. 서버가 read_only 를 돌려줄 때만 보인다.
 * 실제 변경 차단은 서버(deploy_guard.py)가 한다. 이 띠는 안내일 뿐이다.
 */
import { useEffect, useState } from "react";
import { apiUrl } from "../../lib/drawingAPI";
import { useCompactLayout } from "../../hooks/useCompactLayout";

export function ReadOnlyBanner() {
  const [readOnly, setReadOnly] = useState(false);
  // 휴대폰은 하단 시트 바로 위에 짧게 띄웠다가 8초 뒤 사라진다 (펼친 시트의 목록을 가리지 않게)
  const compact = useCompactLayout();
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    if (!compact || !readOnly) return;
    const timer = setTimeout(() => setFaded(true), 8000);
    return () => clearTimeout(timer);
  }, [compact, readOnly]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl("/api/deploy-mode"), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setReadOnly(Boolean(body?.read_only)))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!readOnly) return null;
  return (
    <div
      role="status"
      className={`pointer-events-none fixed left-1/2 z-[100] -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/85 px-3 py-1 text-xs text-white shadow transition-opacity duration-700 ${compact ? "bottom-[70px]" : "bottom-2"} ${compact && faded ? "opacity-0" : "opacity-100"}`}
    >
      {compact ? "체험 모드 · 조회 전용" : "체험 모드 · 조회만 가능하며 저장·업로드는 막혀 있습니다"}
    </div>
  );
}
