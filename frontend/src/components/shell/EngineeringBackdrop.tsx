/**
 * 은은한 엔지니어링 배경 (장식 전용).
 * - 미세 격자(CSS) + 네 모서리에 붙인 기계 정투상도/단면 윤곽(SVG) + 소수의 시안 점
 * - 화면 비율과 상관없이 모서리에 붙으므로 가로·세로로 긴 영역 모두에서 보인다.
 * - 모델·글자보다 확실히 낮은 대비. 측정선·클릭 대상으로 오해하지 않도록 가장자리에만 두고 숫자는 넣지 않는다.
 * - 마우스·터치를 가로채지 않고(pointer-events: none), 애니메이션이 없다. 스크린리더에서도 숨긴다.
 */
import type { CSSProperties, ReactNode } from "react";

export function EngineeringBackdrop({ strength = 1, shapes = true }: { strength?: number; /** false 면 격자만 */ shapes?: boolean }) {
  const line = `rgba(176, 198, 220, ${Math.min(0.32, 0.2 * strength)})`;
  const faint = `rgba(176, 198, 220, ${Math.min(0.2, 0.11 * strength)})`;
  const cyan = `rgba(34, 195, 220, ${Math.min(0.8, 0.6 * strength)})`;
  const grid: CSSProperties = {
    backgroundImage: [
      `linear-gradient(rgba(150, 176, 204, ${0.075 * strength}) 1px, transparent 1px)`,
      `linear-gradient(90deg, rgba(150, 176, 204, ${0.075 * strength}) 1px, transparent 1px)`,
      `linear-gradient(rgba(150, 176, 204, ${0.035 * strength}) 1px, transparent 1px)`,
      `linear-gradient(90deg, rgba(150, 176, 204, ${0.035 * strength}) 1px, transparent 1px)`,
    ].join(","),
    backgroundSize: "120px 120px, 120px 120px, 24px 24px, 24px 24px",
    backgroundPosition: "center center",
  };
  const dash = "12 4 3 4";

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none overflow-hidden" style={grid}>
      {shapes && <>
      {/* 왼쪽 위: 플랜지 정면도 */}
      <Corner style={{ left: "-2%", top: "4%", width: "clamp(170px, 28%, 340px)" }} viewBox="-170 -170 340 360">
        <g fill="none" stroke={line} strokeWidth="1.2">
          <circle r="120" />
          <circle r="86" />
          <circle r="38" />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return <circle key={i} cx={Math.cos(a) * 104} cy={Math.sin(a) * 104} r="7" />;
          })}
          <path d="M-160 0H160M0 -160V160" stroke={faint} strokeDasharray={dash} />
          <path d="M-120 170H120M-120 160V180M120 160V180" stroke={faint} />
        </g>
      </Corner>

      {/* 오른쪽 위: 실린더 라이너 단면 */}
      <Corner style={{ right: "3%", top: "6%", width: "clamp(110px, 16%, 210px)" }} viewBox="-110 -220 230 460">
        <defs>
          <pattern id="dx-hatch-a" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0V8" stroke={faint} strokeWidth="1" />
          </pattern>
        </defs>
        <g fill="none" stroke={line} strokeWidth="1.2">
          <path d="M-70 -170H70V190H-70Z" />
          <path d="M-52 -170V190M52 -170V190" />
          <rect x="-70" y="-170" width="18" height="360" fill="url(#dx-hatch-a)" stroke="none" />
          <rect x="52" y="-170" width="18" height="360" fill="url(#dx-hatch-a)" stroke="none" />
          <path d="M-92 -170H92V-142H-92Z" />
          <path d="M0 -210V230" stroke={faint} strokeDasharray={dash} />
          <path d="M84 -170H108M84 190H108M100 -170V190" stroke={faint} />
        </g>
      </Corner>

      {/* 왼쪽 아래: 단 붙은 축 정면도 */}
      <Corner style={{ left: "3%", bottom: "5%", width: "clamp(200px, 36%, 460px)" }} viewBox="-40 -60 640 150">
        <g fill="none" stroke={line} strokeWidth="1.2">
          <path d="M0 -26H140V-40H330V-30H470V-18H560V18H470V30H330V40H140V26H0Z" />
          <path d="M140 -40V40M330 -40V40M470 -30V30" stroke={faint} />
          <path d="M-30 0H600" stroke={faint} strokeDasharray={dash} />
          <path d="M0 70H560M0 60V80M560 60V80" stroke={faint} />
        </g>
      </Corner>

      {/* 오른쪽 아래: 핀 단면 */}
      <Corner style={{ right: "4%", bottom: "8%", width: "clamp(120px, 20%, 260px)" }} viewBox="-110 -110 330 220">
        <defs>
          <pattern id="dx-hatch-b" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0V8" stroke={faint} strokeWidth="1" />
          </pattern>
        </defs>
        <g fill="none" stroke={line} strokeWidth="1.2">
          <circle r="64" />
          <circle r="40" fill="url(#dx-hatch-b)" />
          <path d="M-96 0H96M0 -96V96" stroke={faint} strokeDasharray={dash} />
          <path d="M120 -64H210V64H120" />
        </g>
      </Corner>

      {/* 소수의 시안 점 */}
      {[
        ["18%", "26%"], ["86%", "14%"], ["52%", "7%"], ["91%", "62%"], ["7%", "58%"], ["66%", "92%"],
      ].map(([left, top]) => (
        <span key={`${left}${top}`} className="absolute h-1 w-1 rounded-full" style={{ left, top, background: cyan }} />
      ))}
      </>}
    </div>
  );
}

function Corner({ style, viewBox, children }: { style: CSSProperties; viewBox: string; children: ReactNode }) {
  return (
    <svg className="absolute h-auto" style={style} viewBox={viewBox} focusable="false">
      {children}
    </svg>
  );
}
