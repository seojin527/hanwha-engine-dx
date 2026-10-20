import { useEffect, useRef, useState } from 'react';
import { toleranceText, type OcrPoint } from '../lib/ocr';

export function OcrMeasurementTable({ points, selectedId, onSelect, title }: {
  points: OcrPoint[]; selectedId: number; onSelect: (id: number) => void; title: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    bodyRef.current?.querySelector(`[data-point="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, collapsed]);
  return (
    <section className={`${collapsed ? "" : "h-[280px] max-h-[45%]"} shrink-0 flex flex-col border-t border-slate-200 bg-white shadow-inner`}>
      <div className="flex items-center justify-between gap-3 border-b bg-slate-100 px-4 py-2">
        <h3 className="text-xs font-bold text-slate-800">{title} 측정항목</h3>
        <div className="flex items-center gap-3"><span className="text-[11px] text-slate-500">추출 {points.length}건</span>
          <button type="button" aria-expanded={!collapsed} aria-controls="ocr-measurement-body" onClick={()=>setCollapsed(v=>!v)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-cyan-50">{collapsed ? '측정항목 펼치기 ▴' : '측정항목 접기 ▾'}</button></div>
      </div>
      <div id="ocr-measurement-body" hidden={collapsed} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr>
            {['상태', '번호', '측정항목', '추출 표기', '형상', '허용 범위 / 확인'].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}
          </tr></thead>
          <tbody ref={bodyRef} className="divide-y divide-slate-100">
            {points.map((point) => <tr key={point.source.id} data-point={point.id}
              onClick={() => onSelect(point.id)}
              className={`cursor-pointer hover:bg-cyan-50 ${selectedId === point.id ? 'bg-cyan-100/80' : ''}`}>
              <td className="px-3 py-2"><span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">{point.source.requires_review ? '확인 필요' : '추출됨'}</span></td>
              <td className="px-3 py-2 font-bold">{point.displayNumber}</td>
              <td className="px-3 py-2">{point.feature.name}</td>
              <td className="px-3 py-2 font-mono font-bold text-cyan-900">{point.source.raw_text}</td>
              <td className="px-3 py-2 text-slate-600">{point.source.feature_type === 'UNKNOWN' ? '미확정' : point.source.feature_type || '미확정'}</td>
              <td className="px-3 py-2">{toleranceText(point.source)}</td>
            </tr>)}
            {!points.length && <tr><td colSpan={6} className="p-5 text-center text-slate-400">검색 조건에 맞는 항목이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
