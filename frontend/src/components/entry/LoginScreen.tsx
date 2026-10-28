import { useState } from "react";
import { BookOpenCheck, ClipboardCheck, Info, MapPin, PlayCircle, Ruler, ScanText } from "lucide-react";
import { ROLE_OPTIONS, type UserRole } from "../../lib/role";

interface LoginScreenProps {
  /** 계정 이름·역할로 도면 선택 화면에 들어간다. 이름은 화면 표시용으로 메모리에만 둔다. */
  onLogin: (account: string, role: UserRole) => void;
  /** 고른 역할로 샘플 도면 화면을 바로 연다. */
  onDemo: (role: UserRole) => void;
}

/** 저장소 README 의 Scope 표와 같은 내용 (실제 제공 기능만 적는다) */
const CAPABILITIES = [
  { icon: ScanText, title: "도면 분석", text: "치수·공차·기하공차 추출 및 항목화" },
  { icon: MapPin, title: "측정 가이드", text: "도면 마커와 측정항목 연동" },
  { icon: BookOpenCheck, title: "품질 지식", text: "항목별 오류사례 및 주의사항 조회" },
  { icon: ClipboardCheck, title: "검사 기록", text: "측정값 입력·판정·이력 관리" },
];

const WORKFLOW = ["부품 조회", "도면 분석", "측정 기준 확인", "검사 수행", "결과 기록"];

/**
 * 시연용 진입 화면.
 * 현재 서버에는 인증·권한 API 가 없으므로 계정 확인을 하지 않는다.
 * 비밀번호 입력란은 형태만 보여주며 값을 받거나 저장하지 않는다.
 */
export function LoginScreen({ onLogin, onDemo }: LoginScreenProps) {
  const [account, setAccount] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const trimmed = account.trim();
  const role = ROLE_OPTIONS.find((option) => option.key === roleKey)?.role ?? null;

  return (
    <main className="entry-gray grid h-screen break-keep w-screen overflow-y-auto lg:grid-cols-[minmax(420px,5fr)_7fr]">
      {/* 왼쪽: 서비스 소개 (넓은 화면에서만) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-neutral-700 bg-neutral-900/40 p-10 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-cyan-700 text-white">
            <Ruler aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-white">도면 측정 가이드</p>
            <p className="text-[11px] text-neutral-400">엔진 부품 품질검사</p>
          </div>
        </div>

        <div className="relative max-w-md space-y-8">
          <div>
            <h2 className="text-[28px] font-light leading-snug tracking-tight text-white">
              도면의 측정 정보를
              <br />
              검사 기준과 오류사례에 연결합니다.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-300">
              설계도면에서 치수와 공차를 구조화하고, 측정 위치·검사 기준·과거 오류사례를 한 화면에서 확인합니다.
            </p>
          </div>

          <ul className="grid gap-px overflow-hidden rounded border border-neutral-700 bg-neutral-700 sm:grid-cols-2">
            {CAPABILITIES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="space-y-1.5 bg-neutral-800 p-4">
                <Icon aria-hidden="true" className="h-4 w-4 text-cyan-400" />
                <p className="text-[13px] font-medium text-neutral-100">{title}</p>
                <p className="text-xs leading-relaxed text-neutral-400">{text}</p>
              </li>
            ))}
          </ul>
        </div>

        <ol aria-label="업무 흐름" className="relative flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
          {WORKFLOW.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden="true" className="text-neutral-600">→</span>}
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </aside>

      {/* 오른쪽: 시연용 로그인 */}
      <section className="flex min-h-full items-center justify-center px-4 py-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-cyan-700 text-white">
              <Ruler aria-hidden="true" className="h-4 w-4" />
            </span>
            <p className="text-sm font-semibold tracking-tight text-white">도면 측정 가이드</p>
          </div>

          <div className="mb-6 space-y-1.5">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-white">로그인</h1>
              <span className="tag bg-amber-400/15 text-amber-200">시연용</span>
            </div>
            <p className="text-[13px] text-neutral-400">계정 이름을 입력하면 부품·도면 선택 화면으로 이동합니다.</p>
          </div>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed && role) onLogin(trimmed, role);
            }}
          >
            <p className="note note-warn flex gap-2">
              <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                실제 계정 인증과 권한 확인은 아직 연결되지 않았습니다. 입력한 계정 이름은 화면 표시에만 쓰이며 저장하지 않습니다.
              </span>
            </p>

            <label className="block space-y-1.5">
              <span className="field-label text-xs">계정</span>
              <input
                type="text"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="이름 또는 사번"
                maxLength={50}
                autoComplete="off"
                autoFocus
                className="field h-9 text-[13px]"
              />
            </label>

            <fieldset className="space-y-1.5">
              <legend className="field-label mb-1.5 text-xs">역할</legend>
              <div role="radiogroup" aria-label="역할" className="grid grid-cols-2 gap-2">
                {ROLE_OPTIONS.map((option) => {
                  const selected = option.key === roleKey;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setRoleKey(option.key)}
                      className={`rounded border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-cyan-500 bg-cyan-500/10 text-white"
                          : "border-neutral-600 text-neutral-300 hover:border-neutral-500 hover:bg-white/5"
                      }`}
                    >
                      <span className="block text-[13px] font-medium">{option.label}</span>
                      <span className="block text-[11px] text-neutral-400">{option.description}</span>
                    </button>
                  );
                })}
              </div>
              <span className="block text-[11px] text-neutral-500">
                작업자는 자기 업무만 입력하고 다른 업무는 조회만 합니다. 관리자 화면은 관리자만 엽니다.
              </span>
            </fieldset>

            <label className="block space-y-1.5">
              <span className="field-label text-xs">비밀번호</span>
              {/* 시연용: 값을 받지 않도록 비활성화하고 name 도 두지 않는다. */}
              <input
                type="password"
                disabled
                value=""
                readOnly
                placeholder="시연 환경에서는 입력하지 않습니다"
                autoComplete="off"
                aria-describedby="login-password-help"
                className="field h-9 text-[13px]"
              />
              <span id="login-password-help" className="block text-[11px] text-neutral-500">
                인증 서버가 연결되면 사용할 수 있습니다.
              </span>
            </label>

            <button type="submit" disabled={!trimmed || !role} className="btn btn-primary btn-lg w-full">
              로그인
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-[11px] text-neutral-500">
            <span className="h-px flex-1 bg-neutral-700" />
            또는
            <span className="h-px flex-1 bg-neutral-700" />
          </div>

          <button type="button" disabled={!role} onClick={() => role && onDemo(role)} className="btn btn-secondary btn-lg w-full">
            <PlayCircle aria-hidden="true" className="h-4 w-4" />
            데모 체험하기
          </button>
          <p className="mt-2.5 text-center text-[11px] text-neutral-400">
            {role ? "샘플 도면과 샘플 측정항목으로 고른 역할의 화면을 미리 봅니다." : "역할을 먼저 고르면 샘플 화면을 볼 수 있습니다."}
          </p>
        </div>
      </section>
    </main>
  );
}
