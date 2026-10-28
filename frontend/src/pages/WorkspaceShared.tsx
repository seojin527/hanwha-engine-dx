/**
 * 작업 화면이 함께 쓰는 공통 요소.
 * PositionPickBanner 는 통합 관리자 페이지, WorkerBlockedNotice 는 작업자 페이지가 쓴다.
 */
import { Crosshair } from "lucide-react";

/** 관리자가 '놓친 치수 추가' 위치를 고르는 중일 때 도면 위에 띄우는 안내 */
export function PositionPickBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-cyan-700 px-3 py-2 text-white"
    >
      <Crosshair aria-hidden="true" className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">
          추가할 치수의 위치를 아래 도면에서 클릭하세요
        </p>
        <p className="text-[11px] text-cyan-100">
          클릭하면 임시 번호가 표시됩니다. 위치 확인 후 오른쪽에서 「위치 확정」을 눌러주세요.
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="btn border-white/40 bg-transparent text-white hover:bg-white/10"
      >
        위치 선택 취소 · Esc
      </button>
    </div>
  );
}

/** 관리자 검토가 끝나지 않은 도면을 작업자 페이지에서 열었을 때 (작업자는 관리자 화면으로 갈 수 없다) */
export function WorkerBlockedNotice() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-6">
      <section className="w-full max-w-md rounded border border-slate-700 border-t-amber-500 border-t-2 bg-slate-900 p-5">
        <h2 className="text-[13px] font-semibold text-white">
          관리자 검토가 끝나지 않은 도면입니다
        </h2>

        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          관리자가 OCR 추출 항목을 확인하고 「검토 완료 및 서버 저장」을 누른 뒤에
          작업자 화면에서 사용할 수 있습니다. 검토가 필요하면 관리자에게 요청해주세요.
        </p>
      </section>
    </div>
  );
}
