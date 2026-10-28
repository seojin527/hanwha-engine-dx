import { useState, type ReactNode } from "react";
import { ChevronDown, Lock, PlayCircle, User, Users } from "lucide-react";
import { ROLE_OPTIONS, type UserRole } from "../../lib/role";
import { EngineeringBackdrop } from "../shell/EngineeringBackdrop";

interface LoginScreenProps {
  /** 계정 이름·역할로 전체 엔진 3D 화면에 들어간다. 이름은 화면 표시용으로 메모리에만 둔다. */
  onLogin: (account: string, role: UserRole) => void;
  /** 고른 역할로 샘플 도면 화면을 바로 연다. */
  onDemo: (role: UserRole) => void;
}

/**
 * 시연용 진입 화면.
 * 현재 서버에는 인증·권한 API 가 없으므로 계정 확인을 하지 않는다 (작은 안내 문구로 표시).
 * 비밀번호 입력란은 형태만 보여주며 값을 받거나 저장하지 않는다. 비밀번호 찾기·로그인 유지는 기능이 없어 두지 않는다.
 * 역할은 lib/role.ts 의 실제 역할(관리자 · 부품제작/조립/검증 작업자)을 그대로 쓴다.
 *
 * 글자 체계 (Pretendard Variable · 4px 간격 기준)
 *   제품명  HANWHA ENGINE 13px/600 자간 +0.04em · DX 같은 기준선, 시안
 *   제목    20px/600 행간 1.3 자간 -0.01em
 *   설명    13px/400 행간 1.5 흰색 60%
 *   라벨    13px/500 흰색 85% · 입력값 14px/400 흰색 · placeholder 는 예시만 (라벨이 항상 보인다)
 *   보조    12px/400 행간 1.5 흰색 50%
 *   버튼    14px/600 높이 44px
 */
export function LoginScreen({ onLogin, onDemo }: LoginScreenProps) {
  const [account, setAccount] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [fullEngineArt, setFullEngineArt] = useState(true);
  const trimmed = account.trim();
  const role = ROLE_OPTIONS.find((entry) => entry.key === roleKey)?.role ?? null;

  return (
    <main className="dx-shell relative h-dvh w-screen overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,#132235_0%,#0b1522_60%,#08111b_100%)] text-[14px] leading-normal">
      <EngineeringBackdrop strength={1.25} shapes={false} />
      {/*
        왼쪽: 구동부 선화 — 기존 3D 자산(크랭크 축·커넥팅 로드·크로스헤드·피스톤 로드·피스톤 헤드 6기통)을
        engine-viewer/lineart-export.js 로 그린 정적 투명 PNG. 로그인 카드 쪽으로 갈수록 흐려진다.
      */}
      <img
        src={`${import.meta.env.BASE_URL}images/login-engine-lineart.png`}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute left-[-30vw] top-1/2 h-[min(92vh,980px)] w-auto max-w-none -translate-y-1/2 select-none opacity-20 [mask-image:linear-gradient(to_right,black_25%,transparent_80%)] sm:left-[-14vw] sm:opacity-35 lg:left-[-4vw] lg:opacity-50 xl:left-[3vw] xl:opacity-60"
      />
      {/*
        오른쪽 아래: 전체 엔진 외형 선화 (장식용, 3D 모델과 별개).
        참고 이미지의 엔진 부분만 밝은 선으로 추출해 투명 PNG 로 만든 것이다 (GLB 에는 엔진 외형이 없다).
        파일이 없으면 아무것도 그리지 않는다. 카드와 겹치지 않도록 넓은 화면(1280px 이상)에서만 보인다.
      */}
      {fullEngineArt && (
        <img
          src={`${import.meta.env.BASE_URL}images/login-engine-full-lineart.png`}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={() => setFullEngineArt(false)}
          className="pointer-events-none absolute bottom-[5vh] right-[3vw] hidden w-[min(26vw,440px)] select-none opacity-35 [mask-image:linear-gradient(to_left,black_55%,transparent_100%)] xl:block"
        />
      )}

      {/*
        카드는 별도 스크롤 영역 안에 둔다. 높이가 남으면 가운데, 모자라면 위에서부터 놓이고 세로로 스크롤된다
        (스크롤 영역 자체를 flex 가운데 정렬하면 넘친 위쪽이 스크롤로도 닿지 않는다). 배경 장식은 스크롤되지 않는다.
        낮은 화면(높이 820px 이하)에서는 위아래 여백을 줄인다.
      */}
      <div className="relative h-full overflow-y-auto overflow-x-hidden">
      <div className="flex min-h-full items-center justify-center px-4 py-10 [@media(max-height:820px)]:py-4">
      <div className="relative w-full max-w-[400px] max-md:pb-14 [@media(max-height:500px)]:pb-14">
        <div className="break-keep rounded-xl border border-white/10 bg-[#17263a]/85 px-8 pb-8 pt-9 [@media(max-height:820px)]:pb-6 [@media(max-height:820px)]:pt-6 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.75)] backdrop-blur-[3px]">
          {/* 제품명 · 제목 · 설명 */}
          <header>
            <p className="flex items-baseline gap-1.5 text-[13px] font-semibold leading-none tracking-[0.04em] text-white/90" aria-label="HANWHA ENGINE DX">
              <span>HANWHA ENGINE</span>
              <span className="text-dx-accent">DX</span>
            </p>
            <h1 className="mt-5 [@media(max-height:820px)]:mt-3 text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-white">로그인</h1>
            <p className="mt-1.5 text-[13px] leading-[1.5] text-white/60">도면 측정 가이드 · 엔진 부품 품질검사</p>
            <p className="mt-3 inline-flex items-center rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[11px] font-medium leading-[1.4] text-amber-100/90">
              시연용 로그인 · 서버 인증 미연결
            </p>
          </header>

          <form
            className="mt-7 space-y-[18px] [@media(max-height:820px)]:mt-5 [@media(max-height:820px)]:space-y-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed && role) onLogin(trimmed, role);
            }}
          >
            <Field label="계정" htmlFor="login-account" icon={<User className="h-4 w-4" />}>
              <input
                id="login-account"
                type="text"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="예: 홍길동 또는 사번"
                maxLength={50}
                autoComplete="off"
                autoFocus
                className="h-11 min-w-0 flex-1 bg-transparent pr-3 text-[14px] text-white placeholder:text-white/35 focus:outline-none"
              />
            </Field>

            <Field
              label="비밀번호"
              htmlFor="login-password"
              icon={<Lock className="h-4 w-4" />}
              disabled
              hint="시연 환경에서는 입력하지 않습니다. 인증 서버가 연결되면 사용합니다."
            >
              {/* 시연용: 값을 받지 않도록 비활성화하고 name 도 두지 않는다. */}
              <input
                id="login-password"
                type="password"
                disabled
                value=""
                readOnly
                aria-describedby="login-password-hint"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 cursor-not-allowed bg-transparent pr-3 text-[14px] text-white focus:outline-none"
              />
            </Field>

            <Field
              label="역할"
              htmlFor="login-role"
              icon={<Users className="h-4 w-4" />}
              hint="작업자는 자기 업무만 입력하고 다른 업무는 조회만 합니다. 도면 등록과 OCR 검토는 관리자만 합니다."
            >
              <select
                id="login-role"
                value={roleKey}
                onChange={(event) => setRoleKey(event.target.value)}
                aria-describedby="login-role-hint"
                className={`h-11 min-w-0 flex-1 appearance-none bg-transparent pr-9 text-[14px] focus:outline-none [&>option]:bg-[#13202f] [&>option]:text-white ${roleKey ? "text-white" : "text-white/45"}`}
              >
                <option value="" disabled>
                  역할 선택
                </option>
                {ROLE_OPTIONS.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label} — {entry.description}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            </Field>

            <button
              type="submit"
              disabled={!trimmed || !role}
              className="!mt-6 h-11 w-full rounded-md bg-[#22c3dc] text-[14px] font-semibold leading-none text-[#04212b] transition-colors hover:bg-[#45d0e5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#22c3dc] disabled:cursor-not-allowed disabled:bg-[#22c3dc]/30 disabled:text-[#04212b]/70"
            >
              로그인
            </button>
          </form>

          <div className="mt-5 border-t border-white/8 pt-4">
            <button
              type="button"
              disabled={!role}
              onClick={() => role && onDemo(role)}
              className="inline-flex w-full items-center justify-center gap-1.5 text-[13px] font-medium text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-[#22c3dc] disabled:cursor-not-allowed disabled:font-normal disabled:text-white/40 disabled:no-underline"
            >
              <PlayCircle aria-hidden="true" className="h-4 w-4" />
              {role ? "데모 도면으로 체험하기" : "역할을 고르면 데모 도면을 볼 수 있습니다"}
            </button>
          </div>
        </div>
        <p className="mt-5 break-keep text-center text-[12px] [@media(max-height:820px)]:mt-3 leading-[1.5] text-white/40">
          입력한 이름은 화면 표시에만 쓰고 저장하지 않습니다. 로그인하면 전체 엔진 3D 화면에서 시작합니다.
        </p>
      </div>
      </div>
      </div>
    </main>
  );
}

/** 라벨(항상 보임) + 아이콘·구분선이 있는 입력틀 + 보조 문구. 포커스 시 시안 테두리 */
function Field({
  label,
  htmlFor,
  icon,
  disabled,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  icon: ReactNode;
  disabled?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium leading-[1.4] text-white/85">
        {label}
      </label>
      <div
        className={`relative mt-2 flex items-center rounded-md border bg-[#0e1a28]/80 transition-colors focus-within:border-[#22c3dc] focus-within:ring-1 focus-within:ring-[#22c3dc]/40 ${
          disabled ? "border-white/8 opacity-60" : "border-white/15 hover:border-white/30"
        }`}
      >
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center text-white/55">{icon}</span>
        <span aria-hidden="true" className="mr-3 h-5 w-px bg-white/15" />
        {children}
      </div>
      {hint && (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-[12px] leading-[1.5] text-white/50">
          {hint}
        </p>
      )}
    </div>
  );
}
