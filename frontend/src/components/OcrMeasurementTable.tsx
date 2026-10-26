import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toleranceText, type OcrPoint } from '../lib/ocr';
import {
  measurementStatusLabels,
  measurementStatusClasses,
  type MeasurementRecord,
} from "../lib/measurementAPI";
import { FEATURE_LABEL } from "../lib/inspection/instruments";

const COLUMNS: { label: string; className: string }[] = [
  { label: '상태', className: 'w-[104px]' },
  { label: '번호', className: 'w-12 text-right' },
  { label: '측정항목', className: '' },
  { label: '추출 표기', className: '' },
  { label: '형상', className: 'w-24' },
  { label: '허용 범위 / 확인', className: '' },
];

export function OcrMeasurementTable({
  points,
  selectedId,
  onSelect,
  title,
  records = {},
  reviewed = false,
}: {
  points: OcrPoint[];
  selectedId: number;
  onSelect: (id: number) => void;
  title: string;
  records?: Record<string, MeasurementRecord>;
  reviewed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    bodyRef.current?.querySelector(`[data-point="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, collapsed]);
  const completed = reviewed
    ? points.filter((point) => records[point.source.id]?.status === 'completed').length
    : 0;
  return (
    <section className={`${collapsed ? "" : "h-[240px] max-h-[42%] min-h-[120px]"} flex shrink-0 flex-col border-t border-slate-300 bg-white`}>
      <div className="flex h-8 shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-3">
        <h3 className="min-w-0 truncate text-xs font-semibold text-slate-900">{title} 측정항목</h3>
        <span className="shrink-0 text-[11px] text-slate-500">
          {reviewed ? <>완료 <b className="font-mono font-medium text-slate-700">{completed}</b> / {points.length}</> : <>추출 {points.length}건</>}
        </span>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="ocr-measurement-body"
          onClick={() => setCollapsed((v) => !v)}
          className="btn btn-ghost ml-auto h-6"
        >
          {collapsed ? '펼치기' : '접기'}
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <div id="ocr-measurement-body" hidden={collapsed} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-white text-[11px] text-slate-500">
            <tr>
              {COLUMNS.map(({ label, className }) => (
                <th key={label} scope="col" className={`border-b border-slate-200 px-3 py-1.5 font-medium ${className}`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {points.map((point) => {
              const selected = selectedId === point.id;
              const status = records[point.source.id]?.status ?? "pending";
              return (
                <tr
                  key={point.source.id}
                  data-point={point.id}
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => onSelect(point.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(point.id);
                    }
                  }}
                  className={`cursor-pointer outline-none [&>td]:border-b [&>td]:border-slate-100 focus-visible:[&>td]:bg-slate-100 ${
                    selected
                      ? '[&>td]:bg-cyan-50 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-cyan-700)]'
                      : 'hover:[&>td]:bg-slate-50'
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <span className={`tag ${!reviewed ? "bg-amber-100 text-amber-800" : measurementStatusClasses[status]}`}>
                      {!reviewed ? "확인 필요" : measurementStatusLabels[status]}
                    </span>
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${selected ? 'font-semibold text-cyan-800' : 'text-slate-700'}`}>{point.displayNumber}</td>
                  <td className={`px-3 py-1.5 ${selected ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{point.feature.name}</td>
                  <td className="px-3 py-1.5 font-mono font-medium text-slate-900">{point.source.raw_text}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{FEATURE_LABEL[point.source.feature_type ?? ''] ?? '미확정'}</td>
                  <td className="px-3 py-1.5 tabular-nums text-slate-700">{point.source.inspection_approved && point.source.measurement_mode === 'gauge' ? '합격/불합격 기록' : toleranceText(point.source)}</td>
                </tr>
              );
            })}
            {!points.length && <tr><td colSpan={6} className="p-5 text-center text-slate-400">검색 조건에 맞는 항목이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
