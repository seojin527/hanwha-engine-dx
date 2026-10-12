import React, { useRef } from "react";
import { MOCK_PART_INFO } from "../data/mockData";
import {
  Upload,
  Search,
  RotateCcw,
  CheckCircle,
  ShieldCheck,
  Cpu,
  User,
  SlidersHorizontal,
} from "lucide-react";

interface HeaderProps {
  onUploadDrawing: (fileName: string) => void;
  onResetData: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  onUploadDrawing,
  onResetData,
  searchQuery,
  onSearchChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadDrawing(file.name);
    }
  };

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 text-white px-4 flex items-center justify-between shrink-0 select-none z-30">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
        className="hidden"
      />

      {/* Left: Brand & Part Information */}
      <div className="flex items-center gap-4">
        {/* Logo & Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded bg-blue-600 border border-blue-400/50 flex items-center justify-center text-white shadow-sm shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm tracking-tight text-white">
                Drawing AI Measurement Guide
              </h1>
              <span className="hidden xl:inline text-[11px] text-blue-400 font-medium">
                AI 도면 측정 가이드
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono leading-none mt-0.5">
              Piston Rod Quality Inspection Workspace
            </p>
          </div>
        </div>

        {/* Vertical Divider */}
        <div className="h-8 w-px bg-slate-800 hidden md:block" />

        {/* Current Working Part Metadata (Section 5) */}
        <div className="hidden lg:flex items-center gap-3 text-xs">
          <div className="bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/80 flex items-center gap-3">
            <div>
              <span className="text-[10px] text-slate-400 block uppercase font-mono">Part</span>
              <span className="font-semibold text-slate-100">PISTON ROD (피스톤 로드)</span>
            </div>

            <div className="h-5 w-px bg-slate-700" />

            <div>
              <span className="text-[10px] text-slate-400 block uppercase font-mono">Part No.</span>
              <span className="font-mono font-semibold text-cyan-400">{MOCK_PART_INFO.partNo}</span>
            </div>

            <div className="h-5 w-px bg-slate-700" />

            <div>
              <span className="text-[10px] text-slate-400 block uppercase font-mono">Drawing</span>
              <span className="font-mono text-slate-200">{MOCK_PART_INFO.drawingNo}</span>
            </div>

            <div className="h-5 w-px bg-slate-700" />

            <div>
              <span className="text-[10px] text-slate-400 block uppercase font-mono">Revision</span>
              <span className="font-mono font-bold text-amber-400">{MOCK_PART_INFO.revision}</span>
            </div>
          </div>

          {/* Status Badges */}
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
              <CheckCircle className="w-3 h-3 text-emerald-400" />
              <span>최신 도면</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-300 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-800">
              <ShieldCheck className="w-3 h-3 text-blue-400" />
              <span>검사 기준 일치</span>
            </span>
          </div>
        </div>
      </div>

      {/* Right: Search, Reset, Upload & Inspector */}
      <div className="flex items-center gap-2.5">
        {/* Search Input */}
        <div className="relative hidden md:block">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder="포인트 / 규격 검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-36 lg:w-44 h-8 pl-8 pr-2.5 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Reset Demo Data Button */}
        <button
          onClick={onResetData}
          title="측정값 및 상태 초기화"
          className="h-8 px-2.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">초기화</span>
        </button>

        {/* Upload Drawing Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="h-8 px-3.5 rounded bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>도면 업로드</span>
        </button>

        <div className="h-6 w-px bg-slate-800 mx-1" />

        {/* Inspector Avatar & Name */}
        <div className="flex items-center gap-2 pl-1">
          <div className="relative">
            <div className="w-8 h-8 rounded bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-300">
              <User className="w-4 h-4" />
            </div>
            {/* Active green dot */}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
          </div>
          <div className="hidden xl:block text-left">
            <p className="text-xs font-medium text-slate-200 leading-tight">
              {MOCK_PART_INFO.inspector.split(" ")[0]}
            </p>
            <p className="text-[10px] text-slate-400 font-mono leading-tight">
              QA Lead
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
