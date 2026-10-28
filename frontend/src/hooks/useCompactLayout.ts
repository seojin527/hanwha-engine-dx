import { useSyncExternalStore } from "react";

/**
 * 휴대폰 화면 여부. 세로(폭 768px 미만)와 가로(높이 500px 이하이면서 폭 1024px 미만) 모두 해당한다.
 * 이때 셸은 3D·도면을 화면 전체에 두고, 트리·작업 패널은 하단 시트로 연다.
 */
const QUERY = "(max-width: 767px), (max-height: 500px) and (max-width: 1023px)";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useCompactLayout(): boolean {
  return useMedia(QUERY);
}

