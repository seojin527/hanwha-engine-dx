import React, { useMemo, useState } from "react";
import type { DemoDrawingDoc } from "../lib/demoDrawings";
import type { ItemEdit } from "../lib/admin/adminStore";
import { hasValueEdit } from "../lib/admin/adminStore";
import {
  buildEditFromInput,
  inputFromValues,
  readValues,
  type AdminPoint,
  type EditInput,
} from "../lib/admin/adminOverlay";

type Filter = "all" | "dim" | "gdt" | "unconfirmed" | "edited";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "전체" },
  { key: "dim", label: "치수" },
  { key: "gdt", label: "기하공차" },
  { key: "unconfirmed", label: "미확인" },
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
}

/**
 * 관리자 모드 오른쪽 패널: 항목별 확인 체크와 값 수정.
 * 수정값은 이 브라우저에만 저장되고, 작업자 모드의 기준·판정에도 반영된다.
 */
export const AdminChecklist: React.FC<AdminChecklistProps> = ({
  doc,
  points,
  edits,
  selectedPointId,
  onSelectPoint,
  onCommitEdit,
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
              <span className="hidden shrink-0 font-mono text-[11px] text-slate-500 sm:inline">{point.dimension.tolerance}</span>
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
}

const ItemEditor: React.FC<ItemEditorProps> = ({ doc, point, itemId, edit, onCommitEdit, onToggleConfirm }) => {
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

      <div className="grid grid-cols-2 gap-3">
        {current.kind === "GDT" ? (
          <>
            <div>
              <label className={labelClass}>공차값{hint(text(original.tolerance))}</label>
              <input value={input.tolerance} onChange={setField("tolerance")} className={inputClass} inputMode="decimal" />
            </div>
            <div>
              <label className={labelClass}>데이텀{hint(original.datum || "없음")}</label>
              <input value={input.datum} onChange={setField("datum")} className={inputClass} placeholder="예: A, B" />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>기준 치수{hint(text(original.nominal))}</label>
              <input value={input.nominal} onChange={setField("nominal")} className={inputClass} inputMode="decimal" />
            </div>
            {current.kind === "DIM" && (
              <>
                <div className="col-span-2 -mb-1 text-[11px] text-slate-500">
                  상한 = 기준 치수 + 상한 공차, 하한 = 기준 치수 − 하한 공차. (±0.1이면 0.1 / 0.1)
                  {current.generalTolerance && " 지금은 일반공차(ISO 2768-m)를 쓰고 있습니다."}
                </div>
                <div>
                  <label className={labelClass}>상한 공차(+){hint(text(original.plus))}</label>
                  <input value={input.plus} onChange={setField("plus")} className={inputClass} inputMode="decimal" />
                </div>
                <div>
                  <label className={labelClass}>하한 공차(−){hint(text(original.minus))}</label>
                  <input value={input.minus} onChange={setField("minus")} className={inputClass} inputMode="decimal" />
                </div>
              </>
            )}
          </>
        )}
        <div className="col-span-2">
          <label className={labelClass}>측정기{hint(original.equipment)}</label>
          <input value={input.equipment} onChange={setField("equipment")} className={inputClass} />
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
      </div>
    </div>
  );
};
