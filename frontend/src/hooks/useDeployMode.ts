import { useEffect, useState } from "react";
import { apiUrl } from "../lib/drawingAPI";

/**
 * 서버 배포 정책 (/api/deploy-mode). 관람객 주소는 read_only=true 이고 서버가 변경 요청을 403 으로 막는다.
 * 화면도 같은 기준으로 관리자 도구를 숨기고, 입력은 서버에 보내지 않는 체험으로 바꾼다.
 * 로컬 실행(DEPLOY_MODE=local)이나 관리자 주소에서는 read_only=false.
 */
export interface DeployMode {
  /** 서버 응답을 받기 전에는 false 로 둔다 (로컬 개발과 같음) */
  loaded: boolean;
  readOnly: boolean;
  ocrEnabled: boolean;
}

let cached: Promise<DeployMode> | null = null;

function load(): Promise<DeployMode> {
  cached ??= fetch(apiUrl("/api/deploy-mode"))
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => ({ loaded: true, readOnly: Boolean(body?.read_only), ocrEnabled: body?.ocr_enabled !== false }))
    .catch(() => ({ loaded: true, readOnly: false, ocrEnabled: true }));
  return cached;
}

export function useDeployMode(): DeployMode {
  const [mode, setMode] = useState<DeployMode>({ loaded: false, readOnly: false, ocrEnabled: true });
  useEffect(() => {
    let alive = true;
    load().then((next) => alive && setMode(next));
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}
