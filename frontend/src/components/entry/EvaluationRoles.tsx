import { useState, type ReactNode } from 'react';
import { ArrowLeftRight, LogOut } from 'lucide-react';
import { ROLE_OPTIONS, roleLabel, type UserRole } from '../../lib/role';

/** Only rendered by App after the server confirms an authenticated administrator session. */
export function EvaluationRoleSelect({ onSelect, onSignOut }: { onSelect: (name: string, role: UserRole) => void; onSignOut: () => void }) {
  const [name, setName] = useState('평가자');
  return <main className="dx-shell flex min-h-dvh items-center justify-center overflow-y-auto px-4 py-6">
    <section className="w-full max-w-xl rounded-lg border border-dx-line bg-dx-panel p-5">
      <p className="text-xs font-semibold text-dx-muted">HANWHA ENGINE DX · 관리자 인증 완료</p>
      <h1 className="mt-3 text-lg font-semibold text-dx-strong">체험할 역할을 선택해주세요</h1>
      <p className="mt-2 text-sm leading-relaxed text-dx-muted">관리자와 세 검수자 화면을 자유롭게 둘러볼 수 있습니다. 화면 위의 「역할 전환」으로 돌아오면 비밀번호를 다시 입력하지 않아도 됩니다.</p>
      <label className="mt-4 block text-xs font-medium text-dx-muted">화면에 표시할 이름<input className="dx-input mt-1 h-10 !text-base" value={name} onChange={event => setName(event.target.value)} maxLength={50} /></label>
      <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="평가 역할 선택">
        {ROLE_OPTIONS.map(entry => <button key={entry.key} type="button" onClick={() => onSelect(name.trim() || '평가자', entry.role)} className="flex min-h-20 flex-col items-start justify-center gap-1 rounded border border-dx-line-strong px-3 py-3 text-left hover:border-dx-accent hover:bg-dx-raised">
          <span className="text-sm font-semibold text-dx-strong">{entry.role.kind === 'admin' ? '관리자' : entry.label.replace('작업자', '검수자')}</span>
          <span className="text-xs leading-relaxed text-dx-muted">{entry.description}</span>
        </button>)}
      </div>
      <button type="button" onClick={onSignOut} className="dx-btn dx-btn-ghost mt-4 w-full">인증 종료 · 로그아웃</button>
    </section>
  </main>;
}

export function EvaluationSessionFrame({ role, onSwitch, onSignOut, children }: { role: UserRole | null; onSwitch: () => void; onSignOut: () => void; children: ReactNode }) {
  return <div className="evaluation-session flex h-dvh flex-col overflow-hidden bg-dx-bg">
    <nav aria-label="평가자 역할 전환" className="relative z-[100] flex h-9 shrink-0 items-center gap-2 border-b border-dx-line bg-dx-panel px-2 text-xs text-dx-text">
      <span className="min-w-0 flex-1 truncate font-medium">인증 완료 · {roleLabel(role)}</span>
      <button type="button" onClick={onSwitch} className="dx-btn h-7 gap-1 px-2"><ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5" />역할 전환</button>
      <button type="button" onClick={onSignOut} className="dx-btn dx-btn-ghost h-7 gap-1 px-2"><LogOut aria-hidden="true" className="h-3.5 w-3.5" />로그아웃</button>
    </nav>
    <div className="evaluation-content relative min-h-0 flex-1">{children}</div>
  </div>;
}
