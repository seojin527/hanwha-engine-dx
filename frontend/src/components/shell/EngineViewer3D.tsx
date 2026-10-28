/**
 * 전체 엔진 3D 화면 (public/engine-viewer/index.html 을 ?embed=1 로 연다).
 *
 * - 화면을 떠나도 iframe 을 지우지 않고 숨기기만 한다 → 돌아오면 카메라·선택·분해 상태가 그대로다.
 * - 부품 선택은 양방향: 3D에서 클릭하면 onSelect, 바깥(트리)에서 바꾸면 selectedKey 로 뷰어에 전달.
 * - 도구 버튼은 뷰어가 실제로 지원하는 기능만 둔다: 시점 초기화 · 확대/축소 · 분해/조립 · 작동(크랭크 회전 시뮬레이션).
 *   단면 보기는 뷰어에 없어서 버튼을 두지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Boxes, Loader2, Pause, Play, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { EngineeringBackdrop } from "./EngineeringBackdrop";

export interface EngineModelPart {
  key: string;
  name: string;
  pn: string;
  qty: number;
  spec: [string, string][];
}

export interface EngineModelInfo {
  parts: EngineModelPart[];
  /** 모델 출처 안내 (Inventor GLB 몇 종 · 설계 치수 재구성 등) */
  source: string;
  /** 엔진 조립품 이름·번호 (뷰어 설정 기준) */
  title: string;
  pn: string;
}

const READY_TIMEOUT_MS = 30000;

export function EngineViewer3D({
  visible,
  selectedKey,
  onSelect,
  onReady,
}: {
  visible: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onReady: (info: EngineModelInfo) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [exploded, setExploded] = useState(false);
  const [running, setRunning] = useState(false);
  const selectedRef = useRef(selectedKey);
  selectedRef.current = selectedKey;
  const callbacks = useRef({ onSelect, onReady });
  callbacks.current = { onSelect, onReady };

  const send = (message: Record<string, unknown>) =>
    frame.current?.contentWindow?.postMessage(message, window.location.origin);

  useEffect(() => {
    setStatus("loading");
    setErrorMessage("");
    const timer = window.setTimeout(() => {
      setStatus((current) => {
        if (current !== "loading") return current;
        setErrorMessage("3D 모델이 제한 시간 안에 준비되지 않았습니다.");
        return "error";
      });
    }, READY_TIMEOUT_MS);

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data || {};
      if (data.type === "dx:ready") {
        setStatus("ready");
        callbacks.current.onReady({
          parts: data.parts ?? [],
          source: String(data.source ?? ""),
          title: String(data.title ?? "엔진 조립품"),
          pn: String(data.pn ?? ""),
        });
        // 뷰어를 다시 연 경우에도 지금 선택을 다시 알려준다.
        if (selectedRef.current) send({ type: "dx:select", key: selectedRef.current });
      } else if (data.type === "dx:selected") {
        if ((data.key ?? null) !== selectedRef.current) callbacks.current.onSelect(data.key ?? null);
      } else if (data.type === "dx:state") {
        setExploded(!!data.exploded);
        setRunning(!!data.running);
      } else if (data.type === "dx:error") {
        setErrorMessage(String(data.message || "3D 뷰어 오류"));
        setStatus("error");
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [attempt]);

  // 바깥(트리)에서 바꾼 선택을 뷰어에 반영
  useEffect(() => {
    if (status === "ready") send({ type: "dx:select", key: selectedKey });
  }, [selectedKey, status]);

  const src = `${import.meta.env.BASE_URL}engine-viewer/index.html?embed=1`;
  const disabled = status !== "ready";

  return (
    <section
      aria-label="전체 엔진 3D"
      className={`relative min-h-0 min-w-0 flex-1 bg-[radial-gradient(ellipse_at_55%_45%,#18293b_0%,#0f1c2b_55%,#0b1622_100%)] ${visible ? "flex" : "hidden"}`}
    >
      {/* 장식 배경: 뷰어 바탕이 투명이라 3D 주변까지 이어진다 (입력은 가로채지 않음) */}
      <EngineeringBackdrop />
      <iframe
        key={attempt}
        ref={frame}
        title="엔진 3D 모델"
        src={src}
        style={{ colorScheme: "normal" }}
        className="absolute inset-0 h-full w-full border-0 bg-transparent"
      />

      {/* 보기 도구 (뷰어가 지원하는 기능만) */}
      <div role="toolbar" aria-label="3D 보기 도구" className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-0.5 rounded border border-dx-line bg-dx-panel/95 p-1 shadow-lg">
        <ToolButton label="시점 초기화" disabled={disabled} onClick={() => send({ type: "dx:reset" })}>
          <RotateCcw className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="확대" disabled={disabled} onClick={() => send({ type: "dx:zoom", factor: 0.8 })}>
          <ZoomIn className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="축소" disabled={disabled} onClick={() => send({ type: "dx:zoom", factor: 1.25 })}>
          <ZoomOut className="h-4 w-4" />
        </ToolButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-dx-line" />
        <ToolButton label={exploded ? "조립" : "분해"} pressed={exploded} disabled={disabled} onClick={() => send({ type: "dx:explode", on: !exploded })}>
          <Boxes className="h-4 w-4" />
          <span className="text-[11px]">{exploded ? "조립" : "분해"}</span>
        </ToolButton>
        <ToolButton label={running ? "작동 정지" : "작동 (크랭크 회전 시뮬레이션)"} pressed={running} disabled={disabled} onClick={() => send({ type: "dx:run", on: !running })}>
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span className="text-[11px]">작동</span>
        </ToolButton>
        {selectedKey && (
          <>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-dx-line" />
            <ToolButton label="선택 해제" disabled={disabled} onClick={() => onSelect(null)}>
              <X className="h-4 w-4" />
              <span className="text-[11px]">선택 해제</span>
            </ToolButton>
          </>
        )}
      </div>

      <p className="pointer-events-none absolute bottom-3 left-3 rounded bg-dx-bg/80 px-2 py-1 text-[11px] text-dx-muted">
        드래그 회전 · 휠 확대 · 우클릭 이동 · 부품을 클릭해 선택
      </p>

      {status === "loading" && (
        <div role="status" className="absolute inset-0 flex items-center justify-center bg-dx-bg/70">
          <span className="flex items-center gap-2 rounded border border-dx-line bg-dx-panel px-3 py-2 text-xs text-dx-muted">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-dx-accent" />
            엔진 3D 모델을 불러오는 중…
          </span>
        </div>
      )}
      {status === "error" && (
        <div role="alert" className="absolute inset-0 flex items-center justify-center bg-dx-bg/85">
          <div className="max-w-sm space-y-3 rounded border border-rose-400/40 bg-dx-panel p-4 text-xs">
            <p className="flex items-center gap-2 font-semibold text-rose-200">
              <AlertTriangle aria-hidden="true" className="h-4 w-4" />
              3D 모델을 표시하지 못했습니다
            </p>
            <p className="text-dx-muted">{errorMessage} 브라우저의 WebGL 지원과 public/engine-viewer 파일을 확인해주세요. 왼쪽 트리로 부품·도면 탐색은 계속할 수 있습니다.</p>
            <button type="button" className="dx-btn" onClick={() => setAttempt((value) => value + 1)}>
              다시 시도
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 whitespace-nowrap rounded px-1.5 text-dx-muted transition-colors hover:bg-white/5 hover:text-dx-text focus-visible:outline-2 focus-visible:outline-dx-accent disabled:cursor-not-allowed disabled:opacity-40 ${
        pressed ? "bg-dx-accent/10 text-dx-accent" : ""
      }`}
    >
      {children}
    </button>
  );
}
