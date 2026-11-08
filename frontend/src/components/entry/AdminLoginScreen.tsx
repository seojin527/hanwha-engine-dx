import { EntryBackdrop } from "./EntryBackdrop";
import { useState, type FormEvent } from 'react';
import { apiUrl } from '../../lib/drawingAPI';

/** Same-site form login: credentials are checked by the existing protected administrator service. */
export function AdminLoginScreen() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(apiUrl('/api/admin/session'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '로그인 정보를 확인해주세요.');
      setPassword('');
      window.location.assign('/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '관리자 로그인에 연결하지 못했습니다.'); setBusy(false); }
  }
  return <main className="dx-shell relative isolate flex min-h-dvh items-center justify-center overflow-y-auto px-4 py-8">
    <EntryBackdrop />
    <section className="relative z-10 w-full max-w-sm rounded-xl border border-dx-line bg-dx-panel p-6 shadow-lg">
      <p className="text-xs font-semibold text-dx-muted">도다미.</p>
      <h1 className="mt-4 text-xl font-semibold text-dx-strong">관리자 로그인</h1>
      <p className="mt-2 text-sm leading-relaxed text-dx-muted">기존 관리자 아이디와 비밀번호를 입력해주세요.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium">아이디<input className="dx-input mt-1 h-12 !text-base" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" maxLength={128} required /></label>
        <label className="block text-sm font-medium">비밀번호<input type="password" className="dx-input mt-1 h-12 !text-base" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" maxLength={1024} required /></label>
        {error && <p role="alert" className="note note-error">{error}</p>}
        <button type="submit" disabled={busy || !username.trim() || !password} className="dx-btn dx-btn-primary h-12 w-full !text-base">{busy ? '확인 중…' : '관리자 로그인'}</button>
      </form>
      <a href="/" className="mt-4 flex min-h-11 items-center justify-center text-sm text-dx-muted">작업자 체험으로 돌아가기</a>
      <p className="mt-3 text-xs leading-relaxed text-dx-muted">비밀번호를 모르면 서버 관리자에게 확인해주세요. 기존 비밀번호는 이 화면에서 조회할 수 없습니다.</p>
    </section>
  </main>;
}
