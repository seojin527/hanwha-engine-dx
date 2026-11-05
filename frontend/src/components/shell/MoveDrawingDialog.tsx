/**
 * 도면 소속 부품 변경 확인 창. 트리 드래그·드롭과 「소속 부품 변경」 메뉴가 같은 창을 쓴다.
 *
 * - 바뀌는 것은 도면의 소속 부품(drawings.part_id) 하나다. OCR·검토·측정 진행 같은 작업 상태는 바뀌지 않는다.
 * - 서버가 계산한 영향(유지되는 기록 수, 부품 이름 기준으로 달라지는 기능)을 보여주고 확인을 받는다.
 * - 같은 부품을 고르면 변경하지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { fetchPartMoveImpact, type Drawing, type Part, type PartMoveImpact } from "../../lib/drawingAPI";

export function MoveDrawingDialog({
  drawing,
  parts,
  initialTarget,
  partPath,
  onCancel,
  onConfirm,
}: {
  drawing: Drawing;
  /** 고를 수 있는 부품 (메뉴로 열었을 때) */
  parts: Part[];
  /** 드롭한 부품 (드래그로 열었을 때) */
  initialTarget?: Part | null;
  /** '3D 부품 › 등록 부품' 형태의 경로 */
  partPath: (part: Part | undefined) => string;
  onCancel: () => void;
  /** 실제 이동. 실패하면 오류 문구를 돌려준다 (창에 표시하고 그대로 둔다). */
  onConfirm: (target: Part) => Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [targetId, setTargetId] = useState(initialTarget?.part_id ?? "");
  const [impact, setImpact] = useState<PartMoveImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const source = parts.find((part) => part.part_id === drawing.part_id);
  const target = parts.find((part) => part.part_id === targetId) ?? (initialTarget?.part_id === targetId ? initialTarget : undefined);
  const samePart = !!target && target.part_id === drawing.part_id;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    setImpact(null);
    setError("");
    if (!targetId || targetId === drawing.part_id) return;
    const controller = new AbortController();
    setLoading(true);
    fetchPartMoveImpact(drawing.drawing_id, targetId, controller.signal)
      .then((data) => !controller.signal.aborted && setImpact(data))
      .catch((cause: unknown) => !controller.signal.aborted && setError(cause instanceof Error ? cause.message : "영향 확인 실패"))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [targetId, drawing.drawing_id, drawing.part_id]);

  async function confirm() {
    if (!target || samePart) return;
    setSaving(true);
    setError("");
    const failure = await onConfirm(target);
    setSaving(false);
    if (failure) setError(failure);
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="move-drawing-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onCancel();
      }}
      className="fixed inset-0 m-auto w-[min(480px,92vw)] rounded-md border border-dx-line-strong bg-dx-panel p-0 text-dx-text shadow-2xl backdrop:bg-black/60"
    >
      <div className="space-y-3 p-4 text-xs">
        <h2 id="move-drawing-title" className="text-[14px] font-semibold text-white">소속 부품 변경</h2>
        <p className="truncate text-dx-muted">도면: <b className="text-dx-text">{drawing.original_filename || drawing.name}</b></p>

        {!initialTarget && (
          <label className="block space-y-1">
            <span className="dx-label">옮길 부품</span>
            <select className="dx-input" value={targetId} onChange={(event) => setTargetId(event.target.value)} autoFocus>
              <option value="">선택해주세요</option>
              {parts.map((part) => (
                <option key={part.part_id} value={part.part_id}>
                  {partPath(part)}{part.part_id === drawing.part_id ? " (현재)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="flex flex-wrap items-center gap-1.5 rounded border border-dx-line bg-dx-raised px-2.5 py-2">
          <span className="text-dx-muted">{partPath(source)}</span>
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-dx-accent" />
          <span className="font-medium text-white">{target ? partPath(target) : "—"}</span>
        </p>

        {samePart && <p role="status" className="text-amber-200">이미 이 부품에 속한 도면입니다. 변경하지 않습니다.</p>}
        {loading && <p role="status" className="flex items-center gap-1.5 text-dx-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />영향을 확인하는 중…</p>}

        {impact && (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-emerald-300">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                그대로 유지: OCR 결과·관리자 검토{impact.review_status === "reviewed" ? "(검토 완료)" : ""} · 측정 기록 {impact.kept.measurements}건 · 가공 단계 기록 {impact.kept.machining_records}건 · 오류사례 연결 {impact.kept.error_case_links}건.
                작업 상태는 바뀌지 않습니다.
              </span>
            </p>
            {impact.changes.length > 0 && (
              <div className="rounded border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-amber-100">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />부품 이름을 쓰는 기능이 새 부품 기준으로 바뀝니다</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {impact.changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && <p role="alert" className="flex items-start gap-1.5 text-rose-300"><AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="dx-btn" disabled={saving} onClick={onCancel}>취소</button>
          <button
            type="button"
            className="dx-btn dx-btn-primary"
            disabled={!target || samePart || loading || saving || (!impact && !error)}
            onClick={() => void confirm()}
          >
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />이동 중…</> : impact?.changes.length ? "영향을 확인했고 이동" : "이동"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
