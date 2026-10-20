import React, { useMemo, useState } from "react";
import type { DemoDrawingDoc } from "../lib/demoDrawings";
import type { AddDraft, AddKind, ItemEdit } from "../lib/admin/adminStore";
import { formatLogTime, hasValueEdit } from "../lib/admin/adminStore";
import {
  ADD_KIND_LABEL,
  buildEditFromInput,
  inputFromValues,
  readValues,
  type AdminPoint,
  type EditInput,
  type Readiness,
} from "../lib/admin/adminOverlay";

type Filter = "all" | "dim" | "gdt" | "unconfirmed" | "warn" | "edited";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "전체" },
  { key: "dim", label: "치수" },
  { key: "gdt", label: "기하공차" },
  { key: "unconfirmed", label: "미확인" },
  { key: "warn", label: "⚠ 확인 필요" },
  { key: "edited", label: "수정됨" },
];

interface AdminChecklistProps {
  doc: DemoDrawingDoc;
  points: AdminPoint[];
  /** 이 도면의 수정값 (항목 id → 수정값) */
  edits: Record<string, ItemEdit>;
  selectedPointId: number;
  onSelectPoint: (id: number) => void;
  /** 수정값을 바꾼다. next 가 undefined 면 수정값을 지운다. */
  onCommitEdit: (sourceId: string, next: ItemEdit | undefined) => void;
  /** 검토 완료 조건 상태 */
  readiness: Readiness;
  /** 검토를 완료한 시각(ms). 완료 전이면 null */
  completedAt: number | null;
  onComplete: () => void;
  onReopen: () => void;
  /** 치수 추가: 진행 중인 위치 지정 단계 (없으면 null) */
  placing: { step: "lines" | "marker"; lineCount: number; text: string } | null;
  /** 입력을 확인한 뒤 도면에서 위치를 고르는 단계로 들어간다 */
  onStartAdd: (draft: AddDraft) => void;
  onUndoLine: () => void;
  /** 선 지정을 끝내고 번호표 위치 선택으로 넘어간다 */
  onFinishLines: () => void;
  onCancelAdd: () => void;
  /** 관리자가 추가한 항목 삭제 */
  onDeleteAdded: (sourceId: string) => void;
}

/**
 * 관리자 모드 오른쪽 패널: 항목별 확인 체크와 값 수정.
 * 수정값은 서버에 저장되고, 작업자 모드의 기준·판정에도 반영된다.
 */
export const AdminChecklist: React.FC<AdminChecklistProps> = ({
  doc,
  points,
  edits,
  selectedPointId,
  onSelectPoint,
  onCommitEdit,
  readiness,
  completedAt,
  onComplete,
  onReopen,
  placing,
  onStartAdd,
  onUndoLine,
  onFinishLines,
  onCancelAdd,
  onDeleteAdded,
}) => {
  const [filter, setFilter] = useState<Filter>("all");

  const confirmedCount = points.filter((point) => point.confirmed).length;
  const editedCount = points.filter((point) => point.adminEdited).length;

  const shown = useMemo(
    () =>
      points.filter((point) => {
        if (filter === "dim") return point.feature.type !== "GD&T";
        if (filter === "gdt") return point.feature.type === "GD&T";
        if (filter === "unconfirmed") return !point.confirmed;
        if (filter === "warn") return !!point.warning;
        if (filter === "edited") return point.adminEdited;
        return true;
      }),
    [points, filter],
  );

  const selected = points.find((point) => point.id === selectedPointId) || points[0];
  const selectedItem = selected ? doc.items.find((item) => item.id === selected.sourceId) : undefined;

  function toggleConfirm(point: AdminPoint) {
    const prev = edits[point.sourceId];
    const next: ItemEdit = { ...prev };
    if (point.confirmed) delete next.confirmed;
    else next.confirmed = true;
    onCommitEdit(point.sourceId, Object.keys(next).length > 0 ? next : undefined);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white p-5 text-slate-800">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">관리자 체크리스트</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            추출된 항목을 확인하고 값을 고칩니다. 수정값은 작업자 모드의 기준·판정에도 반영됩니다.
          </p>
        </div>
        <div className="shrink-0 text-right text-[11px] text-slate-600">
          <div>
            확인 <span className="font-bold text-cyan-700">{confirmedCount}</span> / {points.length}
          </div>
          <div>
            수정 <span className="font-bold text-cyan-700">{editedCount}</span>건
          </div>
        </div>
      </div>

      {/* 검토 완료 조건과 완료 버튼 */}
      <div
        className={`mt-3 rounded-lg border p-3 text-xs ${
          completedAt ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-slate-800">
            {completedAt ? `관리자 검토 완료 (${formatLogTime(completedAt)})` : "관리자 검토 미완료"}
          </div>
          {completedAt ? (
            <button
              type="button"
              onClick={onReopen}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              완료 취소
            </button>
          ) : (
            <button
              type="button"
              onClick={onComplete}
              disabled={!readiness.ready}
              className="rounded-lg bg-cyan-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              관리자 검토 완료
            </button>
          )}
        </div>
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
          <li>
            {readiness.confirmedTotal === readiness.total ? "✔" : "·"} 전체 항목 확인(치수·기하공차): {readiness.confirmedTotal} / {readiness.total}
          </li>
          <li>
            {readiness.gdtConfirmed === readiness.gdtTotal ? "✔" : "·"} 기하공차 확인: {readiness.gdtConfirmed} / {readiness.gdtTotal}
          </li>
          <li>
            {readiness.warnConfirmed === readiness.warnTotal ? "✔" : "·"} ⚠ 항목 확인: {readiness.warnConfirmed} / {readiness.warnTotal}
            {readiness.warnTotal === 0 && " (⚠ 항목 없음)"}
          </li>
        </ul>
        {!completedAt && !readiness.ready && readiness.pendingNumbers.length > 0 && (
          <p className="mt-1.5 text-[11px] text-amber-800">
            아직 확인할 항목: {readiness.pendingNumbers.slice(0, 12).join(", ")}번
            {readiness.pendingNumbers.length > 12 ? ` 외 ${readiness.pendingNumbers.length - 12}건` : ""}
          </p>
        )}
        {!completedAt && (
          <p className="mt-1 text-[11px] text-slate-500">
            완료 전 측정값은 판정을 보류합니다. 완료한 뒤 확인을 해제하면 완료가 자동으로 취소됩니다.
          </p>
        )}
      </div>

      <AddPanel
        placing={placing}
        onStartAdd={onStartAdd}
        onUndoLine={onUndoLine}
        onFinishLines={onFinishLines}
        onCancelAdd={onCancelAdd}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
              filter === key
                ? "border-cyan-600 bg-cyan-600 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="mt-3 max-h-72 shrink-0 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">해당하는 항목이 없습니다.</li>}
        {shown.map((point) => {
          const isSelected = point.id === selected?.id;
          return (
            <li
              key={point.id}
              onClick={() => onSelectPoint(point.id)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition hover:bg-cyan-50 ${
                isSelected ? "bg-cyan-100/80" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={point.confirmed}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggleConfirm(point)}
                aria-label={`${point.displayNumber}번 확인`}
                className="h-3.5 w-3.5 shrink-0 accent-cyan-600"
              />
              <span className="w-6 shrink-0 text-center font-bold text-slate-800">{point.displayNumber}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold text-slate-800">{point.feature.name}</span>{" "}
                <span className="font-mono text-slate-600">{point.dimension.formatted}</span>
              </span>
              {point.warning && (
                <span
                  title={point.warning}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    point.confirmed ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  ⚠ {point.confirmed ? "확인함" : "확인 필요"}
                </span>
              )}
              <span className="hidden shrink-0 font-mono text-[11px] text-slate-500 sm:inline">{point.dimension.tolerance}</span>
              {point.added && (
                <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">추가됨</span>
              )}
              {point.adminEdited && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">수정됨</span>
              )}
            </li>
          );
        })}
      </ul>

      {selected && selectedItem && (
        <ItemEditor
          // 항목이나 수정값이 바뀌면 입력칸을 새로 채운다
          key={`${doc.items.length}-${selected.sourceId}-${JSON.stringify(edits[selected.sourceId] ?? null)}`}
          doc={doc}
          point={selected}
          itemId={selectedItem.id}
          edit={edits[selected.sourceId]}
          onCommitEdit={onCommitEdit}
          onToggleConfirm={() => toggleConfirm(selected)}
          onDeleteAdded={onDeleteAdded}
        />
      )}
    </div>
  );
};

interface ItemEditorProps {
  doc: DemoDrawingDoc;
  point: AdminPoint;
  itemId: string;
  edit: ItemEdit | undefined;
  onCommitEdit: (sourceId: string, next: ItemEdit | undefined) => void;
  onToggleConfirm: () => void;
  onDeleteAdded: (sourceId: string) => void;
}

const ItemEditor: React.FC<ItemEditorProps> = ({ doc, point, itemId, edit, onCommitEdit, onToggleConfirm, onDeleteAdded }) => {
  const item = doc.items.find((entry) => entry.id === itemId)!;
  const current = useMemo(() => readValues(doc, item, edit), [doc, item, edit]);
  const original = useMemo(() => readValues(doc, item, undefined), [doc, item]);
  const [input, setInput] = useState<EditInput>(() => inputFromValues(current));
  const [error, setError] = useState("");

  const setField = (key: keyof EditInput) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setInput((previous) => ({ ...previous, [key]: event.target.value }));
    setError("");
  };

  function apply() {
    const result = buildEditFromInput(doc, item, edit, input);
    if (result.error) {
      setError(result.error);
      return;
    }
    onCommitEdit(point.sourceId, result.edit);
  }

  function revert() {
    const next: ItemEdit | undefined = edit?.confirmed ? { confirmed: true } : undefined;
    onCommitEdit(point.sourceId, next);
  }

  const inputClass =
    "w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-cyan-500 focus:outline-none";
  const labelClass = "mb-0.5 block text-[11px] font-semibold text-slate-600";
  const hint = (value: string) => <span className="font-normal text-slate-400"> (도면 값 {value})</span>;
  const text = (value: number | null) => (value === null ? "없음" : String(value));

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold text-slate-900">
            {point.displayNumber}번 · {point.feature.name} <span className="font-mono">{item.raw_text}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {current.kind === "GDT" ? "기하공차" : current.kind === "THREAD" ? "나사" : "치수"} · 도면 추출 값 기준으로 수정
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={point.confirmed} onChange={onToggleConfirm} className="h-3.5 w-3.5 accent-cyan-600" />
          확인 완료
        </label>
      </div>

      {point.warning && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          ⚠ {point.warning}. 도면과 대조해 값을 고치거나, 맞다면 "확인 완료"를 체크하세요.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {current.kind === "GDT" ? (
          <>
            <div>
              <label className={labelClass}>공차값{hint(text(original.tolerance))}</label>
              <input aria-label="공차값" value={input.tolerance} onChange={setField("tolerance")} className={inputClass} inputMode="decimal" />
            </div>
            <div>
              <label className={labelClass}>데이텀{hint(original.datum || "없음")}</label>
              <input aria-label="데이텀" value={input.datum} onChange={setField("datum")} className={inputClass} placeholder="예: A, B" />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>기준 치수{hint(text(original.nominal))}</label>
              <input aria-label="기준 치수" value={input.nominal} onChange={setField("nominal")} className={inputClass} inputMode="decimal" />
            </div>
            {current.kind === "DIM" && (
              <>
                <div className="col-span-2 -mb-1 text-[11px] text-slate-500">
                  상한 = 기준 치수 + 상한 공차, 하한 = 기준 치수 − 하한 공차. (±0.1이면 0.1 / 0.1)
                  {current.generalTolerance && " 지금은 일반공차(ISO 2768-m)를 쓰고 있습니다."}
                </div>
                <div>
                  <label className={labelClass}>상한 공차(+){hint(text(original.plus))}</label>
                  <input aria-label="상한 공차" value={input.plus} onChange={setField("plus")} className={inputClass} inputMode="decimal" />
                </div>
                <div>
                  <label className={labelClass}>하한 공차(−){hint(text(original.minus))}</label>
                  <input aria-label="하한 공차" value={input.minus} onChange={setField("minus")} className={inputClass} inputMode="decimal" />
                </div>
              </>
            )}
          </>
        )}
        <div className="col-span-2">
          <label className={labelClass}>측정기{hint(original.equipment)}</label>
          <input aria-label="측정기" value={input.equipment} onChange={setField("equipment")} className={inputClass} />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-cyan-500"
        >
          수정 적용
        </button>
        <button
          type="button"
          onClick={revert}
          disabled={!hasValueEdit(edit)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
        >
          원래 값으로
        </button>
        {hasValueEdit(edit) && <span className="text-[11px] font-semibold text-amber-700">관리자가 수정한 항목</span>}
        {point.added && (
          <button
            type="button"
            onClick={() => onDeleteAdded(point.sourceId)}
            className="ml-auto rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            이 추가 항목 삭제
          </button>
        )}
      </div>
      {point.added && (
        <p className="text-[11px] text-sky-800">관리자가 직접 추가한 항목입니다(OCR 누락 보충). 서버의 검토 결과와 수정 이력에 저장됩니다.</p>
      )}
    </div>
  );
};


interface AddPanelProps {
  placing: AdminChecklistProps["placing"];
  onStartAdd: (draft: AddDraft) => void;
  onUndoLine: () => void;
  onFinishLines: () => void;
  onCancelAdd: () => void;
}

/** OCR이 놓친 치수를 관리자가 직접 추가하는 입력 영역 */
const AddPanel: React.FC<AddPanelProps> = ({ placing, onStartAdd, onUndoLine, onFinishLines, onCancelAdd }) => {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AddKind>("LINEAR");
  const [nominal, setNominal] = useState("");
  const [plus, setPlus] = useState("");
  const [minus, setMinus] = useState("");
  const [equipment, setEquipment] = useState("");
  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-cyan-500 focus:outline-none";
  const labelClass = "mb-0.5 block text-[11px] font-semibold text-slate-600";
  const parse = (value: string) => {
    const t = value.trim().replace(",", ".");
    return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };

  function start() {
    const n = parse(nominal);
    if (n === null || n <= 0) return setError("기준 치수는 0보다 큰 숫자로 입력하세요.");
    const draft: AddDraft = { kind, nominal: n };
    if (plus.trim() !== "" || minus.trim() !== "") {
      const p = parse(plus);
      const m = parse(minus);
      if (p === null || m === null) return setError("상한·하한 공차를 둘 다 숫자로 입력하세요. (공차가 없으면 둘 다 비우세요)");
      if (p + m <= 0) return setError("상한이 하한보다 커야 합니다.");
      draft.plus = p;
      draft.minus = m;
    }
    if (equipment.trim() !== "") draft.equipment = equipment.trim();
    setError("");
    onStartAdd(draft);
    setNominal("");
    setPlus("");
    setMinus("");
    setEquipment("");
  }

  if (placing) {
    return (
      <div role="status" className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3 text-xs text-sky-900">
        <div className="font-bold">치수 추가 · {placing.text}</div>
        <p className="mt-1 text-[11px]">
          {placing.step === "lines"
            ? `도면에서 측정할 선(모서리·윤곽)을 눌러 고르세요. 여러 개 고를 수 있습니다. (고른 선 ${placing.lineCount}개)`
            : "번호표를 놓을 위치를 도면에서 누르세요."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {placing.step === "lines" && (
            <>
              <button type="button" onClick={onFinishLines} className="rounded bg-sky-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-sky-500">
                {placing.lineCount > 0 ? "선 지정 끝 → 번호표 위치 선택" : "선 없이 번호표 위치만 선택"}
              </button>
              <button
                type="button"
                onClick={onUndoLine}
                disabled={placing.lineCount === 0}
                className="rounded border border-sky-300 bg-white px-3 py-1 text-[11px] font-semibold text-sky-800 disabled:opacity-40"
              >
                마지막 선 취소
              </button>
            </>
          )}
          <button type="button" onClick={onCancelAdd} className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700">
            추가 취소 (Esc)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold text-slate-800"
      >
        <span>+ 치수 추가 <span className="font-normal text-slate-500">(OCR이 놓친 치수 보충)</span></span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>종류</label>
              <select value={kind} onChange={(event) => setKind(event.target.value as AddKind)} className={inputClass}>
                {(Object.keys(ADD_KIND_LABEL) as AddKind[]).map((key) => (
                  <option key={key} value={key}>{ADD_KIND_LABEL[key]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>기준 치수</label>
              <input aria-label="추가 기준 치수" value={nominal} onChange={(event) => setNominal(event.target.value)} className={inputClass} inputMode="decimal" />
            </div>
            <div>
              <label className={labelClass}>상한 공차(+) · 선택</label>
              <input value={plus} onChange={(event) => setPlus(event.target.value)} className={inputClass} inputMode="decimal" />
            </div>
            <div>
              <label className={labelClass}>하한 공차(−) · 선택</label>
              <input value={minus} onChange={(event) => setMinus(event.target.value)} className={inputClass} inputMode="decimal" />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>측정기 · 선택 (비우면 자동)</label>
              <input value={equipment} onChange={(event) => setEquipment(event.target.value)} className={inputClass} />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">공차를 비우면 일반공차(ISO 2768-m)로 판정합니다.</p>
          {error && (
            <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{error}</p>
          )}
          <button type="button" onClick={start} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-sky-500">
            측정 위치 지정하기
          </button>
        </div>
      )}
    </div>
  );
};
