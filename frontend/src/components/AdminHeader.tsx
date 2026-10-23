/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { MOCK_PART_INFO } from "../data/mockData";
import type { AppMode } from "../lib/admin/adminStore";

interface HeaderProps {
  displayInfo?: { partName: string; drawingName: string; partNo?: string | null; scale?: string | null; revision?: string | null };
  onUploadDrawing: (fileName: string) => void;
  onResetData: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  /** 작업자 / 관리자 모드 */
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  /** 수정 내역 창이 열려 있는가, 내역 건수, 여닫기 */
  historyOpen: boolean;
  historyCount: number;
  onToggleHistory: () => void;
}

export const AdminHeader: React.FC<HeaderProps> = ({
  displayInfo,
  onUploadDrawing,
  onResetData,
  searchQuery,
  onSearchChange,
  mode,
  onModeChange,
  historyOpen,
  historyCount,
  onToggleHistory,
}) => {
  return (
    <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between border-b border-slate-800 shrink-0 h-16 shadow-md">
      {/* Left: Title & Part Info */}
      <div className="flex min-w-0 flex-1 items-center gap-6 overflow-hidden whitespace-nowrap">
        <div>
          <h1 className="text-sm font-extrabold text-white tracking-wide flex items-center gap-2">
            Drawing AI Measurement Guide
            <span className="hidden min-[2100px]:inline text-[11px] bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded border border-cyan-800 font-normal">
              Engine Component Quality Inspection Workspace
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {displayInfo?.partName || MOCK_PART_INFO?.name || "PISTON ROD (피스톤 로드)"}
          </p>
        </div>

        <div className="hidden min-[1500px]:flex items-center gap-4 text-xs text-slate-300 border-l border-slate-700 pl-6">
          <div>
            <span className="text-slate-500 mr-1.5">PART:</span>
            <span className="font-semibold text-slate-200">{displayInfo?.partName || MOCK_PART_INFO?.name}</span>
          </div>
          <div>
            <span className="text-slate-500 mr-1.5">PART NO.:</span>
            <span className="font-semibold text-cyan-300">{displayInfo ? displayInfo.partNo || "—" : MOCK_PART_INFO?.partNo}</span>
          </div>
          <div>
            <span className="text-slate-500 mr-1.5">DRAWING:</span>
            <span className="font-semibold text-slate-200">{displayInfo?.drawingName || MOCK_PART_INFO?.drawingNo}</span>
          </div>
          <div>
            <span className="text-slate-500 mr-1.5">SCALE:</span>
            <span className="font-semibold text-slate-200">{displayInfo ? displayInfo.scale || "—" : MOCK_PART_INFO?.scale}</span>
          </div>
          <div>
            <span className="text-slate-500 mr-1.5">REVISION:</span>
            <span className="font-semibold text-amber-300">{displayInfo ? displayInfo.revision || "—" : MOCK_PART_INFO?.revision}</span>
          </div>
        </div>
      </div>

      {/* Right: Search, Reset, Upload, User Badge */}
      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap">
        <div className="relative">
          <input
            type="text"
            placeholder="포인트/규격 검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 w-32 transition"
          />
        </div>

        {/* 작업자 / 관리자 모드 전환 (권한 확인 없는 목업) */}
        <div role="group" aria-label="모드 전환" className="flex overflow-hidden rounded-lg border border-slate-700 text-xs font-semibold">
          {(["worker", "admin"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => onModeChange(value)}
              className={`px-3 py-1.5 transition ${
                mode === value ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {value === "worker" ? "작업자" : "관리자"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onToggleHistory}
          aria-expanded={historyOpen}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border flex items-center gap-1.5 ${
            historyOpen
              ? "bg-cyan-950 border-cyan-700 text-cyan-200"
              : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
          }`}
        >
          🕘 수정 내역{historyCount > 0 ? ` ${historyCount}` : ""}
        </button>

        <button
          onClick={onResetData}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition border border-slate-700 flex items-center gap-1.5"
        >
          ↩ 되돌리기
        </button>

        <button
          onClick={() => onUploadDrawing("")}
          className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition shadow flex items-center gap-1.5"
        >
          📁 도면 업로드
        </button>

        {/* User Profile Badge */}
        <div className="flex items-center gap-2 border-l border-slate-700 pl-3 ml-1">
          <div className="w-7 h-7 rounded-full bg-cyan-700 flex items-center justify-center font-bold text-xs text-white">
            김
          </div>
          <div className="hidden sm:block text-left text-xs">
            <div className="font-bold text-slate-200">김태호</div>
            <div className="text-[10px] text-cyan-400">QA Lead</div>
          </div>
        </div>
      </div>
    </header>
  );
};